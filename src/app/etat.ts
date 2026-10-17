// État de l'interface partagé par tous les modules, et constantes d'affichage.
//
// Tout ce qui change pendant l'utilisation est dans l'objet `ui` : un seul endroit, avec ses
// valeurs de départ (certaines relues sur l'appareil).

import { type Alerte } from '../edition/controles';
import { type Etat, type RefLimite, type RefSommet } from '../edition/etat';
import { type Bord } from '../edition/operations';
import { type Outil } from '../edition/optimisation';
import { type LatLon, type Plan } from '../geometrie/plan';
import { type TaskData } from '../isoxml/lecture';
import { type FichierDrive } from '../sauvegarde/drive';
import {
  charger as chargerSuivi,
  type EntreeJournal,
  type EtatContour,
  type Suivi,
} from '../suivi/suivi';
import { lireStockage, stockage } from './stockage';

/** Fichier ouvert et travail en cours. */
export interface Session {
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

export type Onglet = 'modifier' | 'guidage' | 'suivi' | 'export' | 'fichier';
export const ONGLETS: Record<Onglet, string> = {
  modifier: 'Modifier',
  guidage: 'Guidage',
  suivi: 'Suivi',
  export: 'Export',
  fichier: 'Fichier',
};

/** Hauteur du volet (mise en page « volet », en portrait). */
export type Cran = 'replie' | 'moitie' | 'plein';

// Réglages gardés sur l'appareil.
export const CLE_SESSION_ILLISIBLE = 'contour-parcelle/session-illisible';
export const CLE_JEUX_MASQUES = 'contour-parcelle/jeux-masques';
export const CLE_MISE_EN_PAGE = 'contour-parcelle/mise-en-page';
export const CLE_HAUTEUR_VOLET = 'contour-parcelle/hauteur-volet';
export const CLE_OUTILS = 'contour-parcelle/outils';
export const CLE_OUTIL_CHOISI = 'contour-parcelle/outil-choisi';
export const CLE_DOSSIER_SAUVEGARDES = 'contour-parcelle/dossier-sauvegardes';

export interface EtatInterface {
  session: Session | null;
  /** Suivi des contours et journal : gardés sur l'appareil, indépendamment du fichier ouvert. */
  suivi: Suivi;
  suiviNonEnregistre: boolean;
  /** Couleur des parcelles sur la carte : selon l'état du contour, ou pour distinguer les voisines. */
  couleursParEtat: boolean;
  mode: 'limite' | 'sommet' | 'simplifier' | 'guidage' | 'coller';
  /** Mode de l'onglet Modifier, repris en revenant de l'onglet Guidage. */
  modeModifier: 'limite' | 'sommet' | 'simplifier' | 'coller';
  /** Mode Bord : dernière action choisie (Simplifier ou Coller), reprise au retour dans le mode. */
  /** Mode Limite : décaler la limite touchée, ou coller un bord sur la voisine. */
  actionLimite: 'limite' | 'coller';
  /** Mode Coller : anneau de la parcelle voisine qui sert de modèle. */
  modele: number | null;
  /** Ligne de guidage en préparation : droite AB ou courbe, vers l'intérieur ou l'extérieur. */
  typeGuidage: 'ab' | 'courbe';
  guidageInterieur: boolean;
  /** Une ligne sur un bord choisi, une par côté de la parcelle, ou pour toutes les parcelles. */
  porteeGuidage: 'bord' | 'parcelle' | 'toutes' | 'optimiser';
  /** Outils retenus sur l'appareil (optimisation du guidage) et celui choisi. */
  outils: Outil[];
  outilChoisi: number;
  /** Proposition d'optimisation choisie (0 = la meilleure). */
  /** Proposition choisie (0, 1, 2…) ; -1 : passages parallèles au côté touché (`coteOptimise`). */
  propositionChoisie: number;
  /** Optimisation : côté du contour touché sur la carte (segment du contour extérieur). */
  coteOptimise: { parcelle: number; segment: number } | null;
  /** Optimisation : créer aussi les lignes des tours de tournière. */
  lignesTourniere: boolean;
  /** Angle à partir duquel un sommet est un coin (lignes de toute la parcelle). */
  seuilCoins: number;
  /** Tolérance de simplification choisie (m). */
  tolerance: number;
  /** Simplifier toute la parcelle, ou seulement un bord choisi entre deux sommets. */
  porteeSimplif: 'parcelle' | 'bord';
  bordDebut: RefSommet | null;
  bord: Bord | null;
  selLimite: RefLimite | null;
  selSommet: RefSommet | null;
  limiteGlisse: RefLimite | null;
  /** Le prochain toucher sur la carte place le sommet sélectionné à cet endroit. */
  placerAuDoigt: boolean;
  /** Ancien fichier affiché en référence (gris) : ses points servent d'aimant pour « au doigt ». */
  reference: {
    nom: string;
    anneaux: LatLon[][];
    /** Contour extérieur de chaque parcelle de la référence, pour « Remplacer le contour ». */
    parcelles: { nom: string; guid: string; contour: LatLon[] }[];
  } | null;
  /** Mode Point : le prochain toucher sur une limite y ajoute un point. */
  ajoutEnCours: boolean;
  /** Sens choisi pour décaler la limite sélectionnée, avec les flèches posées sur la carte. */
  sensLimite: 'exterieur' | 'interieur' | null;
  /** Sens choisi pour faire glisser le point le long du bord : vers l'autre extrémité ou à l'opposé. */
  sensGlisse: 'vers' | 'oppose' | null;
  parcelleCourante: number | null;
  /** Distance en mètres telle que tapée, avec une virgule décimale (« 0,35 »). */
  saisie: string;
  message: { texte: string; erreur: boolean } | null;
  /** Export préparé pour l'état `etat` (refait s'il a changé depuis). */
  exportPrepare: {
    texte: string;
    alertes: Alerte[];
    resume: string;
    details: string;
    etat: Etat;
  } | null;
  /** Pourquoi l'export n'a pas pu être préparé, ou null. */
  erreurExport: string | null;
  /** État du GPS (allumé ou non) lors du dernier affichage des boutons. */
  gpsAffiche: boolean;
  minuterieDrive: ReturnType<typeof setTimeout> | undefined;
  /** Sauvegarde en ligne plus récente que ce que cet appareil a vu : l'utilisateur doit choisir. */
  driveConflit: FichierDrive | null;
  sessionNonGardee: boolean;
  /** Travail enregistré qui n'a pas pu être repris (gardé pour ne rien perdre). */
  sessionIllisible: string | null;
  /** Points de la mesure en cours (null : outil de mesure fermé). */
  mesure: LatLon[] | null;
  /** Note en cours de saisie (onglet Suivi) : null si aucune. `id` null pour une nouvelle note. */
  noteEnCours: {
    id: string | null;
    parcelle: number;
    position: [number, number] | null;
    obstacle: boolean;
    /** Zone dessinée (position = un point à l'intérieur), ou null. */
    zone: [number, number][] | null;
  } | null;
  /**
   * Zone de la note en cours de tracé : coins touchés sur la carte (« points »), ou positions
   * GPS enregistrées en faisant le tour à pied (« gps »). null : aucun tracé.
   */
  traceZone: {
    mode: 'points' | 'gps';
    /** Zone d'une note, nouvelle zone exclue de la parcelle `parcelle`, ou nouvelle parcelle. */
    pour: 'note' | 'exclue' | 'parcelle';
    parcelle: number | null;
    points: LatLon[];
    precision: number | null;
  } | null;
  /** Le prochain toucher sur la carte donne l'endroit de la note en cours. */
  placementNote: boolean;
  /** Ligne de guidage montrée sur la carte (touchée dans la liste « Lignes déjà créées »). */
  ligneVue: { parcelle: number; nom: string } | null;
  /** Note montrée sur la carte (nom affiché sous l'épingle). */
  noteVue: string | null;
  /** Jeux de lignes de guidage masqués à l'écran. */
  jeuxMasques: Set<string>;
  menuLignesOuvert: boolean;
  /** Emplacement mémorisé pour « Enregistrer sur la clé » (nom affiché), ou null. */
  emplacementConnu: string | null;
  /** Dossier des sauvegardes choisi (« Documents/Contour parcelle »), ou null : Téléchargements. */
  dossierSauvegardes: string | null;
  /** Onglet Suivi : parcelle choisie, liste de toutes les parcelles ou journal. */
  porteeSuivi: 'parcelle' | 'toutes' | 'journal';
  /** Liste « Toutes » réduite à un état (un appui sur un compteur), ou null. */
  filtreSuivi: EtatContour | null;
  onglet: Onglet;
  messageAffiche: { texte: string; erreur: boolean } | null;
  minuterieBulle: ReturnType<typeof setTimeout> | undefined;
  /** Mise en page « volet » (sinon classique). */
  voletActif: boolean;
  cran: Cran;
}

function outilsGardes(): Outil[] {
  try {
    const l = JSON.parse(lireStockage(CLE_OUTILS) ?? '[]') as Outil[];
    return Array.isArray(l) ? l.filter((o) => o && o.nom && o.largeur > 0) : [];
  } catch {
    return [];
  }
}

function jeuxMasquesGardes(): Set<string> {
  try {
    return new Set(JSON.parse(lireStockage(CLE_JEUX_MASQUES) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

export const ui: EtatInterface = {
  session: null,
  suivi: chargerSuivi(stockage),
  suiviNonEnregistre: false,
  couleursParEtat: true,
  mode: 'limite',
  modele: null,
  modeModifier: 'limite',
  actionLimite: 'limite',
  typeGuidage: 'ab',
  guidageInterieur: true,
  porteeGuidage: 'bord',
  outils: outilsGardes(),
  outilChoisi: Number(lireStockage(CLE_OUTIL_CHOISI) ?? 0) || 0,
  propositionChoisie: 0,
  coteOptimise: null,
  lignesTourniere: true,
  seuilCoins: 30,
  tolerance: 0.25,
  porteeSimplif: 'parcelle',
  bordDebut: null,
  bord: null,
  selLimite: null,
  selSommet: null,
  limiteGlisse: null,
  placerAuDoigt: false,
  reference: null,
  ajoutEnCours: false,
  sensLimite: null,
  sensGlisse: null,
  parcelleCourante: null,
  saisie: '',
  message: null,
  exportPrepare: null,
  erreurExport: null,
  gpsAffiche: false,
  minuterieDrive: undefined,
  driveConflit: null,
  sessionNonGardee: false,
  sessionIllisible: lireStockage(CLE_SESSION_ILLISIBLE),
  mesure: null,
  jeuxMasques: jeuxMasquesGardes(),
  menuLignesOuvert: false,
  noteEnCours: null,
  traceZone: null,
  placementNote: false,
  noteVue: null,
  ligneVue: null,
  emplacementConnu: null,
  dossierSauvegardes: lireStockage(CLE_DOSSIER_SAUVEGARDES),
  porteeSuivi: 'parcelle',
  filtreSuivi: null,
  onglet: 'fichier',
  messageAffiche: null,
  minuterieBulle: undefined,
  voletActif: lireStockage(CLE_MISE_EN_PAGE) === 'volet',
  cran: (lireStockage(CLE_HAUTEUR_VOLET) as Cran | null) ?? 'moitie',
};

// Couleurs lisibles sur le fond blanc comme sur la photo ; le violet est réservé à ce qui est
// choisi sur la carte (même violet que --choix dans style.css).
export const COULEURS = ['#00b8d4', '#ff4081', '#64dd17', '#ffab00', '#2962ff', '#ff6e40'];
export const SEL = '#c026d3';
/** Couleur de chaque état de contour : carte, pastille de la barre du haut, boutons du suivi. */
export const COULEURS_ETAT: Record<EtatContour, string> = {
  verifie: '#22b04f',
  'a-confirmer': '#f5a524',
  'a-refaire': '#e0362c',
};
/** Rayon de toucher, en pixels à l'écran. */
export const RAYON_TOUCHER_PX = 26;

/** Couleur d'une note selon son type (toujours la même pour un même type). */
const COULEURS_NOTES = [
  '#2962ff',
  '#ff6e40',
  '#00897b',
  '#8d6e63',
  '#ec407a',
  '#7cb342',
  '#ffa000',
  '#546e7a',
];
export function couleurNote(type: string): string {
  let h = 0;
  for (const c of type.trim().toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COULEURS_NOTES[h % COULEURS_NOTES.length]!;
}

export const SEUILS_COINS = [20, 30, 45, 60];
export const TOLERANCES = [0.1, 0.25, 0.5, 1];

/** Onglet qui correspond au mode : Guidage pour les lignes, Modifier pour le reste. */
export const ongletDuMode = (): Onglet => (ui.mode === 'guidage' ? 'guidage' : 'modifier');

/** Choix d'un bord, du premier au dernier sommet (simplification d'un bord, ligne de guidage, collage). */
export const choixDeBord = () =>
  ui.mode === 'coller' ||
  (ui.mode === 'simplifier' && ui.porteeSimplif === 'bord') ||
  (ui.mode === 'guidage' && ui.porteeGuidage === 'bord');
