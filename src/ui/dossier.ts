// Écriture directe d'un dossier (« TASKDATA 0.12 »…) contenant TASKDATA.XML, là où l'utilisateur le choisit
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
type Permission = 'granted' | 'denied' | 'prompt';
interface PoigneeDossier {
  name: string;
  queryPermission?(options: { mode: 'readwrite' }): Promise<Permission>;
  requestPermission?(options: { mode: 'readwrite' }): Promise<Permission>;
  getDirectoryHandle(nom: string, options?: { create?: boolean }): Promise<PoigneeDossier>;
  getFileHandle(nom: string, options?: { create?: boolean }): Promise<PoigneeFichier>;
}
type ChoisirDossier = (options?: {
  id?: string;
  mode?: 'read' | 'readwrite';
}) => Promise<PoigneeDossier>;

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

// ---------- Emplacement mémorisé (la clé USB) ----------
//
// Le dossier choisi est gardé en mémoire, et dans le navigateur (IndexedDB, seul stockage qui sait
// garder ce type d'objet) pour les ouvertures suivantes de la page : les exports suivants y
// écrivent sans rouvrir le sélecteur. Chrome peut redemander l'autorisation d'un appui.

let emplacement: PoigneeDossier | null = null;
const BASE = 'contour-parcelle';
const TABLE = 'emplacements';

function ouvrirBase(): Promise<IDBDatabase> {
  return new Promise((resoudre, rejeter) => {
    const r = indexedDB.open(BASE, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(TABLE);
    r.onsuccess = () => resoudre(r.result);
    r.onerror = () => rejeter(r.error);
  });
}

async function memoriser(p: PoigneeDossier | null): Promise<void> {
  emplacement = p;
  try {
    const base = await ouvrirBase();
    const t = base.transaction(TABLE, 'readwrite');
    if (p) t.objectStore(TABLE).put(p, 'cle-usb');
    else t.objectStore(TABLE).delete('cle-usb');
  } catch {
    // Pas d'IndexedDB (navigation privée…) : on garde seulement en mémoire.
  }
}

async function relireEmplacement(): Promise<PoigneeDossier | null> {
  if (emplacement) return emplacement;
  try {
    const base = await ouvrirBase();
    emplacement = await new Promise<PoigneeDossier | null>((resoudre) => {
      const r = base.transaction(TABLE).objectStore(TABLE).get('cle-usb');
      r.onsuccess = () => resoudre((r.result as PoigneeDossier | undefined) ?? null);
      r.onerror = () => resoudre(null);
    });
  } catch {
    emplacement = null;
  }
  return emplacement;
}

/** Nom de l'emplacement mémorisé (pour l'afficher), ou null. */
export async function nomEmplacement(): Promise<string | null> {
  return (await relireEmplacement())?.name ?? null;
}

export async function oublierEmplacement(): Promise<void> {
  await memoriser(null);
}

/** L'emplacement mémorisé, si Chrome autorise encore à y écrire (demande d'un appui sinon). */
async function emplacementAutorise(): Promise<PoigneeDossier | null> {
  const p = await relireEmplacement();
  if (!p) return null;
  try {
    let etat = (await p.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
    if (etat === 'prompt') etat = (await p.requestPermission?.({ mode: 'readwrite' })) ?? 'denied';
    return etat === 'granted' ? p : null;
  } catch {
    return null;
  }
}

/**
 * Demande où écrire, puis crée (ou réutilise) le dossier TASKDATA et y écrit TASKDATA.XML.
 * `confirmerRemplacement` est appelé si un TASKDATA.XML existe déjà à cet endroit.
 * Renvoie le chemin écrit, ou null si l'utilisateur a renoncé.
 */
export async function ecrireDossierTaskdata(
  contenu: Uint8Array,
  nomDossier: string,
  confirmerRemplacement: (chemin: string) => boolean,
): Promise<string | null> {
  const choisir = choisirDossier();
  if (!choisir) throw new Error('Ce navigateur ne permet pas d’écrire un dossier.');
  // D'abord l'emplacement mémorisé (sans sélecteur) ; s'il a disparu (clé débranchée…), on
  // retombe sur le sélecteur.
  const memorise = await emplacementAutorise();
  if (memorise) {
    try {
      return await ecrireDans(memorise, contenu, nomDossier, confirmerRemplacement);
    } catch {
      await memoriser(null);
    }
  }
  let parent: PoigneeDossier;
  try {
    // « id » : Chrome rouvre le sélecteur au dernier endroit choisi (la clé USB).
    parent = await choisir({ id: 'cle-usb', mode: 'readwrite' });
  } catch {
    return null; // choix annulé
  }
  const chemin = await ecrireDans(parent, contenu, nomDossier, confirmerRemplacement);
  await memoriser(parent);
  return chemin;
}

async function ecrireDans(
  parent: PoigneeDossier,
  contenu: Uint8Array,
  nomDossier: string,
  confirmerRemplacement: (chemin: string) => boolean,
): Promise<string | null> {
  // Si l'utilisateur a choisi directement le dossier à écrire, on écrit dedans.
  const dejaLa = parent.name === nomDossier;
  const chemin = dejaLa
    ? `${parent.name}/${NOM_FICHIER}`
    : `${parent.name}/${nomDossier}/${NOM_FICHIER}`;
  const dossierExiste = dejaLa || (await existe(parent, nomDossier, 'dossier'));
  const dossier = dejaLa ? parent : await parent.getDirectoryHandle(nomDossier, { create: true });
  if (dossierExiste && (await existe(dossier, NOM_FICHIER, 'fichier'))) {
    if (!confirmerRemplacement(chemin)) return null;
  }
  const fichier = await dossier.getFileHandle(NOM_FICHIER, { create: true });
  const sortie = await fichier.createWritable();
  await sortie.write(contenu);
  await sortie.close();
  return chemin;
}
