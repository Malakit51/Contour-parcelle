// Page principale : charger TASKDATA.XML, toucher une limite ou un sommet, saisir la distance en mètres, exporter.

import './style.css';
import { controler, sommetsPresqueCommuns, type Alerte } from './edition/controles';
import {
  etatInitial,
  latLon,
  limitesJumelles,
  sommetsEn,
  suivant,
  precedent,
  type Etat,
  type RefLimite,
  type RefSommet,
} from './edition/etat';
import { exporterEtat, nouvelleSurface, parcellesModifiees } from './edition/export';
import {
  decalerLimite,
  decalerSommet,
  ErreurEdition,
  glisserSommet,
  placerSommet,
  sensPositif,
  supprimerSommet,
} from './edition/operations';
import { planLocal, positionSurSegment, type LatLon, type Plan, type XY } from './geometrie/plan';
import { comparer } from './isoxml/comparaison';
import { lireTaskData, type TaskData } from './isoxml/lecture';
import {
  ecritureDossierPossible,
  ecrireDossierTaskdata,
  NOM_DOSSIER,
  NOM_FICHIER,
} from './ui/dossier';
import { decoder, encoder } from './isoxml/octets';
import { Carte, type Dessin, type VersEcran } from './ui/carte';
import { el } from './ui/dom';
import {
  changerFiche,
  charger as chargerSuivi,
  cleParcelle,
  csvJournal,
  csvSuivi,
  enregistrer as enregistrerSuivi,
  fiche,
  LIBELLES,
  type EntreeJournal,
  type EtatContour,
  type Suivi,
} from './suivi/suivi';

// Couleurs vives, lisibles sur la photo aérienne ; l'orange-rouge est réservé à la sélection.
const COULEURS = ['#ffee58', '#00e5ff', '#ff80ab', '#b2ff59', '#ffffff', '#ea80fc'];
const SEL = '#d500f9';
const COULEURS_ETAT: Record<EtatContour, string> = {
  verifie: '#00e676',
  'a-confirmer': '#ffc400',
  'a-refaire': '#ff1744',
};
/** Rayon de toucher, en pixels à l'écran. */
const RAYON_TOUCHER_PX = 26;

interface Session {
  td: TaskData;
  nomFichier: string;
  plan: Plan;
  initial: Etat;
  etat: Etat;
  /** États précédents, avec les lignes de journal à retirer si on annule. */
  historique: { etat: Etat; journal: EntreeJournal[] }[];
  alertesChargement: string[];
  /** Indice de couleur de chaque parcelle : deux voisines n'ont jamais la même. */
  couleurs: number[];
}

let session: Session | null = null;

// Suivi des contours et journal : conservés sur le téléphone, indépendamment du fichier ouvert.
const stockage = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();
let suivi: Suivi = chargerSuivi(stockage);
let suiviNonEnregistre = false;
/** Couleur des parcelles sur la carte : selon l'état du contour, ou pour distinguer les voisines. */
let couleursParEtat = true;

function majSuivi(nouveau: Suivi): void {
  suivi = nouveau;
  suiviNonEnregistre = !enregistrerSuivi(stockage, suivi);
}

/** Parcelles dont le contour diffère entre deux états. */
function parcellesChangees(a: Etat, b: Etat): number[] {
  const changees = new Set<number>();
  a.anneaux.forEach((r, i) => {
    const q = b.anneaux[i]!;
    if (
      r.sommets.length !== q.sommets.length ||
      r.sommets.some((u, k) => u.lat !== q.sommets[k]!.lat || u.lon !== q.sommets[k]!.lon)
    ) {
      changees.add(r.parcelle);
    }
  });
  return [...changees];
}

/** Passe à un nouvel état (annulable) et note la modification au journal. */
function enregistrerModification(s: Session, nouveau: Etat, quoi: string): void {
  const entrees: EntreeJournal[] = parcellesChangees(s.etat, nouveau).map((p) => ({
    quand: new Date().toISOString(),
    cle: cleParcelle(s.td.parcelles[p]!),
    parcelle: s.td.parcelles[p]!.nom,
    action: quoi,
    surfaceAvant: nouvelleSurface(s.td, s.etat, p),
    surfaceApres: nouvelleSurface(s.td, nouveau, p),
  }));
  s.historique.push({ etat: s.etat, journal: entrees });
  s.etat = nouveau;
  majSuivi({ ...suivi, journal: [...suivi.journal, ...entrees] });
}

function retirerDuJournal(entrees: EntreeJournal[]): void {
  if (entrees.length === 0) return;
  majSuivi({ ...suivi, journal: suivi.journal.filter((e) => !entrees.includes(e)) });
}
let mode: 'limite' | 'sommet' = 'limite';
let selLimite: RefLimite | null = null;
let selSommet: RefSommet | null = null;
let limiteGlisse: RefLimite | null = null;
/** Le prochain toucher sur la carte place le sommet sélectionné à cet endroit. */
let placerAuDoigt = false;
let parcelleCourante: number | null = null;
/** Distance en mètres telle que tapée, avec une virgule décimale (« -0,35 »). */
let saisie = '0,5';
let message: { texte: string; erreur: boolean } | null = null;
let exportPrepare: { texte: string; alertes: Alerte[]; resume: string; details: string } | null =
  null;

