// Export pour la clé USB : la console attend un dossier « TASKDATA » contenant TASKDATA.XML.
//
// Un navigateur ne peut pas créer de dossier dans les téléchargements. On produit donc
// TASKDATA.zip, qui contient seulement TASKDATA.XML : en le décompressant, le gestionnaire de
// fichiers d'Android crée en général un dossier du nom du zip, soit « TASKDATA ».

import { zipSync } from 'fflate';

export const NOM_DOSSIER = 'TASKDATA';

export function zipDossierTaskdata(taskdata: Uint8Array): Uint8Array {
  return zipSync({ 'TASKDATA.XML': taskdata }, { level: 6 });
}
