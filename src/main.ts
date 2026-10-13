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
  glisserSommetLeLong,
  placerSommet,
  cotesLimite,
  repereLeLong,
  retrouverLimite,
  bordLePlusCourt,
  simplifierParcelle,
  sommetsDuBord,
  supprimerSommet,
  type Bord,
} from './edition/operations';
import { planLocal, positionSurSegment, type LatLon, type Plan, type XY } from './geometrie/plan';
import { ecartMaximal } from './geometrie/simplification';
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
  enregistrerSession,
  garderSurAppareil,
  lireSurAppareil,
  oublierSurAppareil,
  relireSession,
} from './sauvegarde/session';
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

// Couleurs lisibles sur le cadastre (fond clair) comme sur la photo ; le violet est réservé à la
// sélection.
const COULEURS = ['#00b8d4', '#ff4081', '#64dd17', '#ffab00', '#2962ff', '#ff6e40'];
const SEL = '#d500f9';
const COULEURS_ETAT: Record<EtatContour, string> = {
  verifie: '#00c853',
  'a-confirmer': '#ffab00',
  'a-refaire': '#d50000',
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
  garderSession();
  majSuivi({ ...suivi, journal: [...suivi.journal, ...entrees] });
}

function retirerDuJournal(entrees: EntreeJournal[]): void {
  if (entrees.length === 0) return;
  majSuivi({ ...suivi, journal: suivi.journal.filter((e) => !entrees.includes(e)) });
}
let mode: 'limite' | 'sommet' | 'simplifier' = 'limite';
/** Tolérance de simplification choisie (m). */
let tolerance = 0.25;
const TOLERANCES = [0.1, 0.25, 0.5, 1];
/** Simplifier toute la parcelle, ou seulement un bord choisi entre deux sommets. */
let porteeSimplif: 'parcelle' | 'bord' = 'parcelle';
let bordDebut: RefSommet | null = null;
let bord: Bord | null = null;
let selLimite: RefLimite | null = null;
let selSommet: RefSommet | null = null;
let limiteGlisse: RefLimite | null = null;
/** Le prochain toucher sur la carte place le sommet sélectionné à cet endroit. */
let placerAuDoigt = false;
/** Sens choisi pour décaler la limite sélectionnée, avec les flèches posées sur la carte. */
let sensLimite: 'exterieur' | 'interieur' | null = null;
/** Sens choisi pour faire glisser le point le long du bord : vers l'autre extrémité ou à l'opposé. */
let sensGlisse: 'vers' | 'oppose' | null = null;
let parcelleCourante: number | null = null;
/** Distance en mètres telle que tapée, avec une virgule décimale (« -0,35 »). */
let saisie = '0,5';
let message: { texte: string; erreur: boolean } | null = null;
let exportPrepare: { texte: string; alertes: Alerte[]; resume: string; details: string } | null =
  null;

const app = document.getElementById('app')!;
// Texte d'état du GPS : élément fixe, mis à jour seul à chaque position reçue. Redessiner toute la
// page à chaque position refermerait la liste des parcelles si elle est ouverte.
const texteGps = el('span', { class: 'doux' });
/** État du GPS (allumé ou non) lors du dernier affichage des boutons. */
let gpsAffiche = false;
const carte = new Carte(toucher, (texte) => {
  texteGps.textContent = texte;
  if (carte.gpsActif() !== gpsAffiche) afficher();
});

// ---------- Chargement ----------

/** Ouvre un fichier lu (ou une session reprise) : `etat` est l'état modifié, s'il y en a un. */
function ouvrir(td: TaskData, nomFichier: string, etat: Etat | null, texteMessage: string): void {
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
    nomFichier,
    plan: planLocal(centre),
    initial,
    etat: etat ?? initial,
    historique: [],
    alertesChargement,
    couleurs: colorier(initial, td.parcelles.length),
  };
  parcelleCourante = null;
  onglet = 'modifier';
  effacerSelection();
  message = { texte: texteMessage, erreur: false };
  garderSession();
  afficher();
  cadrerTout();
}

async function charger(fichier: File): Promise<void> {
  try {
    const td = lireTaskData(decoder(new Uint8Array(await fichier.arrayBuffer())));
    if (
      session &&
      parcellesModifiees(session.etat).length > 0 &&
      !confirm(
        'Des modifications en cours sur le fichier ouvert seront perdues (pense à exporter). Continuer ?',
      )
    ) {
      return;
    }
    ouvrir(td, fichier.name, null, `${fichier.name} chargé : ${td.parcelles.length} parcelles.`);
  } catch (e) {
    message = { texte: `Lecture impossible : ${(e as Error).message}`, erreur: true };
    afficher();
  }
}