const app = document.getElementById('app')!;
let etatGps = '';
const carte = new Carte(toucher, (texte) => {
  etatGps = texte;
  afficher();
});

// ---------- Chargement ----------

async function charger(fichier: File): Promise<void> {
  try {
    const octets = new Uint8Array(await fichier.arrayBuffer());
    const td = lireTaskData(decoder(octets));
    if (td.parcelles.length === 0) throw new Error('Aucune parcelle (PFD) dans ce fichier.');
    const initial = etatInitial(td);
    const tous = initial.anneaux.flatMap((a) => a.sommets.map(latLon));
    const centre: [number, number] = [
      tous.reduce((s, p) => s + p[0], 0) / tous.length,
      tous.reduce((s, p) => s + p[1], 0) / tous.length,
    ];
    const alertesChargement = [];
    if (td.segmentsIgnores.length > 0) {
      alertesChargement.push(
        `${td.segmentsIgnores.length} segment(s) à deux points (LSG A="5") ignoré(s) : ils seront retirés à l'export.`,
      );
    }
    const vus = new Set<string>();
    for (const p of sommetsPresqueCommuns(td, initial, 1)) {
      const cle = `${p.noms[0]}|${p.noms[1]}|${p.distance.toFixed(3)}`;
      if (vus.has(cle)) continue;
      vus.add(cle);
      alertesChargement.push(
        `${p.noms[0]} / ${p.noms[1]} : deux sommets presque communs, à ${(p.distance * 100).toFixed(0)} cm.`,
      );
    }
    session = {
      td,
      nomFichier: fichier.name,
      plan: planLocal(centre),
      initial,
      etat: initial,
      historique: [],
      alertesChargement,
      couleurs: colorier(initial, td.parcelles.length),
    };
    parcelleCourante = null;
    effacerSelection();
    message = {
      texte: `${fichier.name} chargé : ${td.parcelles.length} parcelles.`,
      erreur: false,
    };
    afficher();
    cadrerTout();
  } catch (e) {
    message = { texte: `Lecture impossible : ${(e as Error).message}`, erreur: true };
    afficher();
  }
}

// ---------- Géométrie d'affichage ----------

/**
 * Couleur de chaque parcelle, choisie pour que deux parcelles proches (rectangles englobants à
 * moins d'une vingtaine de mètres) n'aient pas la même : la plus petite couleur libre.
 */
function colorier(etat: Etat, n: number): number[] {
  const marge = 0.0002; // environ 20 m en degrés
  const boites = Array.from({ length: n }, () => ({ s: 90, n: -90, o: 180, e: -180 }));
  for (const a of etat.anneaux) {
    const b = boites[a.parcelle]!;
    for (const p of a.sommets) {
      b.s = Math.min(b.s, p.lat);
      b.n = Math.max(b.n, p.lat);
      b.o = Math.min(b.o, p.lon);
      b.e = Math.max(b.e, p.lon);
    }
  }
  const proches = (i: number, j: number) => {
    const a = boites[i]!;
    const b = boites[j]!;
    return a.s - marge <= b.n && b.s - marge <= a.n && a.o - marge <= b.e && b.o - marge <= a.e;
  };
  const couleurs: number[] = [];
  for (let i = 0; i < n; i++) {
    const prises = new Set<number>();
    for (let j = 0; j < i; j++) if (proches(i, j)) prises.add(couleurs[j]!);
    let c = 0;
    while (prises.has(c)) c++;
    couleurs.push(c);
  }
  return couleurs;
}

function anneauxXY(s: Session): XY[][] {
  return s.etat.anneaux.map((a) => a.sommets.map((p) => s.plan.versXY(latLon(p))));
}

function anneauxLL(s: Session): LatLon[][] {
  return s.etat.anneaux.map((a) => a.sommets.map(latLon));
}

function cadrerTout(): void {
  if (!session) return;
  carte.cadrer(anneauxLL(session).flat());
}

function cadrerParcelle(p: number): void {
  if (!session) return;
  const s = session;
  carte.cadrer(
    anneauxLL(s)
      .filter((_, i) => s.etat.anneaux[i]!.parcelle === p)
      .flat(),
  );
}

/** « Nord », « Sud », « Est » ou « Ouest » : côté de la parcelle où se trouve la limite. */
function coteLimite(s: Session, ref: RefLimite): string {
  const pts = anneauxXY(s)[ref.anneau]!;
  const a = pts[ref.debut]!;
  const b = pts[(ref.debut + 1) % pts.length]!;
  const c: XY = [
    pts.reduce((u, p) => u + p[0], 0) / pts.length,
    pts.reduce((u, p) => u + p[1], 0) / pts.length,
  ];
  const m: XY = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  if (Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1])) return m[1] > c[1] ? 'Nord' : 'Sud';
  return m[0] < c[0] ? 'Ouest' : 'Est';
}

function longueur(s: Session, ref: RefLimite): number {
  // Mesurée dans un plan centré sur la limite : le plan d'affichage déforme un peu les distances.
  const a = latLon(s.etat.anneaux[ref.anneau]!.sommets[ref.debut]!);
  const b = latLon(s.etat.anneaux[ref.anneau]!.sommets[suivant(s.etat, ref.anneau, ref.debut)]!);
  return Math.hypot(...planLocal(a).versXY(b));
}

