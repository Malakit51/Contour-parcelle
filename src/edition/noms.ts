// Renommer une parcelle : le nom est écrit dans l'attribut C du PFD et B de ses PLN.

import type { TaskData } from '../isoxml/lecture';
import { estSupprimee, type Etat } from './etat';
import { ErreurEdition } from './operations';

/** Nom d'origine : celui du fichier, ou celui donné à la création dans l'éditeur. */
function nomOrigine(td: TaskData, etat: Etat, p: number): string {
  const ajoutee = etat.ajoutees?.find((a) => a.parcelle === p);
  return ajoutee?.nom ?? td.parcelles[p]!.nomFichier ?? td.parcelles[p]!.nom;
}

/**
 * Met dans `td.parcelles[p].nom` le nom à afficher pour l'état `etat` (après un renommage, une
 * annulation, une reprise de session). Le nom du fichier est gardé dans `nomFichier`.
 */
export function appliquerNoms(td: TaskData, etat: Etat): void {
  td.parcelles.forEach((p, i) => {
    const origine = nomOrigine(td, etat, i);
    if (p.nomFichier === undefined) p.nomFichier = origine;
    p.nom = etat.noms?.find((n) => n.parcelle === i)?.nom ?? origine;
  });
}

/** Renomme la parcelle `p`. Refusé : nom vide, ou déjà pris par une autre parcelle. */
export function renommer(td: TaskData, etat: Etat, p: number, nom: string): Etat {
  const propre = nom.trim().replace(/\s+/g, ' ');
  if (!propre) throw new ErreurEdition('Le nom ne peut pas être vide.');
  const pris = td.parcelles.some(
    (x, i) => i !== p && !estSupprimee(etat, i) && x.nom.toLowerCase() === propre.toLowerCase(),
  );
  if (pris) throw new ErreurEdition(`Une parcelle s’appelle déjà « ${propre} ».`);
  const autres = (etat.noms ?? []).filter((n) => n.parcelle !== p);
  const noms =
    propre === nomOrigine(td, etat, p) ? autres : [...autres, { parcelle: p, nom: propre }];
  const { noms: _, ...reste } = etat;
  return noms.length ? { ...reste, noms } : reste;
}
