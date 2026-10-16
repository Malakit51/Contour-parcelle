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
  await garderPoignee('cle-usb', p);
}

async function garderPoignee(cle: string, p: PoigneeDossier | null): Promise<void> {
  try {
    const base = await ouvrirBase();
    const t = base.transaction(TABLE, 'readwrite');
    if (p) t.objectStore(TABLE).put(p, cle);
    else t.objectStore(TABLE).delete(cle);
  } catch {
    // Pas d'IndexedDB (navigation privée…) : on garde seulement en mémoire.
  }
}

async function relirePoignee(cle: string): Promise<PoigneeDossier | null> {
  try {
    const base = await ouvrirBase();
    return await new Promise<PoigneeDossier | null>((resoudre) => {
      const r = base.transaction(TABLE).objectStore(TABLE).get(cle);
      r.onsuccess = () => resoudre((r.result as PoigneeDossier | undefined) ?? null);
      r.onerror = () => resoudre(null);
    });
  } catch {
    return null;
  }
}

/** La poignée, si Chrome autorise encore à y écrire (demande d'un appui sinon). */
async function autorisee(p: PoigneeDossier | null): Promise<PoigneeDossier | null> {
  if (!p) return null;
  try {
    let etat = (await p.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
    if (etat === 'prompt') etat = (await p.requestPermission?.({ mode: 'readwrite' })) ?? 'denied';
    return etat === 'granted' ? p : null;
  } catch {
    return null;
  }
}

async function relireEmplacement(): Promise<PoigneeDossier | null> {
  if (emplacement) return emplacement;
  emplacement = await relirePoignee('cle-usb');
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
  return autorisee(await relireEmplacement());
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
  // Un dossier TASKDATA n'est pas un emplacement : on écrirait TASKDATA 0.12/TASKDATA 0.13/…, que
  // la console ne lirait pas. (Un tel emplacement a pu être mémorisé par une version précédente.)
  let memorise = await emplacementAutorise();
  if (memorise && estDossierTaskdata(memorise.name)) {
    await memoriser(null);
    memorise = null;
  }
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
  if (estDossierTaskdata(parent.name)) {
    throw new Error(
      `tu as choisi le dossier « ${parent.name} ». Choisis la clé USB elle-même (sa racine) : l’éditeur y crée le dossier « ${nomDossier} ».`,
    );
  }
  const chemin = await ecrireDans(parent, contenu, nomDossier, confirmerRemplacement);
  await memoriser(parent);
  return chemin;
}

/** Vrai pour un dossier « TASKDATA », « TASKDATA 0.12 »… */
export const estDossierTaskdata = (nom: string) => /^taskdata/i.test(nom.trim());

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

// ---------- Dossier des sauvegardes (« Contour parcelle » sur le téléphone) ----------
//
// Choisi une fois : CSV du suivi et du journal, sauvegardes .json y sont écrits directement au lieu
// d'aller dans Téléchargements (un téléchargement ne peut pas choisir de sous-dossier).

export const DOSSIER_SAUVEGARDES = 'Contour parcelle';
const CLE_SAUVEGARDES = 'sauvegardes';
let sauvegardes: PoigneeDossier | null | undefined;

async function dossierSauvegardes(): Promise<PoigneeDossier | null> {
  if (sauvegardes === undefined) sauvegardes = await relirePoignee(CLE_SAUVEGARDES);
  return sauvegardes;
}

/** Nom du dossier des sauvegardes mémorisé, ou null. */
export async function nomDossierSauvegardes(): Promise<string | null> {
  return (await dossierSauvegardes())?.name ?? null;
}

/**
 * Ouvre le sélecteur : à l'endroit choisi, crée (ou réutilise) le dossier « Contour parcelle » et
 * le retient. Si on choisit directement un dossier « Contour parcelle », il sert tel quel.
 * Renvoie le chemin affichable (« Documents/Contour parcelle »), ou null si on a renoncé.
 */
export async function choisirDossierSauvegardes(): Promise<string | null> {
  const choisir = choisirDossier();
  if (!choisir) throw new Error('Ce navigateur ne permet pas d’écrire dans un dossier.');
  let parent: PoigneeDossier;
  try {
    parent = await choisir({ id: 'sauvegardes', mode: 'readwrite' });
  } catch {
    return null; // choix annulé
  }
  const dejaLa = parent.name.trim().toLowerCase() === DOSSIER_SAUVEGARDES.toLowerCase();
  const dossier = dejaLa
    ? parent
    : await parent.getDirectoryHandle(DOSSIER_SAUVEGARDES, { create: true });
  sauvegardes = dossier;
  await garderPoignee(CLE_SAUVEGARDES, dossier);
  return dejaLa ? parent.name : `${parent.name}/${DOSSIER_SAUVEGARDES}`;
}

export async function oublierDossierSauvegardes(): Promise<void> {
  sauvegardes = null;
  await garderPoignee(CLE_SAUVEGARDES, null);
}

/**
 * Écrit (ou remplace) `nom` dans le dossier des sauvegardes. Renvoie le chemin écrit, ou null si
 * aucun dossier n'est choisi ou s'il n'est plus accessible (à l'appelant de télécharger alors).
 */
export async function ecrireDansSauvegardes(
  contenu: Uint8Array,
  nom: string,
): Promise<string | null> {
  const dossier = await autorisee(await dossierSauvegardes());
  if (!dossier) return null;
  try {
    const fichier = await dossier.getFileHandle(nom, { create: true });
    const sortie = await fichier.createWritable();
    await sortie.write(contenu);
    await sortie.close();
    return `${dossier.name}/${nom}`;
  } catch {
    return null;
  }
}
