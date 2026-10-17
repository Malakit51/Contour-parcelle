// Session de travail : le fichier ouvert et les contours modifiés, sous une forme qu'on peut
// enregistrer (sur le téléphone, ou dans Google Drive) puis recharger à l'identique.

import type { AnneauEdite, Etat, Guidage, ParcelleAjoutee, Sommet } from '../edition/etat';
import { completerParcelles } from '../edition/parcelles-ajoutees';
import { lireTaskData, type TaskData } from '../isoxml/lecture';
import type { Suivi } from '../suivi/suivi';

export interface SessionEnregistree {
  version: 1;
  /** Date et heure de l'enregistrement (ISO). */
  enregistreLe: string;
  /** Nom de l'appareil qui a enregistré (« téléphone », « tablette »…). */
  appareil: string;
  fichier: { nom: string; texte: string };
  /**
   * Sommets de chaque anneau : [lat, lon, indice du point d'origine dans l'anneau du fichier, ou
   * null pour un point ajouté par l'éditeur].
   */
  anneaux: {
    parcelle: number;
    anneau: number;
    /** Type d'un anneau créé dans l'éditeur (anneau -1) ; sinon celui du fichier. */
    type?: 1 | 2;
    sommets: [number, number, number | null][];
  }[];
  /** Parcelles créées dans l'éditeur. */
  ajoutees?: ParcelleAjoutee[];
  /** Suivi et journal au moment de l'enregistrement (pour la sauvegarde en ligne). */
  suivi?: Suivi;
  /** Lignes de guidage créées dans l'éditeur. */
  guidages?: Guidage[];
  /** Parcelles retirées du fichier (indices). */
  supprimees?: number[];
  /** Zones exclues retirées (indices des anneaux). */
  zonesRetirees?: number[];
}

export class ErreurSession extends Error {
  override name = 'ErreurSession';
}

export function enregistrerSession(
  td: TaskData,
  nom: string,
  etat: Etat,
  appareil: string,
  suivi?: Suivi,
  maintenant = new Date(),
): SessionEnregistree {
  return {
    version: 1,
    enregistreLe: maintenant.toISOString(),
    appareil,
    fichier: { nom, texte: td.texte },
    anneaux: etat.anneaux.map((a) => {
      // Zone exclue créée dans l'éditeur (anneau -1) : aucun point d'origine.
      const points = td.parcelles[a.parcelle]!.anneaux[a.anneau]?.points ?? [];
      return {
        parcelle: a.parcelle,
        anneau: a.anneau,
        ...(a.anneau < 0 ? { type: a.type } : {}),
        sommets: a.sommets.map((s): [number, number, number | null] => [
          s.lat,
          s.lon,
          s.origine ? points.indexOf(s.origine) : null,
        ]),
      };
    }),
    ...(etat.guidages?.length ? { guidages: [...etat.guidages] } : {}),
    ...(etat.supprimees?.length ? { supprimees: [...etat.supprimees] } : {}),
    ...(etat.zonesRetirees?.length ? { zonesRetirees: [...etat.zonesRetirees] } : {}),
    ...(etat.ajoutees?.length ? { ajoutees: [...etat.ajoutees] } : {}),
    ...(suivi ? { suivi } : {}),
  };
}

/** Relit une session enregistrée : le fichier d'origine et l'état modifié. */
export function relireSession(sauvegarde: unknown): {
  td: TaskData;
  nom: string;
  etat: Etat;
  session: SessionEnregistree;
} {
  const s = sauvegarde as SessionEnregistree;
  if (!s || s.version !== 1 || typeof s.fichier?.texte !== 'string' || !Array.isArray(s.anneaux)) {
    throw new ErreurSession('Sauvegarde illisible ou d’une version inconnue.');
  }
  const td = lireTaskData(s.fichier.texte);
  // Parcelles créées dans l'éditeur : remises à la suite de celles du fichier.
  const ajoutees = (s.ajoutees ?? []).filter((a) => a.parcelle >= td.parcelles.length);
  completerParcelles(td, { anneaux: [], ajoutees });
  const anneaux: AnneauEdite[] = s.anneaux.map((a) => {
    if (a.anneau === -1) {
      if (!td.parcelles[a.parcelle] || a.sommets.length < 3) {
        throw new ErreurSession('La sauvegarde ne correspond pas à son fichier.');
      }
      return {
        parcelle: a.parcelle,
        anneau: -1,
        type: a.type ?? 2,
        nbOrigine: 0,
        sommets: a.sommets.map(([lat, lon]): Sommet => ({ lat, lon, origine: null })),
      };
    }
    const anneauLu = td.parcelles[a.parcelle]?.anneaux[a.anneau];
    if (!anneauLu) throw new ErreurSession('La sauvegarde ne correspond pas à son fichier.');
    const premier = anneauLu.points[0]!;
    const dernier = anneauLu.points.at(-1)!;
    const ferme = premier.lat === dernier.lat && premier.lon === dernier.lon;
    return {
      parcelle: a.parcelle,
      anneau: a.anneau,
      type: anneauLu.type,
      nbOrigine: anneauLu.points.length - (ferme && anneauLu.points.length > 1 ? 1 : 0),
      sommets: a.sommets.map(([lat, lon, i]): Sommet => {
        const origine = i === null ? null : anneauLu.points[i];
        if (origine === undefined) throw new ErreurSession('Point d’origine introuvable.');
        return { lat, lon, origine };
      }),
    };
  });
  const guidages = (s.guidages ?? []).filter((g) => td.parcelles[g.parcelle]);
  const supprimees = (s.supprimees ?? []).filter((p) => td.parcelles[p]);
  const zonesRetirees = (s.zonesRetirees ?? []).filter((i) => anneaux[i]?.type === 2);
  return {
    td,
    nom: s.fichier.nom,
    etat: {
      anneaux,
      ...(guidages.length ? { guidages } : {}),
      ...(supprimees.length ? { supprimees } : {}),
      ...(zonesRetirees.length ? { zonesRetirees } : {}),
      ...(ajoutees.length ? { ajoutees } : {}),
    },
    session: s,
  };
}

// ---------- Sur le téléphone ----------

const CLE = 'contour-parcelle/session';

export function garderSurAppareil(
  stockage: Pick<Storage, 'setItem'> | null,
  s: SessionEnregistree,
): boolean {
  try {
    stockage?.setItem(CLE, JSON.stringify(s));
    return stockage !== null;
  } catch {
    return false;
  }
}

export function lireSurAppareil(stockage: Pick<Storage, 'getItem'> | null): unknown {
  try {
    const brut = stockage?.getItem(CLE);
    return brut ? JSON.parse(brut) : null;
  } catch {
    return null;
  }
}

export function oublierSurAppareil(stockage: Pick<Storage, 'removeItem'> | null): void {
  try {
    stockage?.removeItem(CLE);
  } catch {
    // rien à faire
  }
}
