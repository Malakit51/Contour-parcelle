// Export d'un TASKDATA.XML : on part du texte d'origine et on ne remplace que les valeurs modifiées.

import type { Parcelle, Plage, Point, TaskData, ValeurBrute } from './lecture';

export interface Changements {
  /** Nouvelles coordonnées, en degrés décimaux. */
  points?: ReadonlyArray<{ point: Point; lat: number; lon: number }>;
  /** Points ajoutés, écrits sur de nouvelles lignes juste après la ligne du point `apres`. */
  insertions?: ReadonlyArray<{ apres: Point; points: ReadonlyArray<{ lat: number; lon: number }> }>;
  /** Points retirés : leur ligne entière disparaît. */
  suppressions?: ReadonlyArray<Point>;
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
  const tries = [...remplacements].sort(
    (a, b) => a.plage.debut - b.plage.debut || a.plage.fin - b.plage.fin,
  );
  let resultat = '';
  let curseur = 0;
  let precedent: Plage | null = null;
  for (const r of tries) {
    // Deux insertions au même endroit : leur ordre serait arbitraire, on refuse.
    const memeInsertion =
      precedent !== null &&
      precedent.debut === precedent.fin &&
      r.plage.debut === r.plage.fin &&
      r.plage.debut === precedent.debut;
    if (r.plage.debut < curseur || memeInsertion) {
      throw new Error(`Deux modifications se chevauchent (position ${r.plage.debut}).`);
    }
    precedent = r.plage;
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
  for (const { apres, points } of changements.insertions ?? []) {
    const debutLigne = td.texte.lastIndexOf('\n', apres.balise.debut - 1) + 1;
    const finLigne = td.texte.indexOf('\n', apres.balise.fin);
    if (finLigne < 0) throw new Error('Point en dernière ligne du fichier : insertion impossible.');
    // Modèle : la ligne du point précédent, sans son attribut B (start / end).
    const modele = td.texte.slice(debutLigne, finLigne + 1).replace(/\sB="[^"]*"/, '');
    const texte = points
      .map(({ lat, lon }) =>
        modele
          .replace(/(\sC=")[^"]*"/, `$1${formaterComme(lat, apres.latBrute)}"`)
          .replace(/(\sD=")[^"]*"/, `$1${formaterComme(lon, apres.lonBrute)}"`),
      )
      .join('');
    remplacements.push({ plage: { debut: finLigne + 1, fin: finLigne + 1 }, texte });
  }
  for (const point of changements.suppressions ?? []) {
    const debutLigne = td.texte.lastIndexOf('\n', point.balise.debut - 1) + 1;
    const finLigne = td.texte.indexOf('\n', point.balise.fin);
    const fin = finLigne < 0 ? td.texte.length : finLigne + 1;
    remplacements.push({ plage: { debut: debutLigne, fin }, texte: '' });
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
