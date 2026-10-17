// Fusionner deux parcelles voisines : la parcelle `a` garde son nom, ses tâches, ses lignes de
// guidage et ses points du fichier ; elle reprend le contour de `b` au-delà de leur limite
// commune. `b` est retirée du fichier (avec ses tâches), ses zones exclues passent à `a`.

import { distancePointSegment, planLocal, type LatLon, type XY } from '../geometrie/plan';
import type { TaskData } from '../isoxml/lecture';
import {
  anneauIgnore,
  estSupprimee,
  latLon,
  sommetsEn,
  TOLERANCE_PARTAGE_M,
  type Etat,
  type Sommet,
} from './etat';
import { ErreurEdition, supprimerParcelle } from './operations';

function contour(etat: Etat, p: number): number {
  const X = etat.anneaux.findIndex(
    (a, i) => a.parcelle === p && a.type === 1 && !anneauIgnore(etat, i),
  );
  if (X < 0 || estSupprimee(etat, p)) throw new ErreurEdition('Parcelle introuvable.');
  return X;
}

function distanceAuContour(p: XY, pts: readonly XY[]): number {
  let d = Infinity;
  for (let k = 0; k < pts.length; k++) {
    d = Math.min(d, distancePointSegment(p, pts[k]!, pts[(k + 1) % pts.length]!));
  }
  return d;
}

const indiceProche = (pts: readonly XY[], p: XY) =>
  pts.findIndex((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) <= TOLERANCE_PARTAGE_M);

/**
 * Limite commune : la suite de sommets de `A` posés sur le contour de `B` (à 2 cm près), de `i`
 * à `j` dans le sens de `A`. Ses deux bouts doivent être aussi des sommets de `B` (`bi`, `bj`) ;
 * les points entre les deux peuvent n'exister que d'un côté.
 */
function limiteCommune(A: XY[], B: XY[]): { i: number; j: number; bi: number; bj: number } {
  const n = A.length;
  const surB = A.map((p) => distanceAuContour(p, B) <= TOLERANCE_PARTAGE_M);
  const nb = surB.filter(Boolean).length;
  if (nb < 2) {
    throw new ErreurEdition(
      'Ces deux parcelles n’ont pas de limite commune : colle d’abord l’une sur l’autre (« Coller au voisin »).',
    );
  }
  if (nb === n) throw new ErreurEdition('Ces deux parcelles ont le même contour.');
  // Début de la limite : un sommet sur B dont le précédent ne l'est pas.
  const debuts = A.map((_, k) => k).filter((k) => surB[k] && !surB[(k - 1 + n) % n]);
  if (debuts.length !== 1) {
    throw new ErreurEdition(
      'Ces deux parcelles se touchent à plusieurs endroits : fusion impossible ici.',
    );
  }
  const i = debuts[0]!;
  let j = i;
  while (surB[(j + 1) % n]) j = (j + 1) % n;
  const bi = indiceProche(B, A[i]!);
  const bj = indiceProche(B, A[j]!);
  if (bi < 0 || bj < 0 || bi === bj) {
    throw new ErreurEdition(
      'Les bouts de la limite commune ne sont pas des points communs : colle d’abord l’une sur l’autre (« Coller au voisin »).',
    );
  }
  return { i, j, bi, bj };
}

/** Contour de la parcelle fusionnée (aperçu). */
export function apercuFusion(etat: Etat, a: number, b: number): LatLon[] {
  return fusionner(etat, a, b).sommets.map(latLon);
}

function fusionner(etat: Etat, a: number, b: number) {
  if (a === b) throw new ErreurEdition('Choisis une autre parcelle.');
  const XA = contour(etat, a);
  const XB = contour(etat, b);
  const ea = etat.anneaux[XA]!;
  const eb = etat.anneaux[XB]!;
  const plan = planLocal(latLon(ea.sommets[0]!));
  const A = ea.sommets.map((s) => plan.versXY(latLon(s)));
  const B = eb.sommets.map((s) => plan.versXY(latLon(s)));
  const { i, j, bi, bj } = limiteCommune(A, B);
  const n = A.length;
  const m = B.length;
  // Les sommets à l'intérieur de la limite commune disparaissent : refusé s'ils servent à une
  // troisième parcelle.
  for (let k = (i + 1) % n; k !== j; k = (k + 1) % n) {
    const autres = sommetsEn(etat, latLon(ea.sommets[k]!)).filter(
      (r) => r.anneau !== XA && r.anneau !== XB,
    );
    if (autres.length > 0) {
      throw new ErreurEdition('La limite commune passe par un point d’une troisième parcelle.');
    }
  }
  // Contour fusionné, dans le sens de A : A de j à i (hors limite commune), puis B au-delà.
  // Tour de B hors de la limite commune : depuis bi (= A[i]), dans le sens où le sommet suivant
  // n'est pas sur le contour de A, jusqu'à bj (= A[j]).
  const horsDeA = (k: number) => distanceAuContour(B[k]!, A) > TOLERANCE_PARTAGE_M;
  const pas = horsDeA((bi + 1) % m) ? 1 : horsDeA((bi - 1 + m) % m) ? -1 : 0;
  if (pas === 0) throw new ErreurEdition('Limite commune illisible : fusion impossible ici.');
  const seq: { s: Sommet; src: number | null }[] = [];
  for (let k = j; ; k = (k + 1) % n) {
    seq.push({ s: ea.sommets[k]!, src: k });
    if (k === i) break;
  }
  for (let k = (bi + pas + m) % m, t = 0; k !== bj; k = (k + pas + m) % m, t++) {
    if (t > m) throw new ErreurEdition('Limite commune illisible : fusion impossible ici.');
    const s = eb.sommets[k]!;
    seq.push({ s: { lat: s.lat, lon: s.lon, origine: null }, src: null });
  }
  // Le premier point du fichier (ligne « start ») reste en tête ; s'il était dans la limite
  // commune, le point qui suit prend sa ligne.
  let rang = seq.findIndex((e) => e.src === 0);
  let sommets: Sommet[];
  if (rang >= 0) {
    sommets = [...seq.slice(rang), ...seq.slice(0, rang)].map((e) => e.s);
  } else {
    rang = 0;
    sommets = seq.map((e) => e.s);
    if (ea.sommets[0]!.origine) sommets[0] = { ...sommets[0]!, origine: ea.sommets[0]!.origine };
  }
  if (sommets.length < 3) throw new ErreurEdition('Le contour fusionné aurait moins de 3 points.');
  return { XA, XB, sommets };
}

/** Fusionne `b` dans `a` (voir en tête du fichier). */
export function fusionnerParcelles(_td: TaskData, etat: Etat, a: number, b: number): Etat {
  const { XA, sommets } = fusionner(etat, a, b);
  // Zones exclues de b : reprises par a (nouveaux anneaux).
  const zonesB = etat.anneaux
    .filter((x, i) => x.parcelle === b && x.type === 2 && !anneauIgnore(etat, i))
    .map((x) => ({
      parcelle: a,
      anneau: -1,
      type: 2 as const,
      nbOrigine: 0,
      sommets: x.sommets.map((s) => ({ lat: s.lat, lon: s.lon, origine: null })),
    }));
  const avecContour: Etat = {
    ...etat,
    anneaux: etat.anneaux.map((x, i) => (i === XA ? { ...x, sommets } : x)),
  };
  const sansB = supprimerParcelle(avecContour, b);
  return { ...sansB, anneaux: [...sansB.anneaux, ...zonesB] };
}
