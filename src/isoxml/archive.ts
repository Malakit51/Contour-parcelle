// Lecture et écriture du zip exporté par la console : on ne remplace que TASKDATA.XML, tous les
// autres fichiers (.BIN, TLG, TASK-*.CM…) sont recopiés tels quels, avec le même chemin.

import { unzipSync, zipSync } from 'fflate';

export interface Archive {
  /** Contenu de chaque fichier, par chemin dans le zip (dossiers exclus), dans l'ordre du zip. */
  fichiers: Record<string, Uint8Array>;
  /** Chemin de TASKDATA.XML dans le zip, par exemple « TASKDATA/TASKDATA.XML ». */
  cheminTaskdata: string;
}

export class ErreurArchive extends Error {
  override name = 'ErreurArchive';
}

/** Vrai si les octets commencent comme un fichier zip (« PK\x03\x04 »). */
export function estUnZip(octets: Uint8Array): boolean {
  return octets[0] === 0x50 && octets[1] === 0x4b && octets[2] === 0x03 && octets[3] === 0x04;
}

export function ouvrirArchive(octets: Uint8Array): Archive {
  let tout: Record<string, Uint8Array>;
  try {
    tout = unzipSync(octets);
  } catch (e) {
    throw new ErreurArchive(`Zip illisible : ${(e as Error).message}`);
  }
  const fichiers: Record<string, Uint8Array> = {};
  for (const [chemin, contenu] of Object.entries(tout)) {
    if (!chemin.endsWith('/')) fichiers[chemin] = contenu;
  }
  const candidats = Object.keys(fichiers).filter((c) => /(^|\/)TASKDATA\.XML$/i.test(c));
  if (candidats.length === 0) throw new ErreurArchive('Aucun fichier TASKDATA.XML dans ce zip.');
  if (candidats.length > 1) {
    throw new ErreurArchive(`Plusieurs TASKDATA.XML dans ce zip : ${candidats.join(', ')}.`);
  }
  return { fichiers, cheminTaskdata: candidats[0]! };
}

export function taskdataDe(archive: Archive): Uint8Array {
  return archive.fichiers[archive.cheminTaskdata]!;
}

/** Nouveau zip : mêmes fichiers, même ordre, TASKDATA.XML remplacé. */
export function refaireArchive(archive: Archive, taskdata: Uint8Array): Uint8Array {
  const fichiers: Record<string, Uint8Array> = {};
  for (const [chemin, contenu] of Object.entries(archive.fichiers)) {
    fichiers[chemin] = chemin === archive.cheminTaskdata ? taskdata : contenu;
  }
  return zipSync(fichiers, { level: 6 });
}