const nomParcelle = (s: Session, anneau: number) =>
  s.td.parcelles[s.etat.anneaux[anneau]!.parcelle]!.nom;

// ---------- Sélection au doigt ----------

function toucher(ecran: { x: number; y: number }, versEcran: VersEcran, position: LatLon): void {
  if (!session) return;
  const s = session;
  if (mode === 'sommet' && selSommet && placerAuDoigt) {
    const ref = selSommet;
    placerAuDoigt = false;
    modifier(
      () => placerSommet(s.etat, ref, position),
      `Point de ${nomParcelle(s, ref.anneau)} placé au doigt : ajustez-le avec les flèches`,
      true,
    );
    return;
  }
  // Tout se mesure en pixels à l'écran : la cible a la même taille quel que soit le zoom.
  const p: XY = [ecran.x, ecran.y];
  const rayon = RAYON_TOUCHER_PX;
  const anneaux = anneauxLL(s).map((pts) =>
    pts.map((ll): XY => {
      const e = versEcran(ll);
      return [e.x, e.y];
    }),
  );
  // La parcelle courante passe en premier : en cas d'égalité (limite partagée), c'est elle qui gagne.
  const ordre = anneaux
    .map((_, i) => i)
    .sort(
      (i, j) =>
        Number(s.etat.anneaux[j]!.parcelle === parcelleCourante) -
        Number(s.etat.anneaux[i]!.parcelle === parcelleCourante),
    );
  let meilleur: { anneau: number; indice: number; d: number } | null = null;
  for (const i of ordre) {
    const pts = anneaux[i]!;
    pts.forEach((q, k) => {
      let d: number;
      if (mode === 'sommet') {
        d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      } else {
        const r = pts[(k + 1) % pts.length]!;
        const pos = positionSurSegment(p, q, r);
        d =
          pos.t < 0
            ? Math.hypot(p[0] - q[0], p[1] - q[1])
            : pos.t > 1
              ? Math.hypot(p[0] - r[0], p[1] - r[1])
              : pos.ecart;
      }
      if (d <= rayon && (!meilleur || d < meilleur.d - 1e-6))
        meilleur = { anneau: i, indice: k, d };
    });
  }
  const choix = meilleur as { anneau: number; indice: number } | null;
  effacerSelection();
  if (choix) {
    parcelleCourante = s.etat.anneaux[choix.anneau]!.parcelle;
    if (mode === 'limite') selLimite = { anneau: choix.anneau, debut: choix.indice };
    else selSommet = { anneau: choix.anneau, sommet: choix.indice };
  }
  message = null;
  afficher();
}

function effacerSelection(): void {
  placerAuDoigt = false;
  selLimite = null;
  selSommet = null;
  limiteGlisse = null;
  exportPrepare = null;
}

// ---------- Appliquer, annuler ----------

function metres(): number {
  const v = Number(saisie.replace(',', '.'));
  return Number.isFinite(v) ? v : 0;
}

/** Écrit un nombre de mètres à la française, au millimètre près : « 0,35 ». */
const enMetres = (v: number) => String(Math.round(v * 1000) / 1000).replace('.', ',');

/**
 * Applique une modification (annulable). `garderSelection` : le sommet reste sélectionné pour
 * enchaîner (flèches, placement au doigt) ; ses indices ne changent pas quand il bouge.
 */
function modifier(operation: () => Etat, quoi: string, garderSelection: boolean): void {
  if (!session) return;
  const s = session;
  try {
    const nouveau = operation();
    if (nouveau !== s.etat) enregistrerModification(s, nouveau, quoi);
    if (garderSelection) exportPrepare = null;
    else effacerSelection();
    message = { texte: `${quoi}.`, erreur: false };
  } catch (e) {
    message = {
      texte: e instanceof ErreurEdition ? e.message : `Erreur : ${(e as Error).message}`,
      erreur: true,
    };
  }
  afficher();
}

function fleche(sens: 'Nord' | 'Sud' | 'Est' | 'Ouest'): void {
  if (!session || !selSommet) return;
  const s = session;
  const ref = selSommet;
  const d = Math.abs(metres());
  if (d === 0) {
    message = { texte: 'Tapez d’abord une distance.', erreur: true };
    afficher();
    return;
  }
  const [est, nord] = { Nord: [0, d], Sud: [0, -d], Est: [d, 0], Ouest: [-d, 0] }[sens] as [
    number,
    number,
  ];
  modifier(
    () => decalerSommet(s.etat, ref, est, nord),
    `Point de ${nomParcelle(s, ref.anneau)} déplacé de ${enMetres(d)} m vers ${sens === 'Est' || sens === 'Ouest' ? 'l’' : 'le '}${sens}`,
    true,
  );
}

function supprimer(): void {
  if (!session || !selSommet) return;
  const s = session;
  const ref = selSommet;
  if (!confirm('Supprimer ce point ?')) return;
  modifier(
    () => supprimerSommet(s.etat, ref),
    `Point de ${nomParcelle(s, ref.anneau)} supprimé`,
    false,
  );
}

