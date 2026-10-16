// Optimisation du guidage appliquée à une parcelle de l'éditeur : contour, zones exclues et
// obstacles passent dans un plan local, les propositions en reviennent en lignes de guidage.

import { pointDansPolygone, planLocal, type LatLon, type Plan, type XY } from '../geometrie/plan';
import { proposerPassages, type Proposition } from '../geometrie/passages';
import { latLon, type Etat, type Guidage } from './etat';
import { lignesDeParcelle } from './guidages';

/** Outil retenu sur l'appareil : nom (devient le nom des lignes), largeur et tournière (m). */
export interface Outil {
  nom: string;
  largeur: number;
  tourniere: number;
}

export interface Optimisation {
  plan: Plan;
  propositions: Proposition[];
  /** Obstacles retenus (dans la parcelle), dans l'ordre de `Proposition.obstacles`. */
  obstacles: LatLon[];
}

/** Propositions de passages pour la parcelle `p` (contour extérieur), de la meilleure à la moins bonne. */
export function optimiserParcelle(
  etat: Etat,
  p: number,
  obstacles: readonly LatLon[],
  outil: Outil,
  seuilCoins = 30,
): Optimisation | null {
  const ext = etat.anneaux.find((a) => a.parcelle === p && a.type === 1);
  if (!ext || outil.largeur <= 0) return null;
  const plan = planLocal(latLon(ext.sommets[0]!));
  const xy = (s: { lat: number; lon: number }) => plan.versXY([s.lat, s.lon]);
  const contour = ext.sommets.map(xy);
  const trous = etat.anneaux
    .filter((a) => a.parcelle === p && a.type === 2)
    .map((a) => a.sommets.map(xy));
  const dedans = obstacles.filter((o) => pointDansPolygone(plan.versXY(o), contour));
  const propositions = proposerPassages(
    contour,
    trous,
    dedans.map((o) => plan.versXY(o)),
    { largeur: outil.largeur, tourniere: outil.tourniere },
    seuilCoins,
  );
  return { plan, propositions, obstacles: dedans };
}

/** Ligne AB d'une proposition, en ligne de guidage de la parcelle `p`. */
export function ligneDeProposition(p: number, prop: Proposition, plan: Plan, nom: string): Guidage {
  return { parcelle: p, type: 'ab', nom, points: prop.ab.map((q: XY) => plan.versLatLon(q)) };
}

/**
 * Tours de tournière : une ligne par côté de la parcelle (droite AB ou courbe), décalée vers
 * l'intérieur d'une demi-largeur, puis d'une largeur de plus à chaque tour, autant de tours qu'il
 * en faut pour couvrir la tournière (pulvé 38 m, tournière 38 m : un tour à 19 m du bord).
 */
export function lignesTourniere(etat: Etat, p: number, outil: Outil, seuilCoins = 30): Guidage[] {
  if (outil.tourniere <= 0 || outil.largeur <= 0) return [];
  const tours = Math.max(1, Math.ceil(outil.tourniere / outil.largeur - 0.01));
  const lignes: Guidage[] = [];
  for (let i = 0; i < tours; i++) {
    const r = lignesDeParcelle(etat, p, {
      distance: (i + 0.5) * outil.largeur,
      interieur: true,
      seuil: seuilCoins,
      base: outil.nom,
    });
    lignes.push(...(r?.lignes ?? []));
  }
  return lignes;
}

/**
 * Lignes créées par l'optimisation : la ligne AB des passages (« outil 1 »), puis les tours de
 * tournière (« outil 2 », « outil 3 »…), toutes du même jeu pour être remplacées ensemble.
 */
export function lignesOptimisees(
  etat: Etat,
  p: number,
  prop: Proposition,
  plan: Plan,
  outil: Outil,
  avecTourniere: boolean,
  seuilCoins = 30,
): Guidage[] {
  const toutes = [
    ligneDeProposition(p, prop, plan, ''),
    ...(avecTourniere ? lignesTourniere(etat, p, outil, seuilCoins) : []),
  ];
  return toutes.map((g, i) => ({ ...g, nom: `${outil.nom} ${i + 1}` }));
}
