// Export d'un TASKDATA.XML : on part du texte d'origine et on ne remplace que les valeurs modifiées.

import type { Parcelle, Plage, Point, TaskData, ValeurBrute } from './lecture';

export interface Changements {
  /** Nouvelles coordonnées, en degrés décimaux. */
  points?: ReadonlyArray<{ point: Point; lat: number; lon: number }>;
  /** Nouvelles surfaces, en m². */
  surfaces?: ReadonlyArray<{ parcelle: Parcelle; m2: number }>;
  /** Retire les segments LSG A="5" (oui par défaut). */
  retirerSegments?: boolean;
}

interface Remplacement {
  plage: Plage;
  texte: string;
}

/** Écrit `valeur` avec autant de décimales que la valeur d'origine. */
export function formaterComme(valeur: number, origine: ValeurBrute): string {
  const decimales = origine.texte.split('.')[1]?.length ?? 0;
  return valeur.toFixed(decimales);
}

export function remplacer(texte: string, remplacements: Remplacement[]): string {
  const tries = [...remplacements].sort((a, b) => a.plage.debut - b.plage.debut);
  let resultat = '';
  let curseur = 0;
  for (const r of tries) {
    if (r.plage.debut < curseur) {
      throw new Error(`Deux modifications se chevauchent (position ${r.plage.debut}).`);
    }
    resultat += texte.slice(curseur, r.plage.debut) + r.texte;
    curseur = r.plage.fin;
  }
  return resultat + texte.slice(curseur);
}

export function exporterTaskData(td: TaskData, changements: Changements = {}): string {
  const remplacements: Remplacement[] = [];
  for (const { point, lat, lon } of changements.points ?? []) {
    remplacements.push({ plage: point.latBrute.plage, texte: formaterComme(lat, point.latBrute) });
    remplacements.push({ plage: point.lonBrute.plage, texte: formaterComme(lon, point.lonBrute) });
  }
  for (const { parcelle, m2 } of changements.surfaces ?? []) {
    if (!parcelle.surface) continue;
    remplacements.push({ plage: parcelle.surface.plage, texte: String(Math.round(m2)) });
  }
  if (changements.retirerSegments ?? true) {
    for (const plage of td.segmentsIgnores) remplacements.push({ plage, texte: '' });
  }
  return remplacer(td.texte, remplacements);
}