function appliquer(): void {
  if (!session) return;
  const s = session;
  const d = metres();
  try {
    let nouveau: Etat;
    let quoi: string;
    if (mode === 'limite' && selLimite) {
      quoi = `Limite ${coteLimite(s, selLimite)} de ${nomParcelle(s, selLimite.anneau)} décalée de ${signeM(d)} m`;
      nouveau = decalerLimite(s.etat, selLimite, d);
    } else if (mode === 'sommet' && selSommet && limiteGlisse) {
      quoi = `Sommet de ${nomParcelle(s, selSommet.anneau)} déplacé de ${signeM(d)} m`;
      nouveau = glisserSommet(s.etat, selSommet, limiteGlisse, d);
    } else {
      return;
    }
    if (nouveau === s.etat) return;
    enregistrerModification(s, nouveau, quoi);
    effacerSelection();
    message = { texte: `${quoi}.`, erreur: false };
  } catch (e) {
    message = {
      texte: e instanceof ErreurEdition ? e.message : `Erreur : ${(e as Error).message}`,
      erreur: true,
    };
  }
  afficher();
}

const signe = (v: number) => (v > 0 ? `+${v}` : String(v));
const signeM = (v: number) => (v > 0 ? `+${enMetres(v)}` : enMetres(v));

function annuler(): void {
  const precedent = session?.historique.pop();
  if (!session || !precedent) return;
  session.etat = precedent.etat;
  retirerDuJournal(precedent.journal);
  effacerSelection();
  message = { texte: 'Dernière modification annulée.', erreur: false };
  afficher();
}

function reinitialiser(): void {
  if (!session || session.historique.length === 0) return;
  if (!confirm('Revenir au fichier d’origine ? Toutes les modifications seront perdues.')) return;
  session.etat = session.initial;
  retirerDuJournal(session.historique.flatMap((h) => h.journal));
  session.historique = [];
  effacerSelection();
  message = { texte: 'Retour au fichier d’origine.', erreur: false };
  afficher();
}

// ---------- Export ----------

function preparerExport(): void {
  if (!session) return;
  const s = session;
  const texte = exporterEtat(s.td, s.etat);
  const alertes = controler(s.td, s.etat, parcellesModifiees(s.etat));
  const diffs = comparer(s.td.texte, texte);
  const modifiees = diffs.filter((d) => d.avant !== null && d.apres !== null).length;
  const ajoutees = diffs.filter((d) => d.avant === null).length;
  const retirees = diffs.filter((d) => d.apres === null).length;
  const resume = `${modifiees} ligne(s) modifiée(s), ${ajoutees} ajoutée(s), ${retirees} retirée(s).`;
  const details = diffs
    .map((d) =>
      d.avant !== null && d.apres !== null
        ? `ligne ${d.ligneAvant} modifiée\n  avant : ${d.avant.trimEnd()}\n  après : ${d.apres.trimEnd()}`
        : d.avant !== null
          ? `ligne ${d.ligneAvant} retirée : ${d.avant.trimEnd()}`
          : `ligne ajoutée (${d.ligneApres}) : ${d.apres!.trimEnd()}`,
    )
    .join('\n');
  exportPrepare = { texte, alertes, resume, details };
  afficher();
}

function enregistrer(octets: Uint8Array, nom: string, type: string): void {
  const blob = new Blob([octets as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: nom });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function telecharger(quoi: 'dossier' | 'xml'): Promise<void> {
  if (!exportPrepare || !session) return;
  if (
    exportPrepare.alertes.some((a) => a.grave) &&
    !confirm('Des problèmes graves ont été trouvés. Exporter quand même ?')
  ) {
    return;
  }
  const xml = encoder(exportPrepare.texte);
  let destination: string;
  if (quoi === 'dossier') {
    try {
      const chemin = await ecrireDossierTaskdata(xml, (c) =>
        confirm(`${c} existe déjà. Le remplacer ?\n\nConseil : travaillez sur une copie.`),
      );
      if (!chemin) return;
      destination = chemin;
      message = { texte: `Enregistré : ${chemin}`, erreur: false };
    } catch (e) {
      message = { texte: `Enregistrement impossible : ${(e as Error).message}`, erreur: true };
      afficher();
      return;
    }
  } else {
    enregistrer(xml, NOM_FICHIER, 'application/xml');
    destination = `${NOM_FICHIER} (téléchargements)`;
  }
  const s = session;
  majSuivi({
    ...suivi,
    journal: [
      ...suivi.journal,
      ...parcellesModifiees(s.etat).map((p) => ({
        quand: new Date().toISOString(),
        cle: cleParcelle(s.td.parcelles[p]!),
        parcelle: s.td.parcelles[p]!.nom,
        action: `Exporté dans ${destination}`,
        surfaceAvant: Number(s.td.parcelles[p]!.surface?.texte ?? NaN) || null,
        surfaceApres: nouvelleSurface(s.td, s.etat, p),
      })),
    ],
  });
  afficher();
}

// ---------- Affichage ----------

const dateFr = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '');
/** « 13/10/2026 14:05 » en heure du téléphone. */
function quandFr(iso: string): string {
  const d = new Date(iso);
  const z = (n: number) => String(n).padStart(2, '0');
  return `${z(d.getDate())}/${z(d.getMonth() + 1)}/${d.getFullYear()} ${z(d.getHours())}:${z(d.getMinutes())}`;
}
/** La liste du suivi reste ouverte d'un affichage à l'autre. */
let suiviOuvert = false;

