// Optimisation du guidage : pour une parcelle, un outil et des obstacles, propose des directions
// de passages (parallèles aux côtés droits) et cale les passages pour que les obstacles tombent
// en bout d'outil.
//
// Tout se calcule dans un plan local (mètres). Les chiffres (demi-tours, distances) sont des
// estimations : la forme réelle des demi-tours et de la tournière dépend du tracteur et de l'outil.

import { coins, cotesEntreCoins, estDroit, ligneAB } from './guidage';
import { aireSignee, distancePointSegment, type XY } from './plan';

export interface ReglagesPassages {
  /** Largeur de travail (m), celle réglée sur la console. */
  largeur: number;
  /** Largeur de la tournière tout autour (m) ; 0 sans tournière. */
  tourniere: number;
}

/** Direction candidate : parallèle à un côté droit, avec la droite de ce côté. */
export interface Direction {
  /** Indice du côté (dans l'ordre de l'anneau). */
  cote: number;
  /** Droite du côté (moindres carrés), orientée dans le sens de l'anneau. */
  a: XY;
  b: XY;
  longueur: number;
}

export interface PlaceObstacle {
  /** Distance (m) entre l'obstacle et le bout d'outil le plus proche : 0 = pile en bout d'outil. */
  distanceBout: number;
  /** L'obstacle est dans la tournière : les passages ne le concernent pas. */
  dansTourniere: boolean;
}

export interface Proposition {
  direction: Direction;
  /** Cap des passages en degrés (0 = Nord-Sud, 90 = Est-Ouest), entre 0 et 180. */
  cap: number;
  /** Ligne AB : le premier passage le long du côté, prolongé sur toute la parcelle. */
  ab: [XY, XY];
  /** Décalage (m) appliqué pour placer les obstacles (0 sans obstacle), vers l'intérieur si positif. */
  decalage: number;
  passages: number;
  demiTours: number;
  /** Longueur des passages (m), hors demi-tours et tournière. */
  longueurPassages: number;
  /** Estimation totale (m) : passages, demi-tours (demi-cercle de la largeur), tours de tournière. */
  longueurTotale: number;
  /** Passages de moins de deux largeurs de long (pointes). */
  passagesCourts: number;
  /** Les passages eux-mêmes (segments dans la parcelle, tournière déduite), pour les dessiner. */
  lignes: [XY, XY][];
  obstacles: PlaceObstacle[];
}

/** Côtés droits de plus de `longueurMin` m, une direction par orientation (à `ecartDeg` près). */
export function directionsDesCotes(
  contour: readonly XY[],
  seuilCoins = 30,
  longueurMin = 20,
  tolerance = 0.5,
  ecartDeg = 3,
): Direction[] {
  const trouves = coins(contour, seuilCoins);
  const toutes: Direction[] = [];
  cotesEntreCoins(contour.length, trouves).forEach((ids, cote) => {
    const pts = ids.map((i) => contour[i]!);
    if (pts.length < 2 || !estDroit(pts, tolerance)) return;
    const [a, b] = ligneAB(pts, 0);
    const longueur = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (longueur >= longueurMin) toutes.push({ cote, a, b, longueur });
  });
  // Les plus longs d'abord ; un côté presque parallèle à un côté déjà gardé n'apporte rien.
  toutes.sort((x, y) => y.longueur - x.longueur);
  const gardees: Direction[] = [];
  const angle = (d: Direction) => Math.atan2(d.b[1] - d.a[1], d.b[0] - d.a[0]);
  for (const d of toutes) {
    const proche = gardees.some((g) => {
      let e = Math.abs(angle(d) - angle(g)) % Math.PI;
      e = Math.min(e, Math.PI - e);
      return e < (ecartDeg * Math.PI) / 180;
    });
    if (!proche) gardees.push(d);
  }
  return gardees;
}

/**
 * Direction choisie à la main : le côté (entre deux coins) qui contient le segment `segment`
 * (de `contour[segment]` au sommet suivant), redressé en droite moyenne même s'il n'est pas
 * droit. Un segment pris dans un coin (côtés de moins de 5 m) donne sa propre direction.
 */
