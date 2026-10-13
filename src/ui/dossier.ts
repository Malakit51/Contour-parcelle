// Écriture directe d'un dossier TASKDATA contenant TASKDATA.XML, là où l'utilisateur le choisit
// (la clé USB par exemple).
//
// Repose sur l'API « File System Access » de Chrome (showDirectoryPicker). Elle existe sur
// ordinateur ; sa disponibilité sur Chrome Android n'est pas vérifiée : la page ne propose ce
// mode que si le navigateur le permet, sinon on retombe sur le téléchargement de TASKDATA.XML.

export const NOM_DOSSIER = 'TASKDATA';
export const NOM_FICHIER = 'TASKDATA.XML';

// Types minimaux : cette API ne fait pas partie des types DOM standard de TypeScript.
interface Inscriptible {
  write(donnees: Uint8Array): Promise<void>;
  close(): Promise<void>;
}
interface PoigneeFichier {
  createWritable(): Promise<Inscriptible>;
}
interface PoigneeDossier {
  name: string;
  getDirectoryHandle(nom: string, options?: { create?: boolean }): Promise<PoigneeDossier>;
  getFileHandle(nom: string, options?: { create?: boolean }): Promise<PoigneeFichier>;
}
type ChoisirDossier = (options?: { mode?: 'read' | 'readwrite' }) => Promise<PoigneeDossier>;

function choisirDossier(): ChoisirDossier | null {
  const f = (window as unknown as { showDirectoryPicker?: ChoisirDossier }).showDirectoryPicker;
  return typeof f === 'function' ? f.bind(window) : null;
}

export function ecritureDossierPossible(): boolean {
  return choisirDossier() !== null;
}

async function existe(dossier: PoigneeDossier, nom: string, sorte: 'dossier' | 'fichier') {
  try {
    if (sorte === 'dossier') await dossier.getDirectoryHandle(nom);
    else await dossier.getFileHandle(nom);
    return true;
  } catch {
    return false;
  }
}

/**
 * Demande où écrire, puis crée (ou réutilise) le dossier TASKDATA et y écrit TASKDATA.XML.
 * `confirmerRemplacement` est appelé si un TASKDATA.XML existe déjà à cet endroit.
 * Renvoie le chemin écrit, ou null si l'utilisateur a renoncé.
 */
export async function ecrireDossierTaskdata(
  contenu: Uint8Array,
  confirmerRemplacement: (chemin: string) => boolean,
): Promise<string | null> {
  const choisir = choisirDossier();
  if (!choisir) throw new Error('Ce navigateur ne permet pas d’écrire un dossier.');
  let parent: PoigneeDossier;
  try {
    parent = await choisir({ mode: 'readwrite' });
  } catch {
    return null; // choix annulé
  }
  // Si l'utilisateur a choisi directement un dossier TASKDATA, on écrit dedans.
  const dejaTaskdata = parent.name.toUpperCase() === NOM_DOSSIER;
  const chemin = dejaTaskdata
    ? `${parent.name}/${NOM_FICHIER}`
    : `${parent.name}/${NOM_DOSSIER}/${NOM_FICHIER}`;
  const dossierExiste = dejaTaskdata || (await existe(parent, NOM_DOSSIER, 'dossier'));
  const dossier = dejaTaskdata
    ? parent
    : await parent.getDirectoryHandle(NOM_DOSSIER, { create: true });
  if (dossierExiste && (await existe(dossier, NOM_FICHIER, 'fichier'))) {
    if (!confirmerRemplacement(chemin)) return null;
  }
  const fichier = await dossier.getFileHandle(NOM_FICHIER, { create: true });
  const sortie = await fichier.createWritable();
  await sortie.write(contenu);
  await sortie.close();
  return chemin;
}