/** État du contour de la parcelle courante : trois boutons et la remarque. */
function panneauSuiviParcelle(s: Session): HTMLElement | null {
  if (parcelleCourante === null) return null;
  const p = s.td.parcelles[parcelleCourante]!;
  const f = fiche(suivi, p);
  const derniere = [...suivi.journal].reverse().find((e) => e.cle === cleParcelle(p));
  return el(
    'div',
    { class: 'info' },
    el('strong', {}, `Contour de ${p.nom}`),
    f.date
      ? el('span', { class: 'doux' }, ` · ${LIBELLES[f.etat].toLowerCase()} le ${dateFr(f.date)}`)
      : '',
    el(
      'div',
      { class: 'rangee' },
      ...(Object.keys(LIBELLES) as EtatContour[]).map((e) =>
        el(
          'button',
          {
            class: `etat-${e}${f.etat === e ? ' choisi' : ''}`,
            onclick: () => {
              majSuivi(changerFiche(suivi, p, { etat: e }));
              afficher();
            },
          },
          LIBELLES[e],
        ),
      ),
    ),
    el(
      'div',
      { class: 'rangee' },
      el('span', { style: 'flex:1' }, f.remarque ? `Remarque : ${f.remarque}` : 'Pas de remarque.'),
      el(
        'button',
        {
          onclick: () => {
            const r = prompt(`Remarque pour ${p.nom}`, f.remarque);
            if (r === null) return;
            majSuivi(changerFiche(suivi, p, { remarque: r.trim() }));
            afficher();
          },
        },
        'Remarque',
      ),
    ),
    derniere &&
      el(
        'div',
        { class: 'doux' },
        `Dernière modification : ${quandFr(derniere.quand)}, ${derniere.action}`,
      ),
  );
}

