// Reprendre un bord d'un ancien fichier (référence).
//
// On choisit sur la référence un chemin (de son premier à son dernier point). Le bord du contour
// actuel qui lui correspond (des sommets les plus proches de ses deux bouts, dans le sens qui le
// longe) est remplacé par ce chemin : ses deux bouts prennent la position de la référence, ses
// points intermédiaires sont ceux de la référence. Le reste du contour ne bouge pas.
//
// Pas de bande vide ni de chevauchement chez le voisin : un bout commun avec un voisin bouge aussi
// chez lui (règle 1), et si tout le bord est une limite commune (un seul segment), le voisin reçoit
// les mêmes points. Un bord qui passe par un point commun avec un voisin est refusé.

import { distancePointSegment, planLocal, type LatLon, type XY } from '../geometrie/plan';
import { latLon, limitesJumelles, sommetsEn, type Etat, type Sommet } from './etat';
import { ErreurEdition, sommetsDuBord, type Bord } from './operations';

/** Au-delà de cette distance (m) entre un bout du chemin et le contour, c'est sûrement une erreur. */
export const REPRISE_MAX_M = 20;

export interface BilanReprise {
  /** Bord du contour actuel remplacé (dans le sens de l'anneau). */
  bord: Bord;
  avant: number;
  apres: number;
  /** Plus grande distance (m) entre un point de l'ancien bord et le nouveau. */
  ecartMax: number;
  /** Anneaux voisins modifiés (bout commun déplacé ou limite commune reprise). */
  voisins: number[];
}

function distancePolyligne(p: XY, pts: readonly XY[]): number {
  let d = Infinity;
  for (let k = 0; k + 1 < pts.length; k++) {
    d = Math.min(d, distancePointSegment(p, pts[k]!, pts[k + 1]!));
  }
  return d;
}

