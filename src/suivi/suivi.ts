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
  /** Dernière version de TASKDATA exportée (« 0.12 »…), partagée entre appareils. */
  derniereVersion?: string;
  /** Notes sur les parcelles (adventices, particularités…), avec un endroit facultatif. */
  notes?: Note[];
}

/**
 * Note sur une parcelle. Une note supprimée est gardée (`supprimee`) pour que la fusion entre
 * deux appareils ne la fasse pas revenir.
 */
export interface Note {
  id: string;
  /** Repère de la parcelle (GUID, à défaut « nom:… »), comme pour les fiches. */
  cle: string;
  parcelle: string;
  /** Type saisi librement (« Vulpin », « Chardons »…). */
  type: string;
  texte: string;
  /** Création et dernière modification (ISO). */
  creee: string;
  modifiee: string;
  /** Endroit dans la parcelle [latitude, longitude], ou null pour toute la parcelle. */
  position: [number, number] | null;
  /** Obstacle (poteau…) : l'optimisation du guidage le place en bout d'outil. */
  obstacle?: boolean;
  supprimee?: boolean;
}

/** Version utilisée avant l'éditeur (notation « task data 0.11 ») : le premier export sera 0.12. */
export const VERSION_DE_DEPART = '0.11';

/** Version suivante : « 0.11 » → « 0.12 », « 0.9 » → « 0.10 », « 3 » → « 4 ». */
export function versionSuivante(v: string): string {
  const m = /^(.*?)(\d+)$/.exec(v.trim());
  if (!m) return `${v.trim()}.1`;
  return `${m[1]}${Number(m[2]) + 1}`;
}

/** Compare deux versions « 0.12 » / « 0.9 » nombre par nombre ; positif si a est plus récente. */
export function comparerVersions(a: string, b: string): number {
  const na = a.split(/\D+/).filter(Boolean).map(Number);
  const nb = b.split(/\D+/).filter(Boolean).map(Number);
  for (let i = 0; i < Math.max(na.length, nb.length); i++) {
    const d = (na[i] ?? 0) - (nb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
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
// ---------- Notes ----------

/** Notes (non supprimées) d'une parcelle, les plus récentes d'abord. */
export function notesDe(suivi: Suivi, p: Parcelle): Note[] {
  const cle = cleParcelle(p);
  return (suivi.notes ?? [])
    .filter((n) => n.cle === cle && !n.supprimee)
    .sort((x, y) => y.creee.localeCompare(x.creee));
}

/** Types déjà utilisés (pour les proposer à la saisie), du plus fréquent au moins fréquent. */
export function typesDeNotes(suivi: Suivi): string[] {
  const compte = new Map<string, number>();
  for (const n of suivi.notes ?? []) {
    if (!n.supprimee && n.type) compte.set(n.type, (compte.get(n.type) ?? 0) + 1);
  }
  return [...compte.entries()]
    .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0], 'fr'))
    .map(([t]) => t);
}

/** Ajoute la note, ou remplace celle de même identifiant. */
export function enregistrerNote(suivi: Suivi, note: Note): Suivi {
  const notes = (suivi.notes ?? []).filter((n) => n.id !== note.id);
  return { ...suivi, notes: [...notes, note] };
}

export function supprimerNote(suivi: Suivi, id: string, maintenant = new Date()): Suivi {
  return {
    ...suivi,
    notes: (suivi.notes ?? []).map((n) =>
      n.id === id ? { ...n, supprimee: true, modifiee: maintenant.toISOString() } : n,
    ),
  };
}

