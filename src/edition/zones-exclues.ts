// Création d'une zone exclue (trou dans une parcelle : poteau, mare, bosquet), écrite dans le
// fichier comme celle de 13 Jard : un LSG A="2" de plus dans le contour de la parcelle.

import { aireSignee, planLocal, pointDansPolygone, type LatLon, type XY } from '../geometrie/plan';
import { seCroisent } from './controles';
import { anneauIgnore, estSupprimee, latLon, type Etat } from './etat';
import { ErreurEdition } from './operations';

/** Plus petite zone exclue acceptée (m²). */
export const SURFACE_MIN_M2 = 1;

function croise(a: readonly XY[], b: readonly XY[]): boolean {
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (seCroisent(a[i]!, a[(i + 1) % a.length]!, b[j]!, b[(j + 1) % b.length]!)) return true;
    }
  }
  return false;
}

/**
 * Ajoute à la parcelle `parcelle` la zone exclue `zone` (sans répéter le premier point). Refusé si
 * elle se recoupe, sort du contour ou touche une autre zone exclue de la parcelle. Ses sommets
 * tournent dans le sens contraire du contour extérieur, comme la zone de 13 Jard dans le fichier.
 */
export function ajouterZoneExclue(etat: Etat, parcelle: number, zone: readonly LatLon[]): Etat {
  if (estSupprimee(etat, parcelle)) throw new ErreurEdition('Cette parcelle est retirée.');
  if (zone.length < 3) throw new ErreurEdition('Il faut au moins 3 points pour une zone exclue.');
  const ext = etat.anneaux.find((a) => a.parcelle === parcelle && a.type === 1);
  if (!ext) throw new ErreurEdition('Parcelle sans contour.');
  const plan = planLocal(latLon(ext.sommets[0]!));
  const xy = (p: LatLon): XY => plan.versXY(p);
  let pts = zone.map(xy);
  for (let k = 0; k < pts.length; k++) {
    for (let m = k + 2; m < pts.length; m++) {
      if (k === 0 && m === pts.length - 1) continue;
      if (seCroisent(pts[k]!, pts[k + 1]!, pts[m]!, pts[(m + 1) % pts.length]!)) {
        throw new ErreurEdition('La zone exclue se recoupe elle-même.');
      }
    }
  }
  if (Math.abs(aireSignee(pts)) < SURFACE_MIN_M2) {
    throw new ErreurEdition('Zone exclue trop petite (moins de 1 m²).');
  }
  const contour = ext.sommets.map((s) => xy(latLon(s)));
  if (!pts.every((p) => pointDansPolygone(p, contour)) || croise(pts, contour)) {
    throw new ErreurEdition('La zone exclue doit être entièrement dans la parcelle.');
  }
  for (const [i, a] of etat.anneaux.entries()) {
    if (a.parcelle !== parcelle || a.type !== 2 || anneauIgnore(etat, i)) continue;
    const autre = a.sommets.map((s) => xy(latLon(s)));
    if (
      croise(pts, autre) ||
      pointDansPolygone(pts[0]!, autre) ||
      pointDansPolygone(autre[0]!, pts)
    ) {
      throw new ErreurEdition('La zone exclue touche une autre zone exclue de la parcelle.');
    }
  }
  // Sens contraire du contour extérieur.
  if (Math.sign(aireSignee(pts)) === Math.sign(aireSignee(contour))) pts = [...pts].reverse();
  const sommets = pts.map((p) => {
    const [lat, lon] = plan.versLatLon(p);
    return { lat, lon, origine: null };
  });
  return {
    ...etat,
    anneaux: [...etat.anneaux, { parcelle, anneau: -1, type: 2, sommets, nbOrigine: 0 }],
  };
}