export function directionDuSegment(
  contour: readonly XY[],
  segment: number,
  seuilCoins = 30,
): Direction & { sommets: number[] } {
  const n = contour.length;
  const suivant = (segment + 1) % n;
  const cotes = cotesEntreCoins(n, coins(contour, seuilCoins));
  let cote = cotes.findIndex((ids) =>
    ids.some((id, k) => id === segment && ids[k + 1] === suivant),
  );
  const ids = cote >= 0 ? cotes[cote]! : [segment, suivant];
  if (cote < 0) cote = -1;
  const [a, b] = ligneAB(
    ids.map((i) => contour[i]!),
    0,
  );
  return { cote, a, b, longueur: Math.hypot(b[0] - a[0], b[1] - a[1]), sommets: ids };
}

/** Morceaux de la droite {s = n·x} à l'intérieur des anneaux (pair-impair), en abscisse le long de u. */
function morceaux(
  anneaux: readonly (readonly XY[])[],
  u: XY,
  n: XY,
  s: number,
  tourniere: number,
): [number, number][] {
  const coupes: { t: number; raccourci: number }[] = [];
  for (const pts of anneaux) {
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k]!;
      const q = pts[(k + 1) % pts.length]!;
      const sp = p[0] * n[0] + p[1] * n[1] - s;
      const sq = q[0] * n[0] + q[1] * n[1] - s;
      if (sp > 0 === sq > 0) continue;
      const f = sp / (sp - sq);
      const x: XY = [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
      // Tournière en bout de passage : plus longue quand le bord est en biais (limitée à 3 fois).
      const e = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const sinus = Math.abs(((q[0] - p[0]) * u[1] - (q[1] - p[1]) * u[0]) / e);
      coupes.push({ t: x[0] * u[0] + x[1] * u[1], raccourci: tourniere / Math.max(sinus, 1 / 3) });
    }
  }
  coupes.sort((a, b) => a.t - b.t);
  const res: [number, number][] = [];
  for (let k = 0; k + 1 < coupes.length; k += 2) {
    const debut = coupes[k]!.t + coupes[k]!.raccourci;
    const fin = coupes[k + 1]!.t - coupes[k + 1]!.raccourci;
    if (fin - debut > 1) res.push([debut, fin]);
  }
  return res;
}

function perimetre(pts: readonly XY[]): number {
  let l = 0;
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k]!;
    const q = pts[(k + 1) % pts.length]!;
    l += Math.hypot(q[0] - p[0], q[1] - p[1]);
  }
  return l;
}

/**
 * Passages parallèles à `direction` dans la parcelle (`contour` extérieur, `trous` = zones
 * exclues), calés pour que les `obstacles` tombent le plus près possible d'un bout d'outil.
 */