export function nouvelIdNote(): string {
  return `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function csvNotes(suivi: Suivi): string {
  const lignes = [
    ligneCsv(['Parcelle', 'Type', 'Note', 'Date', 'Latitude', 'Longitude', 'Obstacle']),
  ];
  const notes = (suivi.notes ?? [])
    .filter((n) => !n.supprimee)
    .sort(
      (a, b) =>
        a.parcelle.localeCompare(b.parcelle, 'fr', { numeric: true }) ||
        a.creee.localeCompare(b.creee),
    );
  for (const n of notes) {
    lignes.push(
      ligneCsv([
        n.parcelle,
        n.type,
        n.texte,
        aujourdhui(new Date(n.creee)),
        n.position ? n.position[0].toFixed(7) : '',
        n.position ? n.position[1].toFixed(7) : '',
        n.obstacle ? 'oui' : '',
      ]),
    );
  }
  return BOM + lignes.join('\r\n') + '\r\n';
}

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
  const versions = [a.derniereVersion, b.derniereVersion].filter((v): v is string => !!v);
  const derniereVersion = versions.sort(comparerVersions).at(-1);
  // Notes : par identifiant, la version modifiée en dernier l'emporte (suppression comprise).
  const notes = new Map<string, Note>();
  for (const n of [...(a.notes ?? []), ...(b.notes ?? [])]) {
    const m = notes.get(n.id);
    if (!m || n.modifiee >= m.modifiee) notes.set(n.id, n);
  }
  return {
    version: 1,
    fiches,
    journal,
    ...(derniereVersion ? { derniereVersion } : {}),
    ...(notes.size > 0 ? { notes: [...notes.values()] } : {}),
  };
}

// ---------- Import d'un CSV (restauration du suivi ou du journal) ----------

/** Découpe un CSV (« ; » ou « , », guillemets doublés) en lignes de champs. */
export function lireCsv(texte: string): string[][] {
  const t = texte.replace(/^﻿/, '');
  const premiere = t.split(/\r?\n/, 1)[0] ?? '';
  const sep = premiere.includes(';') ? ';' : ',';
  const lignes: string[][] = [];
  let ligne: string[] = [];
  let champ = '';
  let guillemets = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (guillemets) {
      if (c === '"' && t[i + 1] === '"') {
        champ += '"';
        i++;
      } else if (c === '"') guillemets = false;
      else champ += c;
    } else if (c === '"') guillemets = true;
    else if (c === sep) {
      ligne.push(champ);
      champ = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      ligne.push(champ);
      if (ligne.some((x) => x.trim() !== '')) lignes.push(ligne);
      ligne = [];
      champ = '';
    } else champ += c;
  }
  ligne.push(champ);
  if (ligne.some((x) => x.trim() !== '')) lignes.push(ligne);
  return lignes;
}

/** « 2026-10-16 » ou « 16/10/2026 » (date réécrite par un tableur) → « 2026-10-16 » ; sinon null. */
function dateIso(v: string): string | null {
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : null;
}

const sansAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

function etatDe(libelle: string): EtatContour | null {
  const l = sansAccents(libelle);
  return (
    (Object.keys(LIBELLES) as EtatContour[]).find((e) => sansAccents(LIBELLES[e]) === l) ?? null
  );
}

function nombre(v: string): number | null {
  const s = v.replace(/[\s  ]/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export interface BilanImport {
  type: 'suivi' | 'journal' | 'notes';
  /** Fiches restaurées, ou lignes de journal ajoutées. */
  ajouts: number;
  /** Lignes ignorées : déjà présentes, ou fiche plus récente sur l'appareil. */
  dejaLa: number;
  /** Noms de parcelles absents du fichier ouvert (suivi), ou lignes illisibles. */
  inconnues: string[];
}

/**
 * Reprend un CSV produit par « Suivi en CSV » ou « Journal en CSV » (même retouché dans un
 * tableur). Suivi : les parcelles sont retrouvées par leur nom dans le fichier ouvert ; une fiche
 * du CSV remplace celle de l'appareil si elle est au moins aussi récente. Journal : les lignes
 * déjà présentes (même minute, même parcelle, même action) ne sont pas ajoutées deux fois.
 */
export function importerCsv(
  suivi: Suivi,
  texte: string,
  parcelles: readonly Parcelle[],
): { suivi: Suivi; bilan: BilanImport } {
  const [entete, ...lignes] = lireCsv(texte);
  const titres = (entete ?? []).map(sansAccents);
  const parNom = new Map(parcelles.map((p) => [p.nom.trim(), p]));
  if (titres[0] === 'parcelle' && titres[1] === 'etat') {
    const fiches = { ...suivi.fiches };
    const bilan: BilanImport = { type: 'suivi', ajouts: 0, dejaLa: 0, inconnues: [] };
    for (const [nom = '', libelle = '', date = '', remarque = ''] of lignes) {
      const p = parNom.get(nom.trim());
      const etat = etatDe(libelle);
      if (!p || !etat) {
        bilan.inconnues.push(nom.trim() || '(sans nom)');
        continue;
      }
      const jour = dateIso(date) ?? '';
      // Parcelle jamais suivie (à confirmer, sans date ni remarque) : rien à restaurer.
      if (!jour && etat === 'a-confirmer' && !remarque.trim()) continue;
      const cle = cleParcelle(p);
      const actuelle = fiches[cle];
      if (actuelle && actuelle.date > jour) {
        bilan.dejaLa++;
        continue;
      }
      if (
        actuelle &&
        actuelle.etat === etat &&
        actuelle.date === jour &&
        actuelle.remarque === remarque
      ) {
        bilan.dejaLa++;
        continue;
      }
      fiches[cle] = { nom: p.nom, etat, date: jour, remarque };
      bilan.ajouts++;
    }
    return { suivi: { ...suivi, fiches }, bilan };
  }
  if (titres[0] === 'date' && titres[1] === 'heure' && titres[2] === 'parcelle') {
    const bilan: BilanImport = { type: 'journal', ajouts: 0, dejaLa: 0, inconnues: [] };
    const z = (n: number) => String(n).padStart(2, '0');
    const minute = (quand: string) => {
      const d = new Date(quand);
      return `${aujourdhui(d)} ${z(d.getHours())}:${z(d.getMinutes())}`;
    };
    const presentes = new Set(
      suivi.journal.map((e) => `${minute(e.quand)}|${e.parcelle}|${e.action}`),
    );
    const nouvelles: EntreeJournal[] = [];
    lignes.forEach(
      ([date = '', heure = '', parcelle = '', action = '', avant = '', apres = ''], i) => {
        const jour = dateIso(date);
        const h = /^(\d{1,2}):(\d{2})/.exec(heure.trim());
        if (!jour || !h || !action.trim()) {
          bilan.inconnues.push(`ligne ${i + 2}`);
          return;
        }
        const [a, m, j] = jour.split('-').map(Number) as [number, number, number];
        const quand = new Date(a, m - 1, j, Number(h[1]), Number(h[2])).toISOString();
        const nom = parcelle.trim();
        const id = `${minute(quand)}|${nom}|${action}`;
        if (presentes.has(id)) {
          bilan.dejaLa++;
          return;
        }
        presentes.add(id);
        const p = parNom.get(nom);
        nouvelles.push({
          quand,
          cle: nom === '—' ? 'export' : p ? cleParcelle(p) : `nom:${nom}`,
          parcelle: nom,
          action,
          surfaceAvant: nombre(avant),
          surfaceApres: nombre(apres),
        });
        bilan.ajouts++;
      },
    );
    const journal = [...suivi.journal, ...nouvelles].sort((x, y) => x.quand.localeCompare(y.quand));
    return { suivi: { ...suivi, journal }, bilan };
  }
  if (titres[0] === 'parcelle' && titres[1] === 'type' && titres[2] === 'note') {
    const bilan: BilanImport = { type: 'notes', ajouts: 0, dejaLa: 0, inconnues: [] };
    const notes = [...(suivi.notes ?? [])];
    const cleNote = (cle: string, type: string, texte: string, jour: string) =>
      `${cle}|${type.trim()}|${texte.trim()}|${jour}`;
    const presentes = new Set(
      notes
        .filter((n) => !n.supprimee)
        .map((n) => cleNote(n.cle, n.type, n.texte, aujourdhui(new Date(n.creee)))),
    );
    for (const [
      nom = '',
      type = '',
      texte = '',
      date = '',
      lat = '',
      lon = '',
      obs = '',
    ] of lignes) {
      const p = parNom.get(nom.trim());
      const jour = dateIso(date);
      if (!p || !jour || !(type.trim() || texte.trim())) {
        bilan.inconnues.push(nom.trim() || '(sans nom)');
        continue;
      }
      const id = cleNote(cleParcelle(p), type, texte, jour);
      if (presentes.has(id)) {
        bilan.dejaLa++;
        continue;
      }
      presentes.add(id);
      const [a, m, j] = jour.split('-').map(Number) as [number, number, number];
      const quand = new Date(a, m - 1, j, 12).toISOString();
      const la = nombre(lat);
      const lo = nombre(lon);
      notes.push({
        id: `csv-${id}`,
        cle: cleParcelle(p),
        parcelle: p.nom,
        type: type.trim(),
        texte: texte.trim(),
        creee: quand,
        modifiee: quand,
        position: la !== null && lo !== null ? [la, lo] : null,
        ...(/^(oui|o|1|x|vrai)$/i.test(obs.trim()) ? { obstacle: true } : {}),
      });
      bilan.ajouts++;
    }
    return { suivi: { ...suivi, notes }, bilan };
  }
  throw new Error(
    'Ce fichier n’est ni un CSV du suivi (Parcelle ; État…), ni du journal (Date ; Heure ; Parcelle…), ni des notes (Parcelle ; Type ; Note…).',
  );
}
