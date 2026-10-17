// Après un export, le fichier exporté devient le fichier de départ : on le relit, et on garde
// seulement ce qu'il ne contient pas sous une forme relue par l'éditeur, les lignes de guidage
// (relues comme des LSG A="5" de la console, elles seraient sinon retirées à l'export suivant).

import { lireTaskData, type TaskData } from '../isoxml/lecture';
import { estSupprimee, etatInitial, type Etat } from './etat';

/**
 * `texte` : le fichier exporté depuis (`td`, `etat`). Renvoie le fichier relu et son état de
 * départ, avec les lignes de guidage de chaque parcelle, retrouvée par son GUID.
 */
export function repartirDe(td: TaskData, etat: Etat, texte: string): { td: TaskData; etat: Etat } {
  const nouveau = lireTaskData(texte);
  const indice = new Map(nouveau.parcelles.map((p, i) => [p.guid, i]));
  const guidages = (etat.guidages ?? []).flatMap((g) => {
    if (estSupprimee(etat, g.parcelle)) return [];
    const i = indice.get(td.parcelles[g.parcelle]!.guid);
    return i === undefined ? [] : [{ ...g, parcelle: i }];
  });
  const depart = etatInitial(nouveau);
  return { td: nouveau, etat: guidages.length > 0 ? { ...depart, guidages } : depart };
}
