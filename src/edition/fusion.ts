// Fusionner deux parcelles voisines : la parcelle `a` garde son nom, ses tâches, ses lignes de
// guidage et ses points du fichier ; elle reprend le contour de `b` au-delà de leur limite
// commune. `b` est retirée du fichier (avec ses tâches), ses zones exclues passent à `a`.

import { planLocal, type LatLon, type XY } from '../geometrie/plan';
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

/**
 * Indices de la limite commune dans `A` (sommets consécutifs aussi dans `B`, à 2 cm près), de
 * `i` à `j` dans le sens de `A`, et leurs correspondants dans `B`.
 */
function limiteCommune(A: XY[], B: XY[]): { i: number; j: number; bi: number; bj: number } {
  const n = A.length;
  const dans = A.map((p) =>
    B.findIndex((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) <= TOLERANCE_PARTAGE_M),
  );
  const communs = dans.filter((k) => k >= 0).length;
  if (communs < 2) {
    throw new ErreurEdition(
      'Ces deux parcelles n’ont pas de limite commune : colle d’abord l’une sur l’autre (« Coller au voisin »).',
    );
  }
  if (communs === n) throw new ErreurEdition('Ces deux parcelles ont le même contour.');
  // Début de la limite : un sommet commun dont le précédent ne l'est pas.
  const debuts = A.map((_, k) => k).filter((k) => dans[k]! >= 0 && dans[(k - 1 + n) % n]! < 0);
  if (debuts.length !== 1) {
    throw new ErreurEdition(
      'Ces deux parcelles se touchent à plusieurs endroits : fusion impossible ici.',
    );
  }
  const i = debuts[0]!;
  let j = i;
  while (dans[(j + 1) % n]! >= 0) j = (j + 1) % n;
  return { i, j, bi: dans[i]!, bj: dans[j]! };
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
  // Sens de B le long de la limite (de A[i] vers A[j]) : celui où le voisin de bi dans B est
  // A[i+1] ; on part donc de bi dans l'autre sens pour faire le tour de B hors limite.
  const voisinA = A[(i + 1) % n]!;
  const avance = B[(bi + 1) % m]!;
  const bLongeEnAvancant =
    Math.hypot(avance[0] - voisinA[0], avance[1] - voisinA[1]) <= TOLERANCE_PARTAGE_M;
  const pas = bLongeEnAvancant ? -1 : 1;
  const seq: { s: Sommet; src: number | null }[] = [];
  for (let k = j; ; k = (k + 1) % n) {
    seq.push({ s: ea.sommets[k]!, src: k });
    if (k === i) break;
  }
  for (let k = (bi + pas + m) % m; k !== bj; k = (k + pas + m) % m) {
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