// ---------- Session gardée sur l'appareil ----------

/** Nom de cet appareil (pour la sauvegarde en ligne et le journal). */
function nomAppareil(): string {
  try {
    return stockage?.getItem('contour-parcelle/appareil') ?? 'appareil';
  } catch {
    return 'appareil';
  }
}

/** Enregistre le fichier ouvert et les contours modifiés sur l'appareil (après chaque changement). */
function garderSession(): void {
  if (!session) return;
  sessionNonGardee = !garderSurAppareil(
    stockage,
    enregistrerSession(session.td, session.nomFichier, session.etat, nomAppareil()),
  );
}

let sessionNonGardee = false;

/** Au démarrage : reprend le travail laissé sur cet appareil. */
function reprendreSession(): void {
  const brut = lireSurAppareil(stockage);
  if (!brut) return;
  try {
    const r = relireSession(brut);
    const n = parcellesModifiees(r.etat).length;
    ouvrir(
      r.td,
      r.nom,
      r.etat,
      `Travail repris : ${r.nom}, enregistré le ${quandFr(r.session.enregistreLe)}` +
        (n > 0 ? `, ${n} parcelle(s) modifiée(s).` : ', sans modification.'),
    );
  } catch {
    oublierSurAppareil(stockage);
  }
}

function fermerFichier(): void {
  if (!session) return;
  if (
    parcellesModifiees(session.etat).length > 0 &&
    !confirm('Fermer le fichier ? Les modifications non exportées seront perdues.')
  ) {
    return;
  }
  session = null;
  oublierSurAppareil(stockage);
  effacerSelection();
  message = { texte: 'Fichier fermé.', erreur: false };
  afficher();
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
      `Point de ${nomParcelle(s, ref.anneau)} placé au doigt : ajuste-le avec les flèches`,
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
  // Mode point, sommet déjà choisi : toucher un des deux bords qui y aboutissent choisit le bord
  // le long duquel il glissera (sans désélectionner le sommet).
  if (mode === 'sommet' && selSommet) {
    const ref = selSommet;
    const pts = anneaux[ref.anneau]!;
    const v = pts[ref.sommet]!;
    if (Math.hypot(v[0] - p[0], v[1] - p[1]) > rayon) {
      const candidats = [ref.sommet, precedent(s.etat, ref.anneau, ref.sommet)].map((debut) => {
        const a = pts[debut]!;
        const b = pts[(debut + 1) % pts.length]!;
        const pos = positionSurSegment(p, a, b);
        // Un toucher près d'une extrémité vise un sommet, pas le bord.
        const presDuBout = Math.min(
          Math.hypot(a[0] - p[0], a[1] - p[1]),
          Math.hypot(b[0] - p[0], b[1] - p[1]),
        );
        return {
          debut,
          d: pos.t >= 0 && pos.t <= 1 && presDuBout > rayon ? pos.ecart : Infinity,
        };
      });
      const bordTouche = candidats.sort((x, y) => x.d - y.d)[0]!;
      if (bordTouche.d <= rayon) {
        limiteGlisse = { anneau: ref.anneau, debut: bordTouche.debut };
        sensGlisse = null;
        message = null;
        onglet = 'modifier';
        afficher();
        return;
      }
    }
  }
  let meilleur: { anneau: number; indice: number; d: number } | null = null;
  for (const i of ordre) {
    const pts = anneaux[i]!;
    pts.forEach((q, k) => {
      let d: number;
      if (mode === 'sommet' || (mode === 'simplifier' && porteeSimplif === 'bord')) {
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
  const [ancienDebut, ancienBord] = [bordDebut, bord];
  effacerSelection();
  if (choix && mode === 'simplifier' && porteeSimplif === 'bord') {
    // Premier toucher : début du bord ; deuxième : fin ; un toucher de plus recommence.
    parcelleCourante = s.etat.anneaux[choix.anneau]!.parcelle;
    if (ancienDebut && !ancienBord && ancienDebut.anneau === choix.anneau) {
      if (ancienDebut.sommet !== choix.indice) {
        bordDebut = ancienDebut;
        bord = bordLePlusCourt(s.etat, choix.anneau, ancienDebut.sommet, choix.indice);
      } else bordDebut = ancienDebut;
    } else {
      bordDebut = { anneau: choix.anneau, sommet: choix.indice };
    }
    onglet = 'modifier';
  } else if (choix) {
    parcelleCourante = s.etat.anneaux[choix.anneau]!.parcelle;
    if (mode === 'limite') selLimite = { anneau: choix.anneau, debut: choix.indice };
    else if (mode === 'sommet') selSommet = { anneau: choix.anneau, sommet: choix.indice };
    onglet = 'modifier';
  } else {
    // Toucher à l'intérieur d'une parcelle (loin de ses limites) : on la sélectionne.
    const dedans = anneaux.findIndex(
      (pts, i) => s.etat.anneaux[i]!.type === 1 && pointDansPolygone(p, pts),
    );
    if (dedans >= 0) parcelleCourante = s.etat.anneaux[dedans]!.parcelle;
  }
  message = null;
  afficher();
}

function pointDansPolygone(p: XY, pts: XY[]): boolean {
  let dedans = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!;
    const [xj, yj] = pts[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      dedans = !dedans;
    }
  }
  return dedans;
}

function effacerSelection(): void {
  placerAuDoigt = false;
  sensGlisse = null;
  bordDebut = null;
  bord = null;
  sensLimite = null;
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

const DIRECTIONS = {
  NO: { est: -1, nord: 1, nom: 'le Nord-Ouest', fleche: '↖' },
  N: { est: 0, nord: 1, nom: 'le Nord', fleche: '↑' },
  NE: { est: 1, nord: 1, nom: 'le Nord-Est', fleche: '↗' },
  O: { est: -1, nord: 0, nom: 'l’Ouest', fleche: '←' },
  E: { est: 1, nord: 0, nom: 'l’Est', fleche: '→' },
  SO: { est: -1, nord: -1, nom: 'le Sud-Ouest', fleche: '↙' },
  S: { est: 0, nord: -1, nom: 'le Sud', fleche: '↓' },
  SE: { est: 1, nord: -1, nom: 'le Sud-Est', fleche: '↘' },
} as const;

/** Déplace le sommet sélectionné de la distance réglée (le long de la diagonale pour NO, NE…). */
function fleche(direction: keyof typeof DIRECTIONS): void {
  if (!session || !selSommet) return;
  const s = session;
  const ref = selSommet;
  const d = Math.abs(metres());
  if (d === 0) {
    message = { texte: 'Tape d’abord une distance.', erreur: true };
    afficher();
    return;
  }
  const { est, nord, nom } = DIRECTIONS[direction];
  const k = d / Math.hypot(est, nord);
  modifier(
    () => decalerSommet(s.etat, ref, est * k, nord * k),
    `Point de ${nomParcelle(s, ref.anneau)} déplacé de ${enMetres(d)} m vers ${nom}`,
    true,
  );
}

/** Croix de 8 flèches posée sur la carte, avec « au doigt » au centre. */
function commandesSommet(): HTMLElement {
  const bouton = (direction: keyof typeof DIRECTIONS) =>
    el(
      'button',
      { title: DIRECTIONS[direction].nom, onclick: () => fleche(direction) },
      DIRECTIONS[direction].fleche,
    );
  return el(
    'div',
    { class: 'croix' },
    bouton('NO'),
    bouton('N'),
    bouton('NE'),
    bouton('O'),
    el(
      'button',
      {
        class: placerAuDoigt ? 'actif' : '',
        title: 'Placer au doigt',
        onclick: () => {
          placerAuDoigt = !placerAuDoigt;
          message = placerAuDoigt
            ? { texte: 'Touche la carte à l’endroit où placer le point.', erreur: false }
            : null;
          afficher();
        },
      },
      '☝',
    ),
    bouton('E'),
    bouton('SO'),
    bouton('S'),
    bouton('SE'),
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

/** Aperçu de la simplification de la parcelle courante (rien n'est encore modifié). */
function apercuSimplification(s: Session) {
  if (mode !== 'simplifier' || parcelleCourante === null) return null;
  if (porteeSimplif === 'bord') {
    return bord ? simplifierParcelle(s.etat, parcelleCourante, tolerance, bord) : null;
  }
  return simplifierParcelle(s.etat, parcelleCourante, tolerance);
}

const enCm = (m: number) => `${Math.round(m * 100)} cm`;

function appliquer(): void {
  if (!session) return;
  const s = session;
  const d = metres();
  try {
    let nouveau: Etat;
    let quoi: string;
    if (mode === 'limite' && selLimite && sensLimite) {
      const ecart = Math.abs(d);
      quoi = `Limite ${coteLimite(s, selLimite)} de ${nomParcelle(s, selLimite.anneau)} décalée de ${enMetres(ecart)} m ${effetsLimite(s, selLimite)[sensLimite]}`;
      nouveau = decalerLimite(s.etat, selLimite, sensLimite === 'exterieur' ? ecart : -ecart);
    } else if (mode === 'sommet' && selSommet && limiteGlisse && sensGlisse) {
      quoi = `Point de ${nomParcelle(s, selSommet.anneau)} glissé de ${enMetres(Math.abs(d))} m ${sensGlisse === 'vers' ? 'le long du bord (le bord raccourcit)' : 'dans le prolongement du bord'}`;
      nouveau = glisserSommetLeLong(s.etat, selSommet, limiteGlisse, d, sensGlisse === 'vers');
    } else if (mode === 'simplifier' && parcelleCourante !== null && apercuSimplification(s)) {
      const r = apercuSimplification(s)!;
      const avant = r.bilan.reduce((n, b) => n + b.avant, 0);
      const apres = r.bilan.reduce((n, b) => n + b.apres, 0);
      quoi = `${s.td.parcelles[parcelleCourante]!.nom}${porteeSimplif === 'bord' ? ' (un bord)' : ''} simplifiée (tolérance ${enCm(tolerance)}) : ${avant} → ${apres} points`;
      nouveau = r.etat;
    } else {
      return;
    }
    if (nouveau === s.etat) return;
    const avant = s.etat;
    enregistrerModification(s, nouveau, quoi);
    if (mode === 'limite' && selLimite) {
      // La limite reste sélectionnée (avec son sens) pour pouvoir appliquer plusieurs fois.
      const retrouvee = retrouverLimite(avant, nouveau, selLimite);
      const sens = sensLimite;
      effacerSelection();
      if (retrouvee) {
        selLimite = retrouvee;
        sensLimite = sens;
      }
    } else if (mode === 'sommet') {
      // Le sommet ne change pas d'indice en glissant : on garde sommet, bord et sens.
      exportPrepare = null;
    } else {
      effacerSelection();
      // Une simplification se fait une fois : on revient au décalage de limite pour les retouches.
      if (mode === 'simplifier') mode = 'limite';
    }
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

function annuler(): void {
  const precedent = session?.historique.pop();
  if (!session || !precedent) return;
  session.etat = precedent.etat;
  retirerDuJournal(precedent.journal);
  garderSession();
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
  garderSession();
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
        confirm(`${c} existe déjà. Le remplacer ?\n\nConseil : travaille sur une copie.`),
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
let suiviOuvert = true;

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
      el('tr', {}, el('th', {}, 'Parcelle'), el('th', {}, 'État ✓ ? ✗'), el('th', {}, 'Date')),
      ...parcelles.map(({ p, i, f }) => {
        const nom = el('td', { class: 'cliquable' }, p.nom);
        nom.addEventListener('click', () => {
          parcelleCourante = i;
          effacerSelection();
          afficher();
          cadrerParcelle(i);
        });
        const ligne = el(
          'tr',
          {},
          nom,
          el(
            'td',
            { class: 'etats' },
            ...(Object.keys(LIBELLES) as EtatContour[]).map((e) =>
              el(
                'button',
                {
                  class: `petit etat-${e}${f.etat === e ? ' choisi' : ''}`,
                  title: LIBELLES[e],
                  onclick: () => {
                    majSuivi(changerFiche(suivi, p, { etat: e }));
                    afficher();
                  },
                },
                { verifie: '✓', 'a-confirmer': '?', 'a-refaire': '✗' }[e],
              ),
            ),
          ),
          el('td', {}, dateFr(f.date)),
        );
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
  // Simplification : la parcelle courante est dessinée telle qu'elle serait, l'actuelle en pointillés.
  const apercu = apercuSimplification(s);
  const affiches = apercu ? apercu.etat.anneaux.map((a) => a.sommets.map(latLon)) : anneaux;
  const d: Dessin = {
    fantomes: apercu
      ? anneaux.filter((_, i) => s.etat.anneaux[i]!.parcelle === parcelleCourante)
      : [],
    anneaux: affiches.map((pts, i) => {
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
  if (mode === 'simplifier' && (bord || bordDebut)) {
    const ring = (bord ?? bordDebut)!.anneau;
    const pts = anneaux[ring]!;
    if (bord) {
      const ids = sommetsDuBord(s.etat, bord);
      for (let k = 1; k < ids.length; k++) {
        d.traits.push({ a: pts[ids[k - 1]!]!, b: pts[ids[k]!]!, couleur: SEL, epaisseur: 6 });
      }
    }
    const debut = bord ? bord.debut : bordDebut!.sommet;
    d.points.push({ p: pts[debut]!, couleur: SEL, rayon: 8 });
    if (bord) d.points.push({ p: pts[bord.fin]!, couleur: SEL, rayon: 8 });
  }
  if (selLimite) {
    trait(selLimite, 7);
    const ref = selLimite;
    const c = cotesLimite(s.etat, ref);
    d.fleches = (['exterieur', 'interieur'] as const).map((sens) => ({
      depuis: c.milieu,
      vers: c[sens],
      choisie: sensLimite === sens,
      action: () => {
        sensLimite = sens;
        onglet = 'modifier';
        afficher();
      },
    }));
  }
  if (selSommet) {
    if (limiteGlisse) {
      trait(limiteGlisse, 5);
      const ref = selSommet;
      const limite = limiteGlisse;
      d.fleches = (['vers', 'oppose'] as const).map((sens) => ({
        depuis: latLon(s.etat.anneaux[ref.anneau]!.sommets[ref.sommet]!),
        vers: repereLeLong(s.etat, ref, limite, sens === 'vers'),
        choisie: sensGlisse === sens,
        action: () => {
          sensGlisse = sens;
          afficher();
        },
      }));
    }
    d.points.push({ p: anneaux[selSommet.anneau]![selSommet.sommet]!, couleur: SEL, rayon: 9 });
  }
  return d;
}

/** Ce qu'on obtient en décalant la limite vers l'extérieur ou l'intérieur de sa parcelle. */
function effetsLimite(s: Session, ref: RefLimite): { exterieur: string; interieur: string } {
  const x = nomParcelle(s, ref.anneau);
  const jum = limitesJumelles(s.etat, ref);
  if (jum.length > 0) {
    const y = jum.map((j) => nomParcelle(s, j.anneau)).join(', ');
    return {
      exterieur: `vers ${y} (${x} s'agrandit)`,
      interieur: `vers ${x} (${y} s'agrandit)`,
    };
  }
  if (s.etat.anneaux[ref.anneau]!.type === 2) {
    return {
      exterieur: `dans la zone exclue (${x} s'agrandit)`,
      interieur: `vers ${x} (la zone exclue s'agrandit)`,
    };
  }
  return {
    exterieur: `vers l'extérieur (${x} s'agrandit)`,
    interieur: `vers l'intérieur (${x} rétrécit)`,
  };
}

function panneauSimplification(s: Session): HTMLElement {
  const portee = el(
    'div',
    { class: 'rangee' },
    ...(
      [
        ['parcelle', 'Toute la parcelle'],
        ['bord', 'Un bord'],
      ] as const
    ).map(([v, t]) =>
      el(
        'button',
        {
          class: porteeSimplif === v ? 'actif' : '',
          onclick: () => {
            porteeSimplif = v;
            bordDebut = null;
            bord = null;
            afficher();
          },
        },
        t,
      ),
    ),
  );
  if (porteeSimplif === 'bord' && !bord) {
    return el(
      'div',
      { class: 'info' },
      portee,
      el(
        'div',
        { class: 'sens' },
        bordDebut
          ? 'Touche maintenant le dernier sommet du bord.'
          : 'Touche le premier sommet du bord à simplifier.',
      ),
    );
  }
  if (parcelleCourante === null) {
    return el(
      'div',
      { class: 'info' },
      portee,
      el('div', { class: 'doux' }, 'Touche une parcelle sur la carte.'),
    );
  }
  const p = parcelleCourante;
  const r = apercuSimplification(s)!;
  const avant = r.bilan.reduce((n, b) => n + b.avant, 0);
  const apres = r.bilan.reduce((n, b) => n + b.apres, 0);
  const ecart = Math.max(...r.bilan.map((b) => b.ecartMax));
  const surface = Math.round(
    (nouvelleSurface(s.td, r.etat, p) ?? 0) - (nouvelleSurface(s.td, s.etat, p) ?? 0),
  );
  // Écart avec le contour du fichier d'origine : il s'additionne si on simplifie plusieurs fois.
  const ecartOrigine = Math.max(
    ...r.etat.anneaux.flatMap((a, i) => {
      if (a.parcelle !== p) return [];
      const plan = planLocal(latLon(s.initial.anneaux[i]!.sommets[0]!));
      const versXY = (ss: readonly { lat: number; lon: number }[]) =>
        ss.map((x) => plan.versXY([x.lat, x.lon]));
      return [ecartMaximal(versXY(s.initial.anneaux[i]!.sommets), versXY(a.sommets))];
    }),
  );
  return el(
    'div',
    { class: 'info' },
    el('strong', {}, `Simplifier ${s.td.parcelles[p]!.nom}`),
    portee,
    bord &&
      el(
        'div',
        { class: 'rangee' },
        el('span', { class: 'doux' }, `Bord de ${sommetsDuBord(s.etat, bord).length} points.`),
        el(
          'button',
          {
            onclick: () => {
              if (bord) bord = { ...bord, aRebours: !bord.aRebours };
              afficher();
            },
          },
          'L’autre partie du contour',
        ),
      ),
    el('div', { class: 'doux' }, 'Tolérance : écart maximal accepté avec le contour actuel.'),
    el(
      'div',
      { class: 'rangee' },
      ...TOLERANCES.map((t) =>
        el(
          'button',
          {
            class: t === tolerance ? 'actif' : '',
            onclick: () => {
              tolerance = t;
              afficher();
            },
          },
          t < 1 ? enCm(t) : `${t} m`,
        ),
      ),
    ),
    el(
      'div',
      { class: 'sens' },
      `${avant} → ${apres} points · écart max ${enCm(ecart)} · surface ${surface >= 0 ? '+' : ''}${surface} m²`,
    ),
    Math.abs(ecartOrigine - ecart) > 0.005 &&
      el(
        'div',
        { class: ecartOrigine > tolerance ? 'erreur' : 'doux' },
        `Écart max avec le contour du fichier d’origine : ${enCm(ecartOrigine)}` +
          (ecartOrigine > tolerance ? ' (plus que la tolérance : déjà simplifiée ?)' : ''),
      ),
    el(
      'div',
      { class: 'doux' },
      'Aperçu : pointillés = contour actuel. Les côtés sont redressés et les coins recalculés ; les sommets communs avec les voisins ne bougent pas. « Appliquer » pour valider.',
    ),
  );
}

function panneauSelection(s: Session): HTMLElement {
  if (mode === 'limite') {
    if (!selLimite) return el('div', { class: 'info doux' }, 'Touche une limite sur la carte.');
    const ref = selLimite;
    const x = nomParcelle(s, ref.anneau);
    const jum = limitesJumelles(s.etat, ref);
    const type = s.etat.anneaux[ref.anneau]!.type;
    const titre =
      jum.length > 0
        ? `Limite commune ${x} / ${jum.map((j) => nomParcelle(s, j.anneau)).join(', ')}`
        : type === 1
          ? `Limite ${coteLimite(s, ref)} de ${x}`
          : `Bord de la zone exclue de ${x}`;
    return el(
      'div',
      { class: 'info' },
      el('div', {}, el('strong', {}, titre)),
      el('div', { class: 'doux' }, `Longueur : ${longueur(s, ref).toFixed(1).replace('.', ',')} m`),
      sensLimite
        ? el('div', { class: 'sens' }, `Sens : ${effetsLimite(s, ref)[sensLimite]}`)
        : el(
            'div',
            { class: 'sens' },
            'Touche une des deux flèches sur la carte pour choisir le sens.',
          ),
    );
  }
  if (!selSommet) return el('div', { class: 'info doux' }, 'Touche un sommet sur la carte.');
  const ref = selSommet;
  const autres = new Set(
    sommetsEn(s.etat, latLon(s.etat.anneaux[ref.anneau]!.sommets[ref.sommet]!))
      .map((r) => nomParcelle(s, r.anneau))
      .filter((n) => n !== nomParcelle(s, ref.anneau)),
  );
  const glisse = !limiteGlisse
    ? 'Pour le faire glisser le long d’un bord : touche ce bord sur la carte.'
    : !sensGlisse
      ? 'Touche une des deux flèches le long du bord pour le sens, puis « Appliquer ».'
      : sensGlisse === 'vers'
        ? 'Sens : le long du bord (le bord raccourcit).'
        : 'Sens : dans le prolongement du bord (le bord s’allonge).';
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
      'Flèches en haut à gauche de la carte : la distance réglée à chaque appui ; ☝ au centre : placer au doigt.',
    ),
    el('div', { class: 'rangee' }, el('button', { onclick: supprimer }, 'Supprimer ce point')),
    el('div', { class: 'sens' }, glisse),
  );
}

/** Distances pré-remplies : elles s'ajoutent à la distance affichée en bas. */
function raccourcis(): HTMLElement {
  return el(
    'div',
    { class: 'raccourcis' },
    ...[-1, -0.5, -0.1, 0.1, 0.5, 1].map((v) =>
      el(
        'button',
        {
          onclick: () => {
            saisie = enMetres(Math.max(0, metres() + v));
            afficher();
          },
        },
        v > 0 ? `+${enMetres(v)}` : `−${enMetres(-v)}`,
      ),
    ),
  );
}

// Case de la distance (barre du bas) : un vrai champ, pour avoir le clavier numérique du téléphone.
// Elle est créée une seule fois : la recréer pendant la saisie fermerait le clavier.
const champDistance = el('input', {
  type: 'text',
  inputmode: 'decimal',
  enterkeyhint: 'done',
  autocomplete: 'off',
  class: 'champ-distance',
  'aria-label': 'Distance en mètres',
});
champDistance.addEventListener('input', () => {
  // Chiffres et une virgule (le point est accepté et converti) ; pas de signe : ce sont les
  // flèches sur la carte qui donnent le sens.
  const propre = champDistance.value
    .replace('.', ',')
    .replace(/[^0-9,]/g, '')
    .replace(/,(?=.*,)/g, '');
  if (propre !== champDistance.value) champDistance.value = propre;
  saisie = propre;
});
champDistance.addEventListener('change', () => {
  // Pas de redessin ici : si on tape la distance puis « Appliquer », la case perd la main juste
  // avant l'appui ; redessiner la barre à ce moment ferait perdre l'appui sur le bouton.
  saisie = champDistance.value === '' ? '' : enMetres(metres());
  champDistance.value = saisie;
});
champDistance.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') champDistance.blur();
});

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
          el(
            'button',
            { class: 'principal', onclick: () => void telecharger('xml') },
            graves.length > 0 ? 'Télécharger malgré tout' : `Télécharger ${NOM_FICHIER}`,
          ),
          ecritureDossierPossible() &&
            el(
              'button',
              { onclick: () => void telecharger('dossier') },
              `Enregistrer dans un dossier ${NOM_DOSSIER}`,
            ),
        ),
        el(
          'div',
          { class: 'doux' },
          `${NOM_FICHIER} arrive dans « Téléchargements ». Avec le gestionnaire de fichiers, mets-le dans un dossier ${NOM_DOSSIER} sur la clé.`,
        ),
      ),
    );
  }
  return bloc;
}

// Zones fixes de la page : on ne remplace que leur contenu, jamais la page entière, pour que
// l'écran ne saute pas à chaque touche.
// ---------- Mise en page ----------
//
// La page ne défile pas : barre du haut, carte, onglets et leur panneau (seul à défiler), puis une
// barre du bas toujours visible (distance, Appliquer, Annuler).

type Onglet = 'modifier' | 'suivi' | 'export' | 'fichier';
const ONGLETS: Record<Onglet, string> = {
  modifier: 'Modifier',
  suivi: 'Suivi',
  export: 'Export',
  fichier: 'Fichier',
};
let onglet: Onglet = 'fichier';

const zones = {
  haut: el('div', { class: 'barre-haut' }),
  carte: el('div', { class: 'zone-carte' }),
  onglets: el('div', { class: 'onglets' }),
  panneau: el('div', { class: 'panneau' }),
  bas: el('div', { class: 'barre-bas' }),
};
zones.carte.append(carte.element, el('div', { class: 'gps-sur-carte' }, texteGps));
app.classList.add('mise-en-page');
app.replaceChildren(...Object.values(zones));

function remplir(
  zone: HTMLElement,
  ...contenu: (Node | string | null | false | undefined)[]
): void {
  zone.replaceChildren(...contenu.filter((c): c is Node | string => !!c));
}

function boutonFichier(): HTMLElement {
  const choix = el(
    'label',
    { class: 'bouton-fichier' },
    session ? 'Ouvrir un autre TASKDATA.XML' : 'Ouvrir TASKDATA.XML',
  );
  const input = el('input', { type: 'file' });
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) void charger(f);
  });
  choix.append(input);
  return choix;
}

function contenuFichier(s: Session | null): Node[] {
  const contenu: Node[] = [
    el('h1', {}, 'Contours parcelles'),
    el('div', { class: 'rangee' }, boutonFichier()),
    el(
      'div',
      { class: 'doux' },
      'Ouvre le fichier TASKDATA.XML exporté par la console (sur la clé USB, dans le dossier TASKDATA). ',
      'Tout reste sur le téléphone : rien n’est envoyé sur Internet.',
    ),
  ];
  if (s) {
    contenu.push(
      el(
        'div',
        { class: 'rangee' },
        el(
          'button',
          { onclick: reinitialiser, ...(s.historique.length > 0 ? {} : { disabled: '' }) },
          'Réinitialiser (revenir au fichier d’origine)',
        ),
        el('button', { onclick: fermerFichier }, 'Fermer le fichier'),
      ),
      el(
        'div',
        { class: sessionNonGardee ? 'erreur' : 'doux' },
        sessionNonGardee
          ? 'Attention : le travail n’a pas pu être enregistré sur cet appareil.'
          : `${s.nomFichier} et tes modifications sont enregistrés sur cet appareil : tu les retrouves en rouvrant la page.`,
      ),
    );
    if (s.alertesChargement.length > 0) {
      contenu.push(
        el(
          'div',
          { class: 'info' },
          el('strong', {}, `Remarques sur le fichier (${s.alertesChargement.length})`),
          ...s.alertesChargement.map((a) => el('div', {}, a)),
        ),
      );
    }
  }
  return contenu;
}

function afficher(): void {
  gpsAffiche = carte.gpsActif();
  const defilement = zones.panneau.scrollTop;
  const msg =
    message && el('div', { class: message.erreur ? 'info erreur' : 'info' }, message.texte);

  if (!session) {
    onglet = 'fichier';
    zones.carte.hidden = true;
    remplir(zones.haut);
    remplir(zones.onglets);
    remplir(zones.bas);
    remplir(zones.panneau, msg, ...contenuFichier(null));
    carte.definirCommandes(null);
    return;
  }
  const s = session;
  zones.carte.hidden = false;

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

  remplir(
    zones.haut,
    choixParcelle,
    el('button', { onclick: () => carte.zoomer(1) }, '+'),
    el('button', { onclick: () => carte.zoomer(-1) }, '−'),
    el(
      'button',
      {
        class: carte.gpsActif() ? 'actif' : '',
        onclick: () => {
          carte.basculerGps();
          afficher();
        },
      },
      'GPS',
    ),
    carte.gpsActif() && el('button', { onclick: () => carte.centrerSurGps() }, '⌖'),
  );

  remplir(
    zones.onglets,
    ...(Object.keys(ONGLETS) as Onglet[]).map((o) =>
      el(
        'button',
        {
          class: o === onglet ? 'onglet choisi' : 'onglet',
          onclick: () => {
            onglet = o;
            zones.panneau.scrollTop = 0;
            afficher();
          },
        },
        ONGLETS[o],
      ),
    ),
  );

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

  let contenu: (Node | null | false)[];
  switch (onglet) {
    case 'modifier':
      contenu = [
        el(
          'div',
          { class: 'modes' },
          modeBouton('limite', 'Limite'),
          modeBouton('sommet', 'Point'),
          modeBouton('simplifier', 'Simplifier'),
        ),
        mode === 'simplifier' ? panneauSimplification(s) : panneauSelection(s),
        raccourcis(),
      ];
      break;
    case 'suivi':
      contenu = [
        panneauSuiviParcelle(s) ??
          el(
            'div',
            { class: 'info doux' },
            'Touche une parcelle sur la carte pour régler son état.',
          ),
        el(
          'div',
          { class: 'rangee' },
          el(
            'button',
            {
              onclick: () => {
                couleursParEtat = !couleursParEtat;
                afficher();
              },
            },
            couleursParEtat ? 'Couleurs de la carte : état' : 'Couleurs de la carte : voisins',
          ),
        ),
        panneauSuiviGeneral(s),
      ];
      break;
    case 'export':
      contenu = [tableauSurfaces(s), panneauExport()];
      break;
    case 'fichier':
      contenu = contenuFichier(s);
      break;
  }
  remplir(zones.panneau, msg, ...contenu);

  const peutAppliquer =
    (mode === 'limite' && selLimite !== null && sensLimite !== null) ||
    (mode === 'sommet' && selSommet !== null && limiteGlisse !== null && sensGlisse !== null) ||
    (mode === 'simplifier' &&
      (apercuSimplification(s)?.bilan.some((b) => b.apres !== b.avant || b.ecartMax > 0) ?? false));
  remplir(
    zones.bas,
    el('label', { class: 'case-distance' }, champDistance, 'm'),
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
  );
  if (document.activeElement !== champDistance) champDistance.value = saisie;
  carte.definirCommandes(mode === 'sommet' && selSommet ? commandesSommet() : null);
  carte.afficher(dessin(s));
  zones.panneau.scrollTop = defilement;
}

afficher();
reprendreSession();
