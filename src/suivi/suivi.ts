// Suivi des contours (vérifié, à confirmer, à refaire) et journal des modifications.
//
// Conservé sur le téléphone (stockage du navigateur) et exportable en CSV. Chaque parcelle est
// repérée par son GUID (attribut B du PFD), qui ne change pas d'un export à l'autre ; à défaut,
// par son nom.

import type { Parcelle } from '../isoxml/lecture';

export type EtatContour = 'verifie' | 'a-confirmer' | 'a-refaire';

export const LIBELLES: Record<EtatContour, string> = {
  verifie: 'Vérifié',
  'a-confirmer': 'À confirmer',
  'a-refaire': 'À refaire',
};

export interface Fiche {
  nom: string;
  etat: EtatContour;
  /** Date du dernier changement d'état ou de remarque (AAAA-MM-JJ). */
  date: string;
  remarque: string;
}

export interface EntreeJournal {
  /** Date et heure (ISO). */
  quand: string;
  cle: string;
  parcelle: string;
  /** Ce qui a été fait : « Limite Sud décalée de +0,5 m », « Fichier exporté »… */
  action: string;
  /** Surfaces D en m², avant et après (absentes pour un export). */
  surfaceAvant: number | null;
  surfaceApres: number | null;
}

export interface Suivi {
  version: 1;
  fiches: Record<string, Fiche>;
  journal: EntreeJournal[];
}

export const suiviVide = (): Suivi => ({ version: 1, fiches: {}, journal: [] });

export function cleParcelle(p: Parcelle): string {
  return p.guid || `nom:${p.nom}`;
}

export function fiche(suivi: Suivi, p: Parcelle): Fiche {
  return (
    suivi.fiches[cleParcelle(p)] ?? { nom: p.nom, etat: 'a-confirmer', date: '', remarque: '' }
  );
}

export function aujourdhui(maintenant = new Date()): string {
  const z = (n: number) => String(n).padStart(2, '0');
  return `${maintenant.getFullYear()}-${z(maintenant.getMonth() + 1)}-${z(maintenant.getDate())}`;
}

/** Nouveau suivi avec la fiche de `p` modifiée (date mise à jour). */
export function changerFiche(
  suivi: Suivi,
  p: Parcelle,
  changement: Partial<Pick<Fiche, 'etat' | 'remarque'>>,
  maintenant = new Date(),
): Suivi {
  const f = { ...fiche(suivi, p), ...changement, nom: p.nom, date: aujourdhui(maintenant) };
  return { ...suivi, fiches: { ...suivi.fiches, [cleParcelle(p)]: f } };
}

// ---------- Stockage sur le téléphone ----------

const CLE_STOCKAGE = 'contour-parcelle/suivi';

export function charger(stockage: Pick<Storage, 'getItem'> | null): Suivi {
  try {
    const brut = stockage?.getItem(CLE_STOCKAGE);
    if (!brut) return suiviVide();
    const s = JSON.parse(brut) as Suivi;
    if (s.version !== 1 || typeof s.fiches !== 'object' || !Array.isArray(s.journal)) {
      return suiviVide();
    }
    return s;
  } catch {
    return suiviVide();
  }
}

/** Renvoie false si l'enregistrement a échoué (navigation privée, stockage plein…). */
export function enregistrer(stockage: Pick<Storage, 'setItem'> | null, suivi: Suivi): boolean {
  try {
    stockage?.setItem(CLE_STOCKAGE, JSON.stringify(suivi));
    return stockage !== null;
  } catch {
    return false;
  }
}

// ---------- CSV (séparateur « ; » et virgule décimale, pour un tableur français) ----------

function champ(v: string | number | null): string {
  if (v === null) return '';
  const s = typeof v === 'number' ? String(Math.round(v)) : v;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const ligneCsv = (champs: (string | number | null)[]) => champs.map(champ).join(';');
// BOM UTF-8 : sans lui, Excel affiche mal les accents.
const BOM = '﻿';

export function csvSuivi(suivi: Suivi, parcelles: readonly Parcelle[]): string {
  const lignes = [ligneCsv(['Parcelle', 'État', 'Date', 'Remarque'])];
  for (const p of [...parcelles].sort((a, b) =>
    a.nom.localeCompare(b.nom, 'fr', { numeric: true }),
  )) {
    const f = fiche(suivi, p);
    lignes.push(ligneCsv([p.nom, LIBELLES[f.etat], f.date, f.remarque]));
  }
  return BOM + lignes.join('\r\n') + '\r\n';
}

export function csvJournal(suivi: Suivi): string {
  const lignes = [
    ligneCsv(['Date', 'Heure', 'Parcelle', 'Action', 'Surface avant (m²)', 'Surface après (m²)']),
  ];
  for (const e of suivi.journal) {
    const d = new Date(e.quand);
    const z = (n: number) => String(n).padStart(2, '0');
    lignes.push(
      ligneCsv([
        aujourdhui(d),
        `${z(d.getHours())}:${z(d.getMinutes())}`,
        e.parcelle,
        e.action,
        e.surfaceAvant,
        e.surfaceApres,
      ]),
    );
  }
  return BOM + lignes.join('\r\n') + '\r\n';
}

/**
 * Fusionne deux suivis (deux appareils) : pour chaque parcelle, la fiche la plus récente l'emporte
 * (à date égale, celle de `b`) ; les journaux s'additionnent sans doublons, dans l'ordre du temps.
 */
export function fusionner(a: Suivi, b: Suivi): Suivi {
  const fiches: Record<string, Fiche> = { ...a.fiches };
  for (const [cle, f] of Object.entries(b.fiches)) {
    const g = fiches[cle];
    if (!g || f.date >= g.date) fiches[cle] = f;
  }
  const vues = new Set<string>();
  const journal = [...a.journal, ...b.journal]
    .filter((e) => {
      const id = `${e.quand}|${e.cle}|${e.action}`;
      if (vues.has(id)) return false;
      vues.add(id);
      return true;
    })
    .sort((x, y) => x.quand.localeCompare(y.quand));
  return { version: 1, fiches, journal };
}