/** Remplace, dans l'anneau `X`, le bord qui correspond au `chemin` de la référence. */
export function reprendreBord(
  etat: Etat,
  X: number,
  chemin: readonly LatLon[],
): { etat: Etat; bilan: BilanReprise } {
  if (chemin.length < 2) throw new ErreurEdition('Choisis deux points de l’ancien contour.');
  const x = etat.anneaux[X]!;
  const n = x.sommets.length;
  const plan = planLocal(chemin[0]!);
  const pts = x.sommets.map((s) => plan.versXY(latLon(s)));
  const C = chemin.map((ll) => plan.versXY(ll));

  const plusProche = (q: XY) => {
    let k = 0;
    let dMin = Infinity;
    pts.forEach((p, i) => {
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (d < dMin) [k, dMin] = [i, d];
    });
    if (dMin > REPRISE_MAX_M) {
      throw new ErreurEdition(
        `Un bout de l’ancien bord est à plus de ${REPRISE_MAX_M} m du contour actuel.`,
      );
    }
    return k;
  };
  const i = plusProche(C[0]!);
  const j = plusProche(C[C.length - 1]!);
  if (i === j) throw new ErreurEdition('Les deux bouts tombent sur le même point du contour.');

  // Sens de l'anneau qui longe le chemin de la référence.
  const ecart = (b: Bord) => {
    const ids = sommetsDuBord(etat, b);
    return ids.reduce((t, k) => t + distancePolyligne(pts[k]!, C), 0) / ids.length;
  };
  const enAvant: Bord = { anneau: X, debut: i, fin: j, aRebours: false };
  const aRebours: Bord = { anneau: X, debut: i, fin: j, aRebours: true };
  const bord = ecart(enAvant) <= ecart(aRebours) ? enAvant : aRebours;
  // Ramené à un bord parcouru dans le sens de l'anneau, de `a` à `b`, avec son chemin.
  const [a, b, chem] = bord.aRebours ? [j, i, [...chemin].reverse()] : [i, j, [...chemin]];
  const ids = sommetsDuBord(etat, { anneau: X, debut: a, fin: b, aRebours: false });

  const autres = (k: number) =>
    sommetsEn(etat, latLon(x.sommets[k]!)).filter(
      (r) => etat.anneaux[r.anneau]!.parcelle !== x.parcelle,
    );
  if (ids.slice(1, -1).some((k) => autres(k).length > 0)) {
    throw new ErreurEdition(
      'Ce bord passe par un point commun avec un voisin : arrête-le à ce point.',
    );
  }

  const anneaux = etat.anneaux.map((r) => ({ ...r, sommets: [...r.sommets] }));
  const voisins = new Set<number>();

  // Limite commune sur tout le bord (un seul segment) : le voisin reçoit les mêmes points.
  const interieur = chem.slice(1, -1);
  if (ids.length === 2 && interieur.length > 0) {
    for (const jum of limitesJumelles(etat, { anneau: X, debut: a })) {
      if (etat.anneaux[jum.anneau]!.parcelle === x.parcelle) continue;
      const r = anneaux[jum.anneau]!;
      const m = r.sommets.length;
      // On insère après celui des deux bouts de la jumelle qui précède l'autre dans son anneau,
      // dans l'ordre qui part de ce bout.
      const apres = jum.fin === (jum.debut + 1) % m ? jum.debut : jum.fin;
      const apresEnA = sommetsEn(etat, latLon(x.sommets[a]!)).some(
        (q) => q.anneau === jum.anneau && q.sommet === apres,
      );
      const ajout: Sommet[] = (apresEnA ? interieur : [...interieur].reverse()).map((ll) => ({
        lat: ll[0],
        lon: ll[1],
        origine: null,
      }));
      r.sommets.splice(apres + 1, 0, ...ajout);
      voisins.add(jum.anneau);
    }
  }

  // Les deux bouts prennent la position de la référence, chez tous ceux qui les partagent.
  for (const [k, ll] of [
    [a, chem[0]!],
    [b, chem[chem.length - 1]!],
  ] as const) {
    for (const ref of sommetsEn(etat, latLon(x.sommets[k]!))) {
      if (ref.anneau === X) continue;
      const r = anneaux[ref.anneau]!;
      // Les points ajoutés au voisin ci-dessus sont après les sommets existants : on retrouve le
      // sommet par ses coordonnées d'avant.
      const s0 = etat.anneaux[ref.anneau]!.sommets[ref.sommet]!;
      const idx = r.sommets.indexOf(s0);
      r.sommets[idx] = { ...s0, lat: ll[0], lon: ll[1] };
      if (etat.anneaux[ref.anneau]!.parcelle !== x.parcelle) voisins.add(ref.anneau);
    }
  }

  // Nouveau contour : bout a, chemin de la référence, bout b, puis le reste du contour.
  const bouge = (k: number, ll: LatLon): Sommet => ({ ...x.sommets[k]!, lat: ll[0], lon: ll[1] });
  const reste: number[] = [];
  for (let k = (b + 1) % n; k !== a; k = (k + 1) % n) reste.push(k);
  let seq: { s: Sommet; src: number | null }[] = [
    { s: bouge(a, chem[0]!), src: a },
    ...interieur.map((ll) => ({ s: { lat: ll[0], lon: ll[1], origine: null }, src: null })),
    { s: bouge(b, chem[chem.length - 1]!), src: b },
    ...reste.map((k) => ({ s: x.sommets[k]!, src: k })),
  ];
  // Le premier point du fichier (ligne « start ») reste en tête ; s'il était dans le bord, le
  // point qui suit le bout `a` prend sa ligne.
  const tete = seq.findIndex((e) => e.src === 0);
  if (tete >= 0) {
    seq = [...seq.slice(tete), ...seq.slice(0, tete)];
  } else {
    seq = [...seq.slice(1), seq[0]!];
    seq[0] = { ...seq[0]!, s: { ...seq[0]!.s, origine: x.sommets[0]!.origine } };
  }
  if (seq.length < 3) throw new ErreurEdition('Le contour aurait moins de 3 points.');
  anneaux[X] = { ...x, sommets: seq.map((e) => e.s) };

  const ecartMax = Math.max(...ids.map((k) => distancePolyligne(pts[k]!, C)));
  return {
    etat: { ...etat, anneaux },
    bilan: { bord, avant: n, apres: seq.length, ecartMax, voisins: [...voisins] },
  };
}
