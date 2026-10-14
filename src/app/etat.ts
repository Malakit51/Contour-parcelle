// État de l'interface partagé par tous les modules, et constantes d'affichage.
//
// Tout ce qui change pendant l'utilisation est dans l'objet `ui` : un seul endroit, avec ses
// valeurs de départ (certaines relues sur l'appareil).

import { type Alerte } from '../edition/controles';
import { type Etat, type RefLimite, type RefSommet } from '../edition/etat';
import { type Bord } from '../edition/operations';
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

export type Onglet = 'modifier' | 'suivi' | 'export' | 'fichier';
export const ONGLETS: Record<Onglet, string> = {
  modifier: 'Modifier',
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

export interface EtatInterface {
  session: Session | null;
  /** Suivi des contours et journal : gardés sur l'appareil, indépendamment du fichier ouvert. */
  suivi: Suivi;
  suiviNonEnregistre: boolean;
  /** Couleur des parcelles sur la carte : selon l'état du contour, ou pour distinguer les voisines. */
  couleursParEtat: boolean;
  mode: 'limite' | 'sommet' | 'simplifier' | 'guidage';
  /** Ligne de guidage en préparation : droite AB ou courbe, vers l'intérieur ou l'extérieur. */
  typeGuidage: 'ab' | 'courbe';
  guidageInterieur: boolean;
  /** Une ligne sur un bord choisi, une par côté de la parcelle, ou pour toutes les parcelles. */
  porteeGuidage: 'bord' | 'parcelle' | 'toutes';
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
  exportPrepare: { texte: string; alertes: Alerte[]; resume: string; details: string } | null;
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
  /** Jeux de lignes de guidage masqués à l'écran. */
  jeuxMasques: Set<string>;
  menuLignesOuvert: boolean;
  /** Emplacement mémorisé pour « Enregistrer sur la clé » (nom affiché), ou null. */
  emplacementConnu: string | null;
  /** La liste du suivi reste ouverte d'un affichage à l'autre. */
  suiviOuvert: boolean;
  onglet: Onglet;
  messageAffiche: { texte: string; erreur: boolean } | null;
  minuterieBulle: ReturnType<typeof setTimeout> | undefined;
  /** Mise en page « volet » (sinon classique). */
  voletActif: boolean;
  cran: Cran;
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
  typeGuidage: 'ab',
  guidageInterieur: true,
  porteeGuidage: 'bord',
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
  gpsAffiche: false,
  minuterieDrive: undefined,
  driveConflit: null,
  sessionNonGardee: false,
  sessionIllisible: lireStockage(CLE_SESSION_ILLISIBLE),
  mesure: null,
  jeuxMasques: jeuxMasquesGardes(),
  menuLignesOuvert: false,
  emplacementConnu: null,
  suiviOuvert: true,
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

export const SEUILS_COINS = [20, 30, 45, 60];
export const TOLERANCES = [0.1, 0.25, 0.5, 1];

/** Choix d'un bord, du premier au dernier sommet (simplification d'un bord, ligne de guidage). */
export const choixDeBord = () =>
  (ui.mode === 'simplifier' && ui.porteeSimplif === 'bord') ||
  (ui.mode === 'guidage' && ui.porteeGuidage === 'bord');
