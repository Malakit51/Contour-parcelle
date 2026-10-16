// Optimisation du guidage appliquée à une parcelle de l'éditeur : contour, zones exclues et
// obstacles passent dans un plan local, les propositions en reviennent en lignes de guidage.

import { pointDansPolygone, planLocal, type LatLon, type Plan, type XY } from '../geometrie/plan';
import { proposerPassages, type Proposition } from '../geometrie/passages';
import { latLon, type Etat, type Guidage } from './etat';

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
