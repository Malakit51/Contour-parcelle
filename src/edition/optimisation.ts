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
  if (!ext || outil.largeur <= 0 || etat.supprimees?.includes(p)) return null;
  const plan = planLocal(latLon(ext.sommets[0]!));
  const xy = (s: { lat: number; lon: number }) => plan.versXY([s.lat, s.lon]);
  const contour = ext.sommets.map(xy);
  const trous = etat.anneaux
    .filter((a, i) => a.parcelle === p && a.type === 2 && !etat.zonesRetirees?.includes(i))
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

/** Noms explicites, pour s'y retrouver dans la console : « Ligne AB Pulvé 38 m », « Fourrière Pulvé 38 m 1 »… */
export const nomLigneAB = (outil: Outil) => `Ligne AB ${outil.nom}`;
export const nomFourriere = (outil: Outil, n: number) => `Fourrière ${outil.nom} ${n}`;

/**
 * Lignes créées par l'optimisation : la ligne AB des passages (« Ligne AB Pulvé 38 m »), puis les
 * tours de tournière (« Fourrière Pulvé 38 m 1 », « Fourrière Pulvé 38 m 2 »…).
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
  return [
    ligneDeProposition(p, prop, plan, nomLigneAB(outil)),
    ...(avecTourniere ? lignesTourniere(etat, p, outil, seuilCoins) : []).map((g, i) => ({
      ...g,
      nom: nomFourriere(outil, i + 1),
    })),
  ];
}

/**
 * Remplace, sur la parcelle `p`, les lignes déjà créées par l'optimisation pour cet outil (ligne
 * AB, fourrière, et anciens noms « Pulvé 38 m 1 »…) par `lignes`. Les autres lignes restent.
 */
export function remplacerLignesOutil(
  etat: Etat,
  p: number,
  outil: Outil,
  lignes: readonly Guidage[],
): Etat {
  const fourriere = `Fourrière ${outil.nom} `;
  const ancien = new RegExp(`^${outil.nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\d+$`);
  const gardees = (etat.guidages ?? []).filter(
    (g) =>
      g.parcelle !== p ||
      !(
        g.nom === nomLigneAB(outil) ||
        (g.nom.startsWith(fourriere) && /\d+$/.test(g.nom)) ||
        ancien.test(g.nom)
      ),
  );
  return { ...etat, guidages: [...gardees, ...lignes] };
}
