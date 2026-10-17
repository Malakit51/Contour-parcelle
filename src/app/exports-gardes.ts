// Les derniers TASKDATA.XML exportés, gardés sur le téléphone : à re-télécharger si la clé est
// perdue ou si un export a été écrasé. Seulement sur cet appareil (pas dans Drive).

import { stockage } from './stockage';

const CLE = 'contour-parcelle/derniers-exports';
const NOMBRE = 5;

export interface ExportGarde {
  version: string;
  /** Date et heure de l'export (ISO). */
  quand: string;
  texte: string;
}

export function exportsGardes(): ExportGarde[] {
  try {
    const l = JSON.parse(stockage?.getItem(CLE) ?? '[]') as ExportGarde[];
    return Array.isArray(l) ? l.filter((e) => e && typeof e.texte === 'string') : [];
  } catch {
    return [];
  }
}

/** Ajoute un export en tête de liste ; les plus anciens partent s'il n'y a plus de place. */
export function garderExport(e: ExportGarde): void {
  let liste = [e, ...exportsGardes()].slice(0, NOMBRE);
  while (liste.length > 0) {
    try {
      stockage?.setItem(CLE, JSON.stringify(liste));
      return;
    } catch {
      liste = liste.slice(0, -1);
    }
  }
}