/** Liste de toutes les parcelles avec leur état, journal et exports CSV. */
function panneauSuiviGeneral(s: Session): HTMLElement {
  const parcelles = s.td.parcelles
    .map((p, i) => ({ p, i, f: fiche(suivi, p) }))
    .sort((a, b) => a.p.nom.localeCompare(b.p.nom, 'fr', { numeric: true }));
  const compte = (e: EtatContour) => parcelles.filter((x) => x.f.etat === e).length;
  const journal = [...suivi.journal].reverse().slice(0, 50);
  const telechargerCsv = (texte: string, nom: string) =>
    enregistrer(encoder(texte), nom, 'text/csv');
  const bloc = el(
    'details',
    { class: 'info', ...(suiviOuvert ? { open: '' } : {}) },
    el(
      'summary',
      {},
      `Suivi des contours : ${compte('verifie')} vérifiés, ${compte('a-confirmer')} à confirmer, ${compte('a-refaire')} à refaire`,
    ),
    suiviNonEnregistre &&
      el(
        'div',
        { class: 'erreur' },
        'Attention : le suivi n’a pas pu être enregistré sur le téléphone.',
      ),
    el(
      'table',
      {},
      el('tr', {}, el('th', {}, 'Parcelle'), el('th', {}, 'État'), el('th', {}, 'Date')),
      ...parcelles.map(({ p, i, f }) => {
        const ligne = el(
          'tr',
          { class: 'cliquable' },
          el('td', {}, p.nom),
          el('td', { class: `texte-${f.etat}` }, LIBELLES[f.etat]),
          el('td', {}, dateFr(f.date)),
        );
        ligne.addEventListener('click', () => {
          parcelleCourante = i;
          effacerSelection();
          afficher();
          cadrerParcelle(i);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        return ligne;
      }),
    ),
    el(
      'div',
      { class: 'rangee' },
      el(
        'button',
        { onclick: () => telechargerCsv(csvSuivi(suivi, s.td.parcelles), 'suivi-contours.csv') },
        'Suivi en CSV',
      ),
      el(
        'button',
        { onclick: () => telechargerCsv(csvJournal(suivi), 'journal-contours.csv') },
        'Journal en CSV',
      ),
    ),
    el('strong', {}, `Journal (${suivi.journal.length} lignes, les plus récentes d’abord)`),
    ...journal.map((e) =>
      el(
        'div',
        { class: 'doux' },
        `${quandFr(e.quand)} · ${e.parcelle} · ${e.action}` +
          (e.surfaceAvant !== null && e.surfaceApres !== null
            ? ` · ${Math.round(e.surfaceApres - e.surfaceAvant) >= 0 ? '+' : ''}${Math.round(e.surfaceApres - e.surfaceAvant)} m²`
            : ''),
      ),
    ),
  );
  bloc.addEventListener('toggle', () => (suiviOuvert = bloc.open));
  return bloc;
}

function dessin(s: Session): Dessin {
  const anneaux = anneauxLL(s);
  const d: Dessin = {
    anneaux: anneaux.map((pts, i) => {
      const a = s.etat.anneaux[i]!;
      return {
        pts,
        couleur: couleursParEtat
          ? COULEURS_ETAT[fiche(suivi, s.td.parcelles[a.parcelle]!).etat]
          : COULEURS[s.couleurs[a.parcelle]! % COULEURS.length]!,
        courant: a.parcelle === parcelleCourante,
        nom: a.type === 1 ? s.td.parcelles[a.parcelle]!.nom : null,
      };
    }),
    traits: [],
    points: [],
  };
  const trait = (ref: RefLimite, epaisseur: number) => {
    const pts = anneaux[ref.anneau]!;
    d.traits.push({
      a: pts[ref.debut]!,
      b: pts[(ref.debut + 1) % pts.length]!,
      couleur: SEL,
      epaisseur,
    });
  };
  if (selLimite) trait(selLimite, 7);
  if (selSommet) {
    if (limiteGlisse) trait(limiteGlisse, 5);
    d.points.push({ p: anneaux[selSommet.anneau]![selSommet.sommet]!, couleur: SEL, rayon: 9 });
  }
  return d;
}

function panneauSelection(s: Session): HTMLElement {
  if (mode === 'limite') {
    if (!selLimite) return el('div', { class: 'info doux' }, 'Touchez une limite sur la carte.');
    const ref = selLimite;
    const x = nomParcelle(s, ref.anneau);
    const jum = limitesJumelles(s.etat, ref);
    const type = s.etat.anneaux[ref.anneau]!.type;
    let titre: string;
    let sens: string;
    if (jum.length > 0) {
      const y = jum.map((j) => nomParcelle(s, j.anneau)).join(', ');
      titre = `Limite commune ${x} / ${y}`;
      sens = `+ = vers ${y} (${x} s'agrandit) · − = vers ${x} (${y} s'agrandit)`;
    } else if (type === 1) {
      titre = `Limite ${coteLimite(s, ref)} de ${x}`;
      sens = `+ = vers l'extérieur (${x} s'agrandit) · − = vers l'intérieur`;
    } else {
      titre = `Bord de la zone exclue de ${x}`;
      sens = `+ = la zone exclue rétrécit (${x} s'agrandit) · − = elle s'agrandit`;
    }
    return el(
      'div',
      { class: 'info' },
      el('div', {}, el('strong', {}, titre)),
      el('div', { class: 'doux' }, `Longueur : ${longueur(s, ref).toFixed(1).replace('.', ',')} m`),
      el('div', { class: 'sens' }, sens),
    );
  }
  if (!selSommet) return el('div', { class: 'info doux' }, 'Touchez un sommet sur la carte.');
  const ref = selSommet;
  const autres = new Set(
    sommetsEn(s.etat, latLon(s.etat.anneaux[ref.anneau]!.sommets[ref.sommet]!))
      .map((r) => nomParcelle(s, r.anneau))
      .filter((n) => n !== nomParcelle(s, ref.anneau)),
  );
  const limites: RefLimite[] = [
    { anneau: ref.anneau, debut: ref.sommet },
    { anneau: ref.anneau, debut: precedent(s.etat, ref.anneau, ref.sommet) },
  ];
  const boutons = el(
    'div',
    { class: 'rangee' },
    ...limites.map((l) =>
      el(
        'button',
        {
          class: limiteGlisse?.debut === l.debut ? 'actif' : '',
          onclick: () => {
            limiteGlisse = l;
            afficher();
          },
        },
        `Limite ${coteLimite(s, l)} (${Math.round(longueur(s, l))} m)`,
      ),
    ),
  );
  let sens: string | null = null;
  if (limiteGlisse) {
    sens =
      sensPositif(s.etat, limiteGlisse) === 'Est'
        ? '+ = vers l’Est · − = vers l’Ouest'
        : '+ = vers le Nord · − = vers le Sud';
  }
  return el(
    'div',
    { class: 'info' },
    el(
      'div',
      {},
      el('strong', {}, `Sommet de ${nomParcelle(s, ref.anneau)}`),
      autres.size > 0 ? ` (commun avec ${[...autres].join(', ')})` : '',
    ),
    el(
      'div',
      { class: 'doux' },
      `Flèches : déplacer de ${enMetres(Math.abs(metres()))} m à chaque appui`,
    ),
    el(
      'div',
      { class: 'fleches' },
      el('span'),
      el('button', { onclick: () => fleche('Nord') }, '↑ N'),
      el('span'),
      el('button', { onclick: () => fleche('Ouest') }, '← O'),
      el(
        'button',
        {
          class: placerAuDoigt ? 'actif' : '',
          onclick: () => {
            placerAuDoigt = !placerAuDoigt;
            message = placerAuDoigt
              ? { texte: 'Touchez la carte à l’endroit où placer le point.', erreur: false }
              : null;
            afficher();
          },
        },
        'Au doigt',
      ),
      el('button', { onclick: () => fleche('Est') }, 'E →'),
      el('span'),
      el('button', { onclick: () => fleche('Sud') }, '↓ S'),
      el('span'),
    ),
    el('div', { class: 'rangee' }, el('button', { onclick: supprimer }, 'Supprimer ce point')),
    el('div', { class: 'doux' }, 'Ou le faire glisser le long d’une limite (puis « Appliquer ») :'),
    boutons,
    sens && el('div', { class: 'sens' }, sens),
  );
}

function pave(): HTMLElement {
  const changer = (v: string) => {
    saisie = v;
    afficher();
  };
  const touche = (k: string) => {
    let v = saisie;
    if (k === '⌫') v = v.slice(0, -1);
    else if (k === 'C') v = '';
    else if (k === '+') v = v.replace(/^-/, '');
    else if (k === '−') v = v.startsWith('-') ? v : '-' + v;
    else if (k === ',') {
      if (v.includes(',')) return;
      v = (v === '' || v === '-' ? v + '0' : v) + ',';
    } else {
      if (v === '0') v = '';
      if (v === '-0') v = '-';
      const [entier = '', decimales] = v.replace('-', '').split(',');
      // Au plus 4 chiffres avant la virgule et 3 après (le millimètre).
      if (decimales !== undefined ? decimales.length >= 3 : entier.length >= 4) return;
      v += k;
    }
    changer(v);
  };
  const touches = ['7', '8', '9', '⌫', '4', '5', '6', 'C', '1', '2', '3', '+', '−', '0', ','];
  return el(
    'div',
    {},
    el(
      'div',
      { class: 'rangee' },
      'Distance :',
      el('span', { class: 'affichage-cm' }, saisie === '' ? '0' : saisie),
      'm',
    ),
    el(
      'div',
      { class: 'raccourcis' },
      ...[-1, -0.5, -0.1, 0.1, 0.5, 1].map((v) =>
        el(
          'button',
          { onclick: () => changer(enMetres(metres() + v)) },
          v > 0 ? `+${enMetres(v)}` : `−${enMetres(-v)}`,
        ),
      ),
    ),
    el(
      'div',
      { class: 'pave', style: 'margin-top:6px' },
      ...touches.map((k) =>
        el(
          'button',
          { onclick: () => touche(k), style: k === '0' ? 'grid-column: span 2' : '' },
          k,
        ),
      ),
    ),
  );
}

function tableauSurfaces(s: Session): HTMLElement | null {
  const modifiees = parcellesModifiees(s.etat);
  if (modifiees.length === 0) return null;
  const ha = (m2: number) => (m2 / 10_000).toFixed(4).replace('.', ',');
  return el(
    'div',
    { class: 'info' },
    el('strong', {}, 'Surfaces (D)'),
    el(
      'table',
      {},
      el(
        'tr',
        {},
        el('th', {}, 'Parcelle'),
        el('th', {}, 'avant (ha)'),
        el('th', {}, 'après (ha)'),
        el('th', {}, 'écart (m²)'),
      ),
      ...modifiees.map((p) => {
        const avant = Number(s.td.parcelles[p]!.surface?.texte ?? NaN);
        const apres = nouvelleSurface(s.td, s.etat, p) ?? NaN;
        const ecart = Math.round(apres) - avant;
        return el(
          'tr',
          {},
          el('td', {}, s.td.parcelles[p]!.nom),
          el('td', {}, ha(avant)),
          el('td', {}, ha(Math.round(apres))),
          el('td', {}, signe(ecart)),
        );
      }),
    ),
  );
}

function panneauExport(): HTMLElement {
  const bloc = el(
    'div',
    { class: 'info' },
    el('strong', {}, 'Export'),
    el(
      'div',
      { class: 'rangee' },
      el('button', { onclick: preparerExport }, 'Vérifier avant export'),
    ),
  );
  if (exportPrepare) {
    const graves = exportPrepare.alertes.filter((a) => a.grave);
    bloc.append(
      el(
        'div',
        {},
        exportPrepare.alertes.length === 0
          ? el(
              'div',
              {},
              '✓ Contrôles : aucun problème (contours fermés, pas de recoupement ni de chevauchement, sommets communs identiques).',
            )
          : el(
              'div',
              {},
              ...exportPrepare.alertes.map((a) =>
                el('div', { class: a.grave ? 'erreur' : '' }, (a.grave ? '✗ ' : '⚠ ') + a.message),
              ),
            ),
        el('div', {}, `Différences avec l’original : ${exportPrepare.resume}`),
        el(
          'details',
          {},
          el('summary', {}, 'Voir chaque différence'),
          el('pre', {}, exportPrepare.details),
        ),
        el(
          'div',
          { class: 'rangee' },
          ecritureDossierPossible() &&
            el(
              'button',
              { class: 'principal', onclick: () => void telecharger('dossier') },
              graves.length > 0
                ? 'Enregistrer malgré tout'
                : `Enregistrer dans un dossier ${NOM_DOSSIER}`,
            ),
          el(
            'button',
            {
              class: ecritureDossierPossible() ? '' : 'principal',
              onclick: () => void telecharger('xml'),
            },
            `Télécharger ${NOM_FICHIER}`,
          ),
        ),
        el(
          'div',
          { class: 'doux' },
          ecritureDossierPossible()
            ? `« Enregistrer dans un dossier ${NOM_DOSSIER} » : choisissez la clé USB (ou un dossier ${NOM_DOSSIER}), le fichier ${NOM_FICHIER} est écrit dans le dossier ${NOM_DOSSIER}.`
            : `Ce navigateur ne permet pas d’écrire un dossier : ${NOM_FICHIER} arrive dans « Téléchargements ». Avec le gestionnaire de fichiers, créez un dossier ${NOM_DOSSIER} sur la clé et déplacez-y le fichier.`,
        ),
      ),
    );
  }
  return bloc;
}

// Zones fixes de la page : on ne remplace que leur contenu, jamais la page entière, pour que
// l'écran ne saute pas à chaque touche.
const zones = {
  entete: el('div'),
  parcelle: el('div'),
  carte: el('div'),
  suiviParcelle: el('div'),
  modes: el('div'),
  selection: el('div'),
  pave: el('div'),
  actions: el('div'),
  message: el('div'),
  surfaces: el('div'),
  export: el('div'),
  suiviGeneral: el('div'),
  remarques: el('div'),
};
zones.carte.append(carte.element);
app.replaceChildren(...Object.values(zones));

function remplir(
  zone: HTMLElement,
  ...contenu: (Node | string | null | false | undefined)[]
): void {
  zone.replaceChildren(...contenu.filter((c): c is Node | string => !!c));
}

function afficher(): void {
  // Précaution : on garde la position de défilement telle quelle.
  const defilement = window.scrollY;
  const choixFichier = el(
    'label',
    { class: 'bouton-fichier' },
    session ? 'Autre fichier' : 'Ouvrir TASKDATA.XML',
  );
  const input = el('input', { type: 'file' });
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) void charger(f);
  });
  choixFichier.append(input);

  const enTete = el(
    'div',
    { class: 'rangee' },
    el('h1', { style: 'flex:1' }, 'Contours parcelles'),
    choixFichier,
  );
  const msg =
    message && el('div', { class: message.erreur ? 'info erreur' : 'info' }, message.texte);

  remplir(zones.entete, enTete);
  remplir(zones.message, msg);
  if (!session) {
    zones.carte.hidden = true;
    for (const z of [zones.parcelle, zones.modes, zones.selection, zones.pave, zones.actions])
      remplir(z);
    remplir(zones.surfaces);
    remplir(
      zones.export,
      el(
        'div',
        { class: 'info' },
        'Ouvrez le fichier TASKDATA.XML exporté par la console (sur la clé USB, dans le dossier TASKDATA). ',
        'Tout reste sur le téléphone : rien n’est envoyé sur Internet.',
      ),
    );
    return;
  }
  const s = session;

  const choixParcelle = el('select', {});
  choixParcelle.append(el('option', { value: '' }, 'Toutes les parcelles'));
  s.td.parcelles
    .map((p, i) => ({ nom: p.nom, i }))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { numeric: true }))
    .forEach(({ nom, i }) => {
      const o = el('option', { value: String(i) }, nom);
      if (i === parcelleCourante) o.selected = true;
      choixParcelle.append(o);
    });
  choixParcelle.addEventListener('change', () => {
    parcelleCourante = choixParcelle.value === '' ? null : Number(choixParcelle.value);
    effacerSelection();
    afficher();
    if (parcelleCourante === null) cadrerTout();
    else cadrerParcelle(parcelleCourante);
  });

  const peutAppliquer =
    (mode === 'limite' && selLimite !== null) ||
    (mode === 'sommet' && selSommet !== null && limiteGlisse !== null);

  const modeBouton = (m: typeof mode, texte: string) =>
    el(
      'button',
      {
        class: mode === m ? 'principal' : '',
        onclick: () => {
          mode = m;
          effacerSelection();
          afficher();
        },
      },
      texte,
    );

  zones.carte.hidden = false;
  remplir(
    zones.parcelle,
    el(
      'div',
      { class: 'rangee' },
      choixParcelle,
      el('button', { onclick: () => carte.zoomer(1) }, '+'),
      el('button', { onclick: () => carte.zoomer(-1) }, '−'),
    ),
    el(
      'div',
      { class: 'rangee' },
      el(
        'button',
        { class: carte.gpsActif() ? 'actif' : '', onclick: () => carte.basculerGps() },
        carte.gpsActif() ? 'GPS : arrêter' : 'Ma position GPS',
      ),
      carte.gpsActif() && el('button', { onclick: () => carte.centrerSurGps() }, 'Centrer'),
      el(
        'button',
        {
          onclick: () => {
            couleursParEtat = !couleursParEtat;
            afficher();
          },
        },
        couleursParEtat ? 'Couleurs : état' : 'Couleurs : voisins',
      ),
      etatGps && el('span', { class: 'doux' }, etatGps),
    ),
  );
  remplir(
    zones.modes,
    el(
      'div',
      { class: 'rangee' },
      modeBouton('limite', 'Décaler une limite'),
      modeBouton('sommet', 'Déplacer un point'),
    ),
  );
  remplir(zones.suiviParcelle, panneauSuiviParcelle(s));
  remplir(zones.suiviGeneral, panneauSuiviGeneral(s));
  remplir(zones.selection, panneauSelection(s));
  remplir(zones.pave, pave());
  remplir(
    zones.actions,
    el(
      'div',
      { class: 'rangee' },
      el(
        'button',
        { class: 'principal', onclick: appliquer, ...(peutAppliquer ? {} : { disabled: '' }) },
        'Appliquer',
      ),
      el(
        'button',
        { onclick: annuler, ...(s.historique.length > 0 ? {} : { disabled: '' }) },
        'Annuler',
      ),
      el(
        'button',
        { onclick: reinitialiser, ...(s.historique.length > 0 ? {} : { disabled: '' }) },
        'Réinitialiser',
      ),
    ),
  );
  remplir(zones.surfaces, tableauSurfaces(s));
  remplir(zones.export, panneauExport());
  remplir(
    zones.remarques,
    s.alertesChargement.length > 0 &&
      el(
        'details',
        { class: 'info' },
        el('summary', {}, `Remarques sur le fichier (${s.alertesChargement.length})`),
        ...s.alertesChargement.map((a) => el('div', {}, a)),
      ),
  );
  carte.afficher(dessin(s));
  window.scrollTo({ top: defilement });
}

afficher();
