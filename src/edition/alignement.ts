// Alignement des points voisins d'un sommet : quand on recale un coin, le point qui reste sur un
// bord doit être pile sur la droite qui va du coin au point d'après.

import { distancePointDroite } from './alignement-calcul';
import { latLon, type Etat, type RefSommet } from './etat';
import { planLocal } from '../geometrie/plan';

/** Écarts (m) en dessous desquels le point est aligné (vert), presque aligné (orange). */
export const ALIGNE_M = 0.05;
export const PRESQUE_M = 0.3;
/** Au-delà, le point voisin est un vrai coin : pas d'indicateur. */
export const COIN_M = 5;

export interface Alignement {
  /** Point voisin du sommet sur le bord. */
  point: number;
  /** Point d'après, qui donne la direction du bord avec le sommet. */
  suivant: number;
  /** Distance (m) du point voisin à la droite sommet → point d'après. */
  ecart: number;
  /** Vrai pour le voisin dans le sens de l'anneau. */
  apres: boolean;
}

export function alignements(etat: Etat, ref: RefSommet): Alignement[] {
  const sommets = etat.anneaux[ref.anneau]!.sommets;
  const n = sommets.length;
  if (n < 4) return [];
  const plan = planLocal(latLon(sommets[ref.sommet]!));
  const xy = (i: number) => plan.versXY(latLon(sommets[(i + n) % n]!));
  const v = xy(ref.sommet);
  const resultat: Alignement[] = [];
  for (const sens of [1, -1]) {
    const p = (ref.sommet + sens + n) % n;
    const q = (ref.sommet + 2 * sens + n) % n;
    const ecart = distancePointDroite(xy(p), v, xy(q));
    if (ecart === null || ecart > COIN_M) continue;
    resultat.push({ point: p, suivant: q, ecart, apres: sens === 1 });
  }
  return resultat;
}

export const niveauAlignement = (ecart: number) =>
  ecart <= ALIGNE_M ? 'aligne' : ecart <= PRESQUE_M ? 'presque' : 'decale';