export function evaluerDirection(
  contour: readonly XY[],
  trous: readonly (readonly XY[])[],
  direction: Direction,
  obstacles: readonly XY[],
  r: ReglagesPassages,
): Proposition {
  const W = r.largeur;
  const H = r.tourniere;
  const lu = Math.hypot(direction.b[0] - direction.a[0], direction.b[1] - direction.a[1]);
  const u: XY = [(direction.b[0] - direction.a[0]) / lu, (direction.b[1] - direction.a[1]) / lu];
  // Normale vers l'intérieur : à gauche du sens de l'anneau s'il tourne dans le sens inverse des
  // aiguilles d'une montre.
  const gauche = aireSignee(contour) > 0 ? 1 : -1;
  const n: XY = [-u[1] * gauche, u[0] * gauche];
  const s = (p: XY) => (p[0] - direction.a[0]) * n[0] + (p[1] - direction.a[1]) * n[1];
  const t = (p: XY) => p[0] * u[0] + p[1] * u[1];
  const anneaux = [contour, ...trous];
  // Coordonnée s des droites : on travaille avec s absolu (n·x) pour couper les anneaux.
  const s0Abs = direction.a[0] * n[0] + direction.a[1] * n[1];
  const sMax = Math.max(...contour.map(s));
  // La parcelle peut déborder derrière le côté (côté pris dans un creux, ou côté redressé) : les
  // passages continuent alors de l'autre côté de la ligne AB.
  const sMin = Math.min(...contour.map(s));

  // Obstacles hors tournière : seuls eux comptent pour caler les passages.
  const places = obstacles.map((o) => {
    let d = Infinity;
    for (let k = 0; k < contour.length; k++) {
      d = Math.min(d, distancePointSegment(o, contour[k]!, contour[(k + 1) % contour.length]!));
    }
    return { s: s(o), dansTourniere: d < H };
  });
  const utiles = places.filter((p) => !p.dansTourniere);
  // Premier passage le long du côté, juste après la tournière ; décalé de δ pour les obstacles.
  const premier = H + W / 2;
  const distanceBout = (so: number, delta: number) => {
    const x = so - (premier + delta);
    const ecart = Math.abs(x - W * Math.round(x / W)); // au centre du passage le plus proche
    return W / 2 - ecart;
  };
  let delta = 0;
  if (utiles.length > 0) {
    // Recherche du décalage (entre −W/2 et +W/2) qui rapproche le plus l'obstacle le plus mal
    // placé d'un bout d'outil ; à égalité, le plus petit décalage.
    const pas = Math.min(0.01, W / 1000);
    let meilleur = Infinity;
    for (let d = -W / 2; d <= W / 2 + 1e-9; d += pas) {
      const pire = Math.max(...utiles.map((p) => distanceBout(p.s, d)));
      if (
        pire < meilleur - 1e-6 ||
        (Math.abs(pire - meilleur) <= 1e-6 && Math.abs(d) < Math.abs(delta))
      ) {
        meilleur = pire;
        delta = d;
      }
    }
    delta = Math.round(delta * 100) / 100;
  }

  let passages = 0;
  let longueurPassages = 0;
  let passagesCourts = 0;
  const lignes: [XY, XY][] = [];
  // Premier passage utile : celui qui couvre encore plus de 50 cm au-delà de la tournière, en
  // partant du côté le plus éloigné derrière la ligne AB.
  const kMin = Math.min(0, Math.floor((sMin + H + 0.5 - W / 2 - premier - delta) / W) + 1);
  for (let k = kMin; ; k++) {
    const sk = premier + delta + k * W;
    // Dernier passage : celui qui couvre encore une partie de ce qui reste avant la tournière.
    if (sk - W / 2 >= sMax - H) break;
    for (const [d, f] of morceaux(anneaux, u, n, s0Abs + sk, H)) {
      const sa = s0Abs + sk;
      const point = (t: number): XY => [n[0] * sa + u[0] * t, n[1] * sa + u[1] * t];
      lignes.push([point(d), point(f)]);
      passages++;
      longueurPassages += f - d;
      if (f - d < 2 * W) passagesCourts++;
    }
  }
  const demiTours = Math.max(0, passages - 1);
  const toursTourniere = H > 0 ? Math.ceil(H / W) : 0;
  const longueurTotale =
    longueurPassages + demiTours * ((Math.PI * W) / 2) + toursTourniere * perimetre(contour);

  // Ligne AB : premier passage, prolongé sur toute l'étendue de la parcelle le long de u.
  const ts = contour.map(t);
  const base: XY = [
    direction.a[0] + n[0] * (premier + delta),
    direction.a[1] + n[1] * (premier + delta),
  ];
  const tb = t(base);
  const ab: [XY, XY] = [
    [base[0] + u[0] * (Math.min(...ts) - tb), base[1] + u[1] * (Math.min(...ts) - tb)],
    [base[0] + u[0] * (Math.max(...ts) - tb), base[1] + u[1] * (Math.max(...ts) - tb)],
  ];
  const cap = ((((Math.atan2(u[0], u[1]) * 180) / Math.PI) % 180) + 180) % 180;
  return {
    direction,
    cap,
    ab,
    decalage: delta,
    passages,
    demiTours,
    longueurPassages,
    longueurTotale,
    passagesCourts,
    lignes,
    obstacles: places.map((p) => ({
      distanceBout: p.dansTourniere ? 0 : Math.max(0, distanceBout(p.s, delta)),
      dansTourniere: p.dansTourniere,
    })),
  };
}

/**
 * Propositions pour toutes les directions parallèles aux côtés droits, de la meilleure à la
 * moins bonne : obstacles le plus près du bout d'outil (à 50 cm près), puis le moins de
 * demi-tours, puis la plus courte distance.
 */
export function proposerPassages(
  contour: readonly XY[],
  trous: readonly (readonly XY[])[],
  obstacles: readonly XY[],
  r: ReglagesPassages,
  seuilCoins = 30,
): Proposition[] {
  const pire = (p: Proposition) =>
    Math.max(0, ...p.obstacles.filter((o) => !o.dansTourniere).map((o) => o.distanceBout));
  return directionsDesCotes(contour, seuilCoins)
    .map((d) => evaluerDirection(contour, trous, d, obstacles, r))
    .sort(
      (x, y) =>
        Math.round(pire(x) * 2) - Math.round(pire(y) * 2) ||
        x.demiTours - y.demiTours ||
        x.longueurTotale - y.longueurTotale,
    );
}
