// La carte et la géométrie à l’écran (cadrage, couleurs, point sous le doigt).

import { type Etat, latLon, limitesJumelles, type RefLimite, suivant } from '../edition/etat';
import { type LatLon, planLocal, type XY } from '../geometrie/plan';
import { Carte, type VersEcran } from '../ui/carte';
import { el } from '../ui/dom';
import { RAYON_TOUCHER_PX, type Session, ui } from './etat';
import { afficher } from './mise-en-page';
import { toucher } from './toucher';

// Texte d'état du GPS : élément fixe, mis à jour seul à chaque position reçue. Redessiner toute la
// page à chaque position refermerait la liste des parcelles si elle est ouverte.
export const texteGps = el('span', { class: 'doux' });
export const carte = new Carte(toucher, (texte) => {
  texteGps.textContent = texte;
  if (carte.gpsActif() !== ui.gpsAffiche) afficher();
});

// ---------- Géométrie d'affichage ----------

/**
 * Couleur de chaque parcelle, choisie pour que deux parcelles proches (rectangles englobants à
 * moins d'une vingtaine de mètres) n'aient pas la même : la plus petite couleur libre.
 */
export function colorier(etat: Etat, n: number): number[] {
  const marge = 0.0002; // environ 20 m en degrés
  const boites = Array.from({ length: n }, () => ({ s: 90, n: -90, o: 180, e: -180 }));
  for (const a of etat.anneaux) {
    const b = boites[a.parcelle]!;
    for (const p of a.sommets) {
      b.s = Math.min(b.s, p.lat);
      b.n = Math.max(b.n, p.lat);
      b.o = Math.min(b.o, p.lon);
      b.e = Math.max(b.e, p.lon);
    }
  }
  const proches = (i: number, j: number) => {
    const a = boites[i]!;
    const b = boites[j]!;
    return a.s - marge <= b.n && b.s - marge <= a.n && a.o - marge <= b.e && b.o - marge <= a.e;
  };
  const couleurs: number[] = [];
  for (let i = 0; i < n; i++) {
    const prises = new Set<number>();
    for (let j = 0; j < i; j++) if (proches(i, j)) prises.add(couleurs[j]!);
    let c = 0;
    while (prises.has(c)) c++;
    couleurs.push(c);
  }
  return couleurs;
}

export function anneauxXY(s: Session): XY[][] {
  return s.etat.anneaux.map((a) => a.sommets.map((p) => s.plan.versXY(latLon(p))));
}

export function anneauxLL(s: Session): LatLon[][] {
  return s.etat.anneaux.map((a) => a.sommets.map(latLon));
}

export function cadrerTout(): void {
  if (!ui.session) return;
  carte.cadrer(anneauxLL(ui.session).flat());
}

export function cadrerParcelle(p: number): void {
  if (!ui.session) return;
  const s = ui.session;
  carte.cadrer(
    anneauxLL(s)
      .filter((_, i) => s.etat.anneaux[i]!.parcelle === p)
      .flat(),
  );
}

/** « Nord », « Sud », « Est » ou « Ouest » : côté de la parcelle où se trouve la limite. */
export function coteLimite(s: Session, ref: RefLimite): string {
  const pts = anneauxXY(s)[ref.anneau]!;
  const a = pts[ref.debut]!;
  const b = pts[(ref.debut + 1) % pts.length]!;
  const c: XY = [
    pts.reduce((u, p) => u + p[0], 0) / pts.length,
    pts.reduce((u, p) => u + p[1], 0) / pts.length,
  ];
  const m: XY = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  if (Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1])) return m[1] > c[1] ? 'Nord' : 'Sud';
  return m[0] < c[0] ? 'Ouest' : 'Est';
}

export function longueur(s: Session, ref: RefLimite): number {
  // Mesurée dans un plan centré sur la limite : le plan d'affichage déforme un peu les distances.
  const a = latLon(s.etat.anneaux[ref.anneau]!.sommets[ref.debut]!);
  const b = latLon(s.etat.anneaux[ref.anneau]!.sommets[suivant(s.etat, ref.anneau, ref.debut)]!);
  return Math.hypot(...planLocal(a).versXY(b));
}

export const nomParcelle = (s: Session, anneau: number) =>
  s.td.parcelles[s.etat.anneaux[anneau]!.parcelle]!.nom;

// ---------- Mesure ----------

/** Parmi `points`, le plus proche du doigt s'il est à moins de RAYON_TOUCHER_PX pixels, sinon null. */
export function pointSousLeDoigt(
  points: readonly LatLon[],
  ecran: { x: number; y: number },
  versEcran: VersEcran,
): LatLon | null {
  let meilleur: LatLon | null = null;
  let dMin = RAYON_TOUCHER_PX;
  for (const pt of points) {
    const e = versEcran(pt);
    const d = Math.hypot(e.x - ecran.x, e.y - ecran.y);
    if (d <= dMin) {
      dMin = d;
      meilleur = pt;
    }
  }
  return meilleur;
}

/** Ce qu'on obtient en décalant la limite vers l'extérieur ou l'intérieur de sa parcelle. */
export function effetsLimite(s: Session, ref: RefLimite): { exterieur: string; interieur: string } {
  const x = nomParcelle(s, ref.anneau);
  const jum = limitesJumelles(s.etat, ref);
  if (jum.length > 0) {
    const y = jum.map((j) => nomParcelle(s, j.anneau)).join(', ');
    return {
      exterieur: `vers ${y} (${x} s'agrandit)`,
      interieur: `vers ${x} (${y} s'agrandit)`,
    };
  }
  if (s.etat.anneaux[ref.anneau]!.type === 2) {
    return {
      exterieur: `dans la zone exclue (${x} s'agrandit)`,
      interieur: `vers ${x} (la zone exclue s'agrandit)`,
    };
  }
  return {
    exterieur: `vers l'extérieur (${x} s'agrandit)`,
    interieur: `vers l'intérieur (${x} rétrécit)`,
  };
}
