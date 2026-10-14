// Numéro de version de l'application, pour voir qu'une mise à jour est arrivée.

import { ui } from './etat';
import { ecrireStockage, lireStockage } from './stockage';

declare const __VERSION__: string;
declare const __DATE_VERSION__: string;

export const VERSION = __VERSION__;
export const TEXTE_VERSION = `Application : version ${__VERSION__} du ${__DATE_VERSION__}`;

const CLE_VERSION_VUE = 'contour-parcelle/version-vue';

/** Au démarrage : annonce la mise à jour si cet appareil avait vu une autre version. */
export function annoncerMiseAJour(): void {
  const vue = lireStockage(CLE_VERSION_VUE);
  ecrireStockage(CLE_VERSION_VUE, VERSION);
  if (vue === null || vue === VERSION) return;
  const avant = ui.message;
  ui.message = {
    texte: `Application mise à jour : version ${VERSION}.` + (avant ? ` ${avant.texte}` : ''),
    erreur: avant?.erreur ?? false,
  };
}
