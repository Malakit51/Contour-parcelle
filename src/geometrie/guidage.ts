// Lignes de guidage tirées d'un bord de parcelle, dans un plan local en mètres.
//
// `decalage` est compté vers la gauche du sens de parcours des points (positif à gauche). Pour un
// bord parcouru dans le sens de son anneau, la gauche est l'intérieur de la parcelle si l'anneau
// tourne dans le sens inverse des aiguilles d'une montre : c'est à l'appelant de choisir le signe.

import type { XY } from './plan';

/**
 * Ligne droite AB : la droite des moindres carrés des points du bord (distances perpendiculaires),
 * orientée du premier au dernier point, limitée à leurs projections, décalée de `decalage` mètres.
 */
export function ligneAB(pts: readonly XY[], decalage: number): [XY, XY] {
  if (pts.length < 2) throw new Error('Il faut au moins deux points.');
  const n = pts.length;
  const cx = pts.reduce((s, p) => s + p[0], 0) / n;
  const cy = pts.reduce((s, p) => s + p[1], 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of pts) {
    sxx += (x - cx) ** 2;
    syy += (y - cy) ** 2;
    sxy += (x - cx) * (y - cy);
  }
  // Direction principale (axe du nuage de points).
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let u: XY = [Math.cos(angle), Math.sin(angle)];
  const premier = pts[0]!;
  const dernier = pts[n - 1]!;
  if ((dernier[0] - premier[0]) * u[0] + (dernier[1] - premier[1]) * u[1] < 0) u = [-u[0], -u[1]];
  const gauche: XY = [-u[1], u[0]];
  const t = (p: XY) => (p[0] - cx) * u[0] + (p[1] - cy) * u[1];
  const point = (s: number): XY => [
    cx + u[0] * s + gauche[0] * decalage,
    cy + u[1] * s + gauche[1] * decalage,
  ];
  const ts = pts.map(t);
  return [point(Math.min(...ts)), point(Math.max(...ts))];
}

/**
 * Courbe : les points du bord décalés de `decalage` mètres. À chaque point intermédiaire, le
 * décalage suit la bissectrice des deux côtés voisins, pour rester à la même distance de chacun ;
 * il est limité à trois fois le décalage dans les virages serrés.
 */
export function courbeDecalee(pts: readonly XY[], decalage: number): XY[] {
  if (pts.length < 2) throw new Error('Il faut au moins deux points.');
  const normale = (a: XY, b: XY): XY => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
  };
  return pts.map((p, i) => {
    const avant = i > 0 ? normale(pts[i - 1]!, p) : null;
    const apres = i < pts.length - 1 ? normale(p, pts[i + 1]!) : null;
    let m: XY;
    let k = 1;
    if (avant && apres) {
      const somme: XY = [avant[0] + apres[0], avant[1] + apres[1]];
      const l = Math.hypot(...somme);
      m = l < 1e-9 ? avant : [somme[0] / l, somme[1] / l];
      // Longueur du décalage le long de la bissectrice : d / cos(demi-angle).
      const cos = m[0] * avant[0] + m[1] * avant[1];
      k = Math.min(1 / Math.max(cos, 1e-9), 3);
    } else {
      m = (avant ?? apres)!;
    }
    return [p[0] + m[0] * decalage * k, p[1] + m[1] * decalage * k];
  });
}

/** Angle (degrés, signé, positif à gauche) dont on tourne au sommet `b` en allant de `a` à `c`. */
function virage(a: XY, b: XY, c: XY): number {
  const v = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]);
  return (((((v * 180) / Math.PI + 180) % 360) + 360) % 360) - 180;
}

/** Coin d'un anneau : le sommet qui le marque et tous les sommets proches qui le forment. */
export interface Coin {
  sommet: number;
  /** Sommets du coin, dans l'ordre de l'anneau (un seul, sauf pour un coin coupé). */
  groupe: number[];
}

/**
 * Coins d'un anneau fermé : sommets où le contour tourne d'au moins `seuil` degrés. Des sommets
 * reliés par des côtés de moins de `regroupement` mètres comptent comme un seul coin (coin coupé
 * par deux points proches) : on additionne leurs virages, et le coin est marqué au sommet qui
 * tourne le plus. Renvoie les coins dans l'ordre de l'anneau.
 */
export function coins(pts: readonly XY[], seuil: number, regroupement = 5): Coin[] {
  const n = pts.length;
  if (n < 3) return [];
  const angles = pts.map((p, i) => virage(pts[(i - 1 + n) % n]!, p, pts[(i + 1) % n]!));
  const court = (i: number) => {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    return Math.hypot(b[0] - a[0], b[1] - a[1]) < regroupement;
  };
  // Départ : un sommet qui ne termine pas un côté court (sinon, tout l'anneau est court).
  const depart = pts.findIndex((_, i) => !court((i - 1 + n) % n));
  if (depart < 0) return [];
  const resultat: Coin[] = [];
  for (let k = 0; k < n;) {
    const groupe = [(depart + k) % n];
    while (k + groupe.length < n && court(groupe[groupe.length - 1]!)) {
      groupe.push((depart + k + groupe.length) % n);
    }
    k += groupe.length;
    const total = groupe.reduce((s, i) => s + angles[i]!, 0);
    if (Math.abs(total) >= seuil) {
      const sommet = groupe.reduce((m, i) => (Math.abs(angles[i]!) > Math.abs(angles[m]!) ? i : m));
      resultat.push({ sommet, groupe });
    }
  }
  return resultat.sort((a, b) => a.sommet - b.sommet);
}

/**
 * Côtés entre coins consécutifs : indices des sommets de chacun, du dernier sommet d'un coin au
 * premier sommet du coin suivant (les points d'un coin coupé ne comptent pas dans le côté).
 */
export function cotesEntreCoins(n: number, lesCoins: readonly Coin[]): number[][] {
  if (lesCoins.length === 0) return [[...Array(n).keys(), 0]];
  return lesCoins.map((c, k) => {
    const debut = c.groupe[c.groupe.length - 1]!;
    const fin = lesCoins[(k + 1) % lesCoins.length]!.groupe[0]!;
    const ids = [debut];
    for (let i = (debut + 1) % n; i !== fin; i = (i + 1) % n) ids.push(i);
    if (fin !== debut) ids.push(fin);
    return ids;
  });
}

/** Vrai si tous les points sont à moins de `tolerance` mètres de leur droite moyenne. */
export function estDroit(pts: readonly XY[], tolerance: number): boolean {
  if (pts.length <= 2) return true;
  const [a, b] = ligneAB(pts, 0);
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (l === 0) return true;
  return pts.every(
    (p) =>
      Math.abs(((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / l) < tolerance,
  );
}
