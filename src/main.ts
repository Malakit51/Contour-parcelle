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
  type Guidage,
  type RefLimite,
  type RefSommet,
} from './edition/etat';
import { exporterEtat, nouvelleSurface, parcellesModifiees } from './edition/export';
import { nettoyer } from './edition/nettoyage';
import {
  decalerLimite,
  decalerSommet,
  ErreurEdition,
  glisserSommetLeLong,
  placerSommet,
  remplacerContour,
  cotesLimite,
  repereLeLong,
  retrouverLimite,
  ajouterPoint,
  bordLePlusCourt,
  simplifierParcelle,
  sommetsDuBord,
  supprimerSommet,
  type Bord,
} from './edition/operations';
import { coins, cotesEntreCoins, courbeDecalee, estDroit, ligneAB } from './geometrie/guidage';
import {
  aireSignee,
  planLocal,
  positionSurSegment,
  type LatLon,
  type Plan,
  type XY,
} from './geometrie/plan';
import { ecartMaximal } from './geometrie/simplification';
import { comparer } from './isoxml/comparaison';
import { lireTaskData, type TaskData } from './isoxml/lecture';
import {
  ecritureDossierPossible,
  ecrireDossierTaskdata,
  nomEmplacement,
  oublierEmplacement,
  NOM_DOSSIER,
  NOM_FICHIER,
} from './ui/dossier';
import { decoder, encoder } from './isoxml/octets';
import { Carte, type Dessin, type VersEcran } from './ui/carte';
import { el } from './ui/dom';
import { GOOGLE_CLIENT_ID } from './sauvegarde/config';
import { Drive } from './sauvegarde/drive';
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
  aujourdhui,
  fiche,
  fusionner,
  LIBELLES,
  VERSION_DE_DEPART,
  versionSuivante,
  type EntreeJournal,
  type EtatContour,
  type Suivi,
} from './suivi/suivi';

// Couleurs lisibles sur le fond blanc comme sur la photo ; le violet est réservé à la
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
  programmerSauvegardeDrive();
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
  const ga = a.guidages ?? [];
  const gb = b.guidages ?? [];
  for (const g of [...ga.filter((x) => !gb.includes(x)), ...gb.filter((x) => !ga.includes(x))]) {
    changees.add(g.parcelle);
  }
  return [...changees];
}

/** Travail qui serait perdu en ouvrant un autre fichier : contours modifiés ou lignes de guidage. */
const travailEnCours = (etat: Etat) =>
  parcellesModifiees(etat).length > 0 || (etat.guidages?.length ?? 0) > 0;

/**
 * Passe à un nouvel état (annulable) et note la modification au journal. L'état est d'abord
 * nettoyé (points en double, sommets communs décollés) ; si des points ont été retirés, la
 * sélection est effacée (ses indices ne sont plus sûrs). Renvoie une remarque à ajouter au message.
 */
function enregistrerModification(s: Session, brut: Etat, quoi: string): string {
  const net = nettoyer(brut);
  const nouveau = net.etat;
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
  if (net.doublons.size === 0) return '';
  effacerSelection();
  return ` (${[...net.doublons.values()].reduce((a, b) => a + b, 0)} point(s) en double retiré(s))`;
}

function retirerDuJournal(entrees: EntreeJournal[]): void {
  if (entrees.length === 0) return;
  majSuivi({ ...suivi, journal: suivi.journal.filter((e) => !entrees.includes(e)) });
}
let mode: 'limite' | 'sommet' | 'simplifier' | 'guidage' = 'limite';
/** Ligne de guidage en préparation : droite AB ou courbe, vers l'intérieur ou l'extérieur. */
let typeGuidage: 'ab' | 'courbe' = 'ab';
let guidageInterieur = true;
/** Une ligne sur un bord choisi, ou une ligne par côté de toute la parcelle. */
let porteeGuidage: 'bord' | 'parcelle' | 'toutes' = 'bord';
/** Angle à partir duquel un sommet est un coin (lignes de toute la parcelle). */
let seuilCoins = 30;
const SEUILS_COINS = [20, 30, 45, 60];
/** Côtés plus courts que ça : pas de ligne (décrochements, coins coupés). */
const COTE_MIN_M = 20;
/** Écart maximal (m) des points d'un côté à sa droite moyenne pour en faire une droite AB. */
const TOLERANCE_DROIT_M = 0.5;
/** Choix d'un bord, du premier au dernier sommet (simplification d'un bord, ligne de guidage). */
const choixDeBord = () =>
  (mode === 'simplifier' && porteeSimplif === 'bord') ||
  (mode === 'guidage' && porteeGuidage === 'bord');
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
/** Ancien fichier affiché en référence (gris) : ses points servent d'aimant pour « au doigt ». */
let reference: {
  nom: string;
  anneaux: LatLon[][];
  /** Contour extérieur de chaque parcelle de la référence, pour « Remplacer le contour ». */
  parcelles: { nom: string; guid: string; contour: LatLon[] }[];
} | null = null;
/** Mode Point : le prochain toucher sur une limite y ajoute un point. */
let ajoutEnCours = false;
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

/**
 * Ouvre un fichier lu (ou une session reprise) : `etat` est l'état modifié, s'il y en a un.
 * `nouveau` : travail qui n'est pas encore sur Drive (faux pour une reprise depuis l'appareil ou
 * depuis Drive), à envoyer.
 */
function ouvrir(
  td: TaskData,
  nomFichier: string,
  etat: Etat | null,
  texteMessage: string,
  nouveau = true,
): void {
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
  garderSession(nouveau);
  // Travail fait avant le nettoyage automatique (14/10/2026) : points en double à retirer.
  const s = session;
  if (nettoyer(s.etat).etat !== s.etat) {
    const note = enregistrerModification(
      s,
      s.etat,
      'Points en double retirés, sommets communs recollés',
    );
    message = { texte: `${texteMessage} Contours nettoyés${note}.`, erreur: false };
  }
  afficher();
  cadrerTout();
}

async function charger(fichier: File): Promise<void> {
  try {
    const td = lireTaskData(decoder(new Uint8Array(await fichier.arrayBuffer())));
    if (
      session &&
      travailEnCours(session.etat) &&
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
function garderSession(envoyer = true): void {
  if (!session) return;
  sessionNonGardee = !garderSurAppareil(
    stockage,
    enregistrerSession(session.td, session.nomFichier, session.etat, nomAppareil()),
  );
  if (envoyer) programmerSauvegardeDrive();
}

function changerNomAppareil(): boolean {
  const nom = prompt(
    'Nom de cet appareil (par exemple « téléphone » ou « tablette ») :',
    nomAppareil(),
  );
  if (!nom?.trim()) return false;
  try {
    stockage?.setItem('contour-parcelle/appareil', nom.trim());
  } catch {
    // pas de stockage : le nom par défaut reste
  }
  return true;
}

// ---------- Sauvegarde Google Drive ----------

const drive = new Drive(GOOGLE_CLIENT_ID);
/** État de la sauvegarde en ligne : élément fixe, mis à jour seul (comme le texte du GPS). */
const texteDrive = el('div', { class: 'doux' });
let minuterieDrive: ReturnType<typeof setTimeout> | undefined;

// La connexion à Google dure environ une heure. Le compte utilisé est retenu sur l'appareil : quand
// la connexion a expiré et qu'il reste des modifications à envoyer, un bouton ☁ dans la barre du
// haut reconnecte d'un appui (sans redemander le compte ni l'autorisation) et envoie.
const CLE_COMPTE = 'contour-parcelle/compte-google';
const CLE_ATTENTE = 'contour-parcelle/drive-en-attente';

function lireStockage(cle: string): string | null {
  try {
    return stockage?.getItem(cle) ?? null;
  } catch {
    return null;
  }
}

function ecrireStockage(cle: string, valeur: string | null): void {
  try {
    if (valeur === null) stockage?.removeItem(cle);
    else stockage?.setItem(cle, valeur);
  } catch {
    // pas de stockage : tant pis
  }
}

/** Des modifications n'ont pas encore été envoyées sur Drive (connexion expirée). */
const driveEnAttente = () => lireStockage(CLE_ATTENTE) === '1';

/** Après chaque modification, si on est connecté : sauvegarde en ligne quelques secondes après. */
function programmerSauvegardeDrive(): void {
  if (!session || !drive.configure()) return;
  if (!drive.connecte()) {
    // Drive déjà utilisé sur cet appareil : on retient qu'il y a quelque chose à envoyer.
    if (lireStockage(CLE_COMPTE)) ecrireStockage(CLE_ATTENTE, '1');
    return;
  }
  clearTimeout(minuterieDrive);
  texteDrive.textContent = 'Modifications à envoyer sur Google Drive…';
  minuterieDrive = setTimeout(() => void sauverSurDrive(), 4000);
}

async function sauverSurDrive(): Promise<void> {
  if (!session) return;
  clearTimeout(minuterieDrive);
  try {
    texteDrive.textContent = 'Envoi sur Google Drive…';
    const f = await drive.ecrire(
      enregistrerSession(session.td, session.nomFichier, session.etat, nomAppareil(), suivi),
    );
    texteDrive.textContent = `Enregistré sur Google Drive le ${quandFr(f.modifie)}.`;
    if (driveEnAttente()) {
      ecrireStockage(CLE_ATTENTE, null);
      afficher();
    }
  } catch (e) {
    texteDrive.textContent = `Pas enregistré sur Google Drive : ${(e as Error).message}`;
    if (lireStockage(CLE_COMPTE)) ecrireStockage(CLE_ATTENTE, '1');
    afficher();
  }
}

async function connecterDrive(): Promise<void> {
  try {
    if (nomAppareil() === 'appareil' && !changerNomAppareil()) return;
    await drive.connecter(lireStockage(CLE_COMPTE) ?? undefined);
    texteDrive.textContent = 'Connecté. Recherche d’une sauvegarde en ligne…';
    afficher();
    try {
      ecrireStockage(CLE_COMPTE, await drive.compte());
    } catch {
      // sans l'adresse, la reconnexion redemandera simplement le compte
    }
    const lu = await drive.lire();
    const enLigne = lu?.contenu as { enregistreLe?: string; appareil?: string } | undefined;
    texteDrive.textContent = lu
      ? `Sauvegarde en ligne du ${quandFr(enLigne?.enregistreLe ?? lu.fichier.modifie)} (${enLigne?.appareil ?? '?'}).`
      : 'Aucune sauvegarde en ligne pour l’instant.';
  } catch (e) {
    texteDrive.textContent = (e as Error).message;
  }
  afficher();
}

/** Bouton ☁ : reconnecte au compte retenu et envoie les modifications en attente. */
async function reconnecterDrive(): Promise<void> {
  try {
    await drive.connecter(lireStockage(CLE_COMPTE) ?? undefined);
    await sauverSurDrive();
    message = driveEnAttente()
      ? { texte: texteDrive.textContent ?? 'Pas envoyé sur Google Drive.', erreur: true }
      : { texte: 'Envoyé sur Google Drive.', erreur: false };
  } catch (e) {
    message = { texte: (e as Error).message, erreur: true };
  }
  afficher();
}

/** Remplace le travail de cet appareil par celui enregistré dans Drive ; le suivi est fusionné. */
/**
 * Reprend une sauvegarde (Drive ou fichier) : remplace le travail de cet appareil, après
 * confirmation s'il était modifié, et fusionne le suivi. Renvoie la date et l'appareil, ou null
 * si l'utilisateur a renoncé.
 */
function reprendreSauvegarde(contenu: unknown, provenance: string): string | null {
  const r = relireSession(contenu);
  const quand = `${quandFr(r.session.enregistreLe)} (${r.session.appareil})`;
  if (
    session &&
    travailEnCours(session.etat) &&
    !confirm(`Remplacer le travail de cet appareil par la sauvegarde ${provenance} du ${quand} ?`)
  ) {
    return null;
  }
  if (r.session.suivi) majSuivi(fusionner(suivi, r.session.suivi));
  ouvrir(
    r.td,
    r.nom,
    r.etat,
    `Travail repris : sauvegarde ${provenance} du ${quand}.`,
    provenance !== 'en ligne',
  );
  return quand;
}

async function reprendreDepuisDrive(): Promise<void> {
  try {
    texteDrive.textContent = 'Lecture de la sauvegarde en ligne…';
    const lu = await drive.lire();
    if (!lu) {
      texteDrive.textContent = 'Aucune sauvegarde en ligne pour l’instant.';
      return;
    }
    const quand = reprendreSauvegarde(lu.contenu, 'en ligne');
    texteDrive.textContent = quand
      ? `Repris depuis la sauvegarde en ligne du ${quand}.`
      : 'Reprise annulée.';
  } catch (e) {
    texteDrive.textContent = `Reprise impossible : ${(e as Error).message}`;
  }
  afficher();
}

// ---------- Sauvegarde dans un fichier (clé USB…) ----------

function enregistrerFichierSauvegarde(): void {
  if (!session) return;
  if (nomAppareil() === 'appareil') changerNomAppareil();
  const contenu = enregistrerSession(
    session.td,
    session.nomFichier,
    session.etat,
    nomAppareil(),
    suivi,
  );
  const nom = `contour-parcelle-sauvegarde-${aujourdhui()}.json`;
  enregistrer(encoder(JSON.stringify(contenu)), nom, 'application/json');
  message = {
    texte: `${nom} enregistré dans Téléchargements.`,
    erreur: false,
  };
  afficher();
}

// Partage direct (menu Android : Bluetooth, Quick Share, messagerie…). Chrome n'accepte de
// partager que certains types de fichiers, pas le .json : la sauvegarde part en .txt (même
// contenu, que « Charger une sauvegarde » relit aussi).
type NavigateurPartage = Navigator & {
  canShare?: (donnees: { files: File[] }) => boolean;
  share?: (donnees: { files: File[]; title?: string }) => Promise<void>;
};

function partagePossible(): boolean {
  const n = navigator as NavigateurPartage;
  try {
    return (
      typeof n.share === 'function' &&
      typeof n.canShare === 'function' &&
      n.canShare({ files: [new File(['{}'], 'essai.txt', { type: 'text/plain' })] })
    );
  } catch {
    return false;
  }
}

async function partagerSauvegarde(): Promise<void> {
  if (!session) return;
  if (nomAppareil() === 'appareil') changerNomAppareil();
  const contenu = enregistrerSession(
    session.td,
    session.nomFichier,
    session.etat,
    nomAppareil(),
    suivi,
  );
  const nom = `contour-parcelle-sauvegarde-${aujourdhui()}.txt`;
  const fichier = new File([JSON.stringify(contenu)], nom, { type: 'text/plain' });
  try {
    await (navigator as NavigateurPartage).share!({ files: [fichier], title: nom });
    message = { texte: `${nom} partagé.`, erreur: false };
  } catch (e) {
    // Fermer le menu de partage sans choisir n'est pas une erreur.
    if ((e as Error).name === 'AbortError') return;
    message = { texte: `Partage impossible : ${(e as Error).message}`, erreur: true };
  }
  afficher();
}

function boutonChargerSauvegarde(): HTMLElement {
  const choix = el('label', { class: 'bouton-fichier secondaire' }, 'Charger');
  const input = el('input', { type: 'file', accept: '.json,.txt,application/json,text/plain' });
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      const contenu: unknown = JSON.parse(await f.text());
      if (!reprendreSauvegarde(contenu, `« ${f.name} »`)) return;
    } catch (e) {
      message = { texte: `Sauvegarde illisible : ${(e as Error).message}`, erreur: true };
      afficher();
    }
  });
  choix.append(input);
  return choix;
}

async function chargerReference(f: File): Promise<void> {
  try {
    const td = lireTaskData(decoder(new Uint8Array(await f.arrayBuffer())));
    const e = etatInitial(td);
    reference = {
      nom: f.name,
      anneaux: e.anneaux.map((a) => a.sommets.map(latLon)),
      parcelles: td.parcelles.flatMap((p, i) => {
        const ext = e.anneaux.find((a) => a.parcelle === i && a.type === 1);
        return ext ? [{ nom: p.nom, guid: p.guid, contour: ext.sommets.map(latLon) }] : [];
      }),
    };
    message = {
      texte: `${f.name} affiché en référence.`,
      erreur: false,
    };
  } catch (e) {
    message = { texte: `Lecture impossible : ${(e as Error).message}`, erreur: true };
  }
  afficher();
}

function panneauReference(): HTMLElement {
  const choix = el(
    'label',
    { class: 'bouton-fichier secondaire' },
    reference ? 'Autre référence' : 'Afficher un ancien TASKDATA',
  );
  const input = el('input', { type: 'file' });
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) void chargerReference(f);
  });
  choix.append(input);
  return el(
    'div',
    { class: 'info' },
    el('strong', {}, 'Référence'),
    reference && el('div', { class: 'doux' }, `${reference.nom} (gris)`),
    el(
      'div',
      { class: 'rangee' },
      choix,
      reference &&
        el(
          'button',
          {
            onclick: () => {
              reference = null;
              afficher();
            },
          },
          'Retirer',
        ),
    ),
  );
}

/** Parcelle de la référence qui correspond à la parcelle `p` : même GUID, même nom, ou qui la recouvre. */
function parcelleDeReference(s: Session, p: number) {
  if (!reference) return null;
  const parcelle = s.td.parcelles[p]!;
  const parGuid = parcelle.guid && reference.parcelles.find((r) => r.guid === parcelle.guid);
  if (parGuid) return parGuid;
  const parNom = reference.parcelles.find((r) => r.nom === parcelle.nom);
  if (parNom) return parNom;
  const ext = s.etat.anneaux.find((a) => a.parcelle === p && a.type === 1);
  if (!ext) return null;
  const plan = planLocal(latLon(ext.sommets[0]!));
  const pts = ext.sommets.map((x) => plan.versXY(latLon(x)));
  const centre: XY = [
    pts.reduce((u, q) => u + q[0], 0) / pts.length,
    pts.reduce((u, q) => u + q[1], 0) / pts.length,
  ];
  return (
    reference.parcelles.find((r) =>
      pointDansPolygone(
        centre,
        r.contour.map((q) => plan.versXY(q)),
      ),
    ) ?? null
  );
}

function panneauRemplacement(s: Session): HTMLElement | null {
  if (!reference || parcelleCourante === null) return null;
  const p = parcelleCourante;
  const r = parcelleDeReference(s, p);
  const nom = s.td.parcelles[p]!.nom;
  if (!r) {
    return el('div', { class: 'info doux' }, `${nom} absente de la référence.`);
  }
  const ext = s.etat.anneaux.findIndex((a) => a.parcelle === p && a.type === 1);
  return el(
    'div',
    { class: 'info' },
    el('strong', {}, 'Référence'),
    el(
      'div',
      { class: 'doux' },
      `${r.contour.length} points (actuel : ${s.etat.anneaux[ext]!.sommets.length})`,
    ),
    el(
      'div',
      { class: 'rangee' },
      el(
        'button',
        {
          onclick: () => {
            if (!confirm(`Remplacer tout le contour de ${nom} par celui de la référence ?`)) return;
            const communs = s.etat.anneaux[ext]!.sommets.some((x) =>
              sommetsEn(s.etat, latLon(x)).some((q) => q.anneau !== ext),
            );
            modifier(
              () => remplacerContour(s.etat, ext, r.contour),
              `Contour de ${nom} remplacé par celui de ${reference!.nom}` +
                (communs ? ' ; vérifie la limite avec le voisin' : ''),
              false,
            );
          },
        },
        `Remplacer ${nom}`,
      ),
    ),
  );
}

function panneauSauvegardeFichier(): HTMLElement {
  return el(
    'div',
    { class: 'info' },
    el('strong', {}, 'Sauvegarde'),
    el(
      'div',
      { class: 'rangee' },
      session ? el('button', { onclick: enregistrerFichierSauvegarde }, 'Enregistrer') : null,
      session && partagePossible()
        ? el('button', { onclick: () => void partagerSauvegarde() }, 'Partager')
        : null,
      boutonChargerSauvegarde(),
    ),
  );
}

function panneauDrive(): HTMLElement {
  const titre = el('strong', {}, 'Google Drive');
  if (!drive.configure()) {
    return el('div', { class: 'info' }, titre, el('div', { class: 'doux' }, 'Pas configuré.'));
  }
  return el(
    'div',
    { class: 'info' },
    titre,
    el('div', { class: 'doux' }, `Appareil : ${nomAppareil()}`),
    drive.connecte()
      ? el(
          'div',
          { class: 'rangee' },
          el('button', { onclick: () => void sauverSurDrive() }, 'Enregistrer maintenant'),
          el('button', { onclick: () => void reprendreDepuisDrive() }, 'Reprendre'),
        )
      : el(
          'div',
          { class: 'rangee' },
          el(
            'button',
            { class: 'principal', onclick: () => void connecterDrive() },
            'Se connecter à Google',
          ),
        ),
    el(
      'div',
      { class: 'rangee' },
      el(
        'button',
        {
          onclick: () => {
            if (changerNomAppareil()) afficher();
          },
        },
        'Renommer l’appareil',
      ),
    ),
    texteDrive,
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
      false,
    );
  } catch {
    oublierSurAppareil(stockage);
  }
}

function fermerFichier(): void {
  if (!session) return;
  if (
    travailEnCours(session.etat) &&
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
    // Toucher près d'un point de l'ancien fichier : le point s'y colle exactement.
    let aimant: LatLon | null = null;
    let dMin = RAYON_TOUCHER_PX;
    for (const pt of reference?.anneaux.flat() ?? []) {
      const e = versEcran(pt);
      const d = Math.hypot(e.x - ecran.x, e.y - ecran.y);
      if (d <= dMin) {
        dMin = d;
        aimant = pt;
      }
    }
    modifier(
      () => placerSommet(s.etat, ref, aimant ?? position),
      aimant
        ? `Point de ${nomParcelle(s, ref.anneau)} placé exactement sur le point de ${reference!.nom}`
        : `Point de ${nomParcelle(s, ref.anneau)} placé au doigt`,
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
  // Ajout d'un point : la limite la plus proche du toucher reçoit un nouveau sommet.
  if (mode === 'sommet' && ajoutEnCours) {
    let proche: { anneau: number; debut: number; d: number } | null = null;
    for (const i of ordre) {
      const pts = anneaux[i]!;
      pts.forEach((q, k) => {
        const pos = positionSurSegment(p, q, pts[(k + 1) % pts.length]!);
        if (
          pos.t > 0 &&
          pos.t < 1 &&
          pos.ecart <= rayon &&
          (!proche || pos.ecart < proche.d - 1e-6)
        ) {
          proche = { anneau: i, debut: k, d: pos.ecart };
        }
      });
    }
    const limite = proche as { anneau: number; debut: number } | null;
    if (!limite) {
      message = { texte: 'Touche une limite.', erreur: true };
      afficher();
      return;
    }
    try {
      const r = ajouterPoint(s.etat, { anneau: limite.anneau, debut: limite.debut }, position);
      ajoutEnCours = false;
      enregistrerModification(
        s,
        r.etat,
        `Point ajouté sur une limite de ${nomParcelle(s, limite.anneau)}`,
      );
      effacerSelection();
      parcelleCourante = s.etat.anneaux[limite.anneau]!.parcelle;
      selSommet = r.sommet;
      message = {
        texte: 'Point ajouté.',
        erreur: false,
      };
    } catch (e) {
      message = { texte: (e as Error).message, erreur: true };
    }
    afficher();
    return;
  }
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
      if (mode === 'sommet' || choixDeBord()) {
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
  if (choix && choixDeBord()) {
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
  ajoutEnCours = false;
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
    const note = nouveau !== s.etat ? enregistrerModification(s, nouveau, quoi) : '';
    if (garderSelection) exportPrepare = null;
    else effacerSelection();
    message = { texte: `${quoi}${note}.`, erreur: false };
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
            ? { texte: 'Touche la carte à l’endroit voulu.', erreur: false }
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
    } else if (mode === 'guidage' && apercuGuidages(s).length > 0) {
      const gs = apercuGuidages(s);
      const cote = `${enMetres(Math.abs(d))} m ${guidageInterieur ? 'à l’intérieur' : 'à l’extérieur'}`;
      const base = baseNomLignes();
      const touchees = new Set(gs.map((g) => g.parcelle));
      const nom = s.td.parcelles[gs[0]!.parcelle]!.nom;
      quoi =
        porteeGuidage === 'bord'
          ? `Ligne ${gs[0]!.type === 'ab' ? 'AB' : 'courbe'} « ${gs[0]!.nom} » ajoutée à ${nom} (${cote})`
          : porteeGuidage === 'parcelle'
            ? `${gs.length} lignes « ${base} » sur ${nom} (${cote})`
            : `${gs.length} lignes « ${base} » sur ${touchees.size} parcelles (${cote})`;
      // Toute une parcelle : le jeu de même nom déjà créé sur la parcelle est remplacé.
      const gardees = (s.etat.guidages ?? []).filter(
        (g) => porteeGuidage === 'bord' || !touchees.has(g.parcelle) || !duJeu(g, base),
      );
      nouveau = { ...s.etat, guidages: [...gardees, ...gs] };
    } else {
      return;
    }
    if (nouveau === s.etat) return;
    const avant = s.etat;
    const note = enregistrerModification(s, nouveau, quoi);
    if (mode === 'limite' && selLimite) {
      // La limite reste sélectionnée (avec son sens) pour pouvoir appliquer plusieurs fois.
      const retrouvee = retrouverLimite(avant, s.etat, selLimite);
      const sens = sensLimite;
      effacerSelection();
      if (retrouvee) {
        selLimite = retrouvee;
        sensLimite = sens;
      }
    } else if (mode === 'sommet' || mode === 'guidage') {
      // Le sommet ne change pas d'indice en glissant : on garde sommet, bord et sens. Le bord d'une
      // ligne de guidage reste choisi pour en tracer une autre (autre distance, autre type).
      exportPrepare = null;
    } else {
      effacerSelection();
      // Une simplification se fait une fois : on revient au décalage de limite pour les retouches.
      if (mode === 'simplifier') mode = 'limite';
    }
    message = { texte: `${quoi}${note}.`, erreur: false };
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

/** Emplacement mémorisé pour « Enregistrer sur la clé » (nom affiché), ou null. */
let emplacementConnu: string | null = null;
void nomEmplacement().then((n) => {
  emplacementConnu = n;
});

/** Nom du dossier écrit sur la clé : « TASKDATA 0.12 », pour le retrouver tel quel sur la console. */
const nomDossierVersion = (version: string) => `${NOM_DOSSIER} ${version}`;

/** Version que portera le prochain export (« 0.12 » après « 0.11 »…). */
function prochaineVersion(): string {
  return versionSuivante(suivi.derniereVersion ?? VERSION_DE_DEPART);
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
  const version = prochaineVersion();
  let destination: string;
  if (quoi === 'dossier') {
    try {
      const chemin = await ecrireDossierTaskdata(xml, nomDossierVersion(version), (c) =>
        confirm(`${c} existe déjà. Le remplacer ?\n\nConseil : travaille sur une copie.`),
      );
      if (!chemin) return;
      destination = chemin;
      message = { texte: `Enregistré : ${chemin}`, erreur: false };
      emplacementConnu = await nomEmplacement();
    } catch (e) {
      message = { texte: `Enregistrement impossible : ${(e as Error).message}`, erreur: true };
      afficher();
      return;
    }
  } else {
    enregistrer(xml, NOM_FICHIER, 'application/xml');
    destination = `${NOM_FICHIER} (Téléchargements)`;
  }
  const s = session;
  const quand = new Date().toISOString();
  const modifiees = parcellesModifiees(s.etat);
  const action = `Exporté : version ${version} (${destination})`;
  majSuivi({
    ...suivi,
    derniereVersion: version,
    journal: [
      ...suivi.journal,
      ...modifiees.map((p) => ({
        quand,
        cle: cleParcelle(s.td.parcelles[p]!),
        parcelle: s.td.parcelles[p]!.nom,
        action,
        surfaceAvant: Number(s.td.parcelles[p]!.surface?.texte ?? NaN) || null,
        surfaceApres: nouvelleSurface(s.td, s.etat, p),
      })),
      // Export sans aucune parcelle modifiée : une ligne quand même, pour suivre les versions.
      ...(modifiees.length === 0
        ? [{ quand, cle: 'export', parcelle: '—', action, surfaceAvant: null, surfaceApres: null }]
        : []),
    ],
  });
  message = {
    texte:
      quoi === 'xml'
        ? `Version ${version} : ${NOM_FICHIER} téléchargé, à mettre dans un dossier ${NOM_DOSSIER} sur la clé.`
        : `Version ${version} exportée (${destination}).`,
    erreur: false,
  };
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
      el('span', { style: 'flex:1' }, f.remarque),
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
    derniere && el('div', { class: 'doux' }, `${quandFr(derniere.quand)} · ${derniere.action}`),
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
    suiviNonEnregistre && el('div', { class: 'erreur' }, 'Suivi non enregistré sur cet appareil.'),
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
    el('strong', {}, 'Journal'),
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
    reference: reference?.anneaux ?? [],
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
  if (choixDeBord() && (bord || bordDebut)) {
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
  d.guidages = [
    ...(s.etat.guidages ?? []).map((g) => ({ pts: [...g.points], apercu: false })),
    ...(porteeGuidage === 'toutes' ? [] : apercuGuidages(s)).map((g) => ({
      pts: [...g.points],
      apercu: true,
    })),
  ];
  for (const c of coinsGuidage(s)?.coins ?? []) d.points.push({ p: c, couleur: SEL, rayon: 7 });
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
        bordDebut ? 'Touche le dernier sommet du bord.' : 'Touche le premier sommet du bord.',
      ),
    );
  }
  if (parcelleCourante === null) {
    return el(
      'div',
      { class: 'info' },
      portee,
      el('div', { class: 'doux' }, 'Touche une parcelle.'),
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
        el('span', { class: 'doux' }, `Bord : ${sommetsDuBord(s.etat, bord).length} points`),
        el(
          'button',
          {
            onclick: () => {
              if (bord) bord = { ...bord, aRebours: !bord.aRebours };
              afficher();
            },
          },
          'Autre côté',
        ),
      ),
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
        `Écart avec l’origine : ${enCm(ecartOrigine)}` +
          (ecartOrigine > tolerance ? ' (déjà simplifiée ?)' : ''),
      ),
  );
}

// Nom des lignes (outil, largeur…) : « Semoir 4 m » donne « Semoir 4 m 1 », « Semoir 4 m 2 »…
// Retenu sur l'appareil. Case créée une seule fois (la recréer fermerait le clavier).
const CLE_NOM_LIGNES = 'contour-parcelle/nom-guidage';
const champNomLignes = el('input', {
  type: 'text',
  class: 'champ-nom',
  enterkeyhint: 'done',
  autocomplete: 'off',
  'aria-label': 'Nom des lignes',
});
champNomLignes.value = lireStockage(CLE_NOM_LIGNES) ?? 'Guidage';
champNomLignes.addEventListener('change', () => {
  ecrireStockage(CLE_NOM_LIGNES, champNomLignes.value.trim() || null);
});
champNomLignes.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') champNomLignes.blur();
});
const baseNomLignes = () => champNomLignes.value.trim() || 'Guidage';

/** Vrai si la ligne fait partie du jeu « base » (« base 1 », « base 2 »…). */
const duJeu = (g: Guidage, base: string) =>
  g.nom.startsWith(`${base} `) && /^\d+$/.test(g.nom.slice(base.length + 1));

/** Numéro suivant du jeu « base » sur la parcelle `p`. */
function numeroSuivant(etat: Etat, p: number, base: string): number {
  const numeros = (etat.guidages ?? [])
    .filter((g) => g.parcelle === p && duJeu(g, base))
    .map((g) => Number(g.nom.slice(base.length + 1)));
  return Math.max(0, ...numeros) + 1;
}

/** Lignes que donnerait « Appliquer » : une sur le bord choisi, ou une par côté de la parcelle. */
function apercuGuidages(s: Session): Guidage[] {
  if (mode !== 'guidage') return [];
  if (porteeGuidage === 'bord') {
    const g = apercuGuidage(s);
    return g ? [g] : [];
  }
  if (porteeGuidage === 'parcelle') return coinsGuidage(s)?.lignes ?? [];
  return s.td.parcelles.flatMap((_, p) => lignesParcelle(s, p)?.lignes ?? []);
}

/** Parcelles à contrôler après « Toutes les parcelles » : pas exactement 4 coins, ou un petit côté sans ligne. */
function parcellesAControler(s: Session): number[] {
  return s.td.parcelles
    .map((_, p) => ({ p, r: lignesParcelle(s, p) }))
    .filter(({ r }) => r && (r.coins.length !== 4 || r.ignores > 0))
    .map(({ p }) => p)
    .sort((a, b) =>
      s.td.parcelles[a]!.nom.localeCompare(s.td.parcelles[b]!.nom, 'fr', { numeric: true }),
    );
}

/**
 * Toute la parcelle courante : coins du contour extérieur (seuil réglé) et une ligne par côté
 * d'au moins COTE_MIN_M mètres, droite AB si le côté est droit, sinon courbe.
 */
function coinsGuidage(s: Session): { coins: LatLon[]; lignes: Guidage[]; ignores: number } | null {
  if (mode !== 'guidage' || porteeGuidage !== 'parcelle' || parcelleCourante === null) return null;
  return lignesParcelle(s, parcelleCourante);
}

function lignesParcelle(
  s: Session,
  p: number,
): { coins: LatLon[]; lignes: Guidage[]; ignores: number } | null {
  const a = s.etat.anneaux.find((x) => x.parcelle === p && x.type === 1);
  if (!a) return null;
  const plan = planLocal(latLon(a.sommets[0]!));
  const pts = a.sommets.map((x) => plan.versXY(latLon(x)));
  const trouves = coins(pts, seuilCoins);
  // Décalage compté à gauche du sens de l'anneau : la gauche est l'intérieur s'il tourne dans le
  // sens inverse des aiguilles d'une montre.
  const sens = (aireSignee(pts) > 0 ? 1 : -1) * (guidageInterieur ? 1 : -1);
  const decalage = Math.abs(metres()) * sens;
  const lignes: Guidage[] = [];
  let ignores = 0;
  for (const ids of cotesEntreCoins(pts.length, trouves)) {
    const cote = ids.map((i) => pts[i]!);
    let longueur = 0;
    for (let k = 1; k < cote.length; k++) {
      longueur += Math.hypot(cote[k]![0] - cote[k - 1]![0], cote[k]![1] - cote[k - 1]![1]);
    }
    if (longueur < COTE_MIN_M) {
      ignores++;
      continue;
    }
    const type = estDroit(cote, TOLERANCE_DROIT_M) ? 'ab' : 'courbe';
    const xy = type === 'ab' ? ligneAB(cote, decalage) : courbeDecalee(cote, decalage);
    lignes.push({
      parcelle: a.parcelle,
      type,
      nom: `${baseNomLignes()} ${lignes.length + 1}`,
      points: xy.map((p) => plan.versLatLon(p)),
    });
  }
  return { coins: trouves.map((c) => latLon(a.sommets[c.sommet]!)), lignes, ignores };
}

/** Ligne de guidage que donnerait « Appliquer » sur le bord choisi (rien n'est encore ajouté). */
function apercuGuidage(s: Session): Guidage | null {
  if (mode !== 'guidage' || !bord) return null;
  const a = s.etat.anneaux[bord.anneau]!;
  const ids = sommetsDuBord(s.etat, bord);
  const plan = planLocal(latLon(a.sommets[ids[0]!]!));
  const pts = ids.map((i) => plan.versXY(latLon(a.sommets[i]!)));
  // Côté intérieur : celui où un point décalé de 1 m depuis le milieu du bord tombe dans l'anneau
  // (pour une zone exclue, l'intérieur de la parcelle est hors de l'anneau).
  const [m1, m2] = ligneAB(pts.length > 1 ? pts : [pts[0]!, pts[0]!], 1);
  const essai: XY = [(m1[0] + m2[0]) / 2, (m1[1] + m2[1]) / 2];
  const dansAnneau = pointDansPolygone(
    essai,
    a.sommets.map((x) => plan.versXY(latLon(x))),
  );
  const gaucheInterieur = a.type === 1 ? dansAnneau : !dansAnneau;
  const decalage = Math.abs(metres()) * (gaucheInterieur ? 1 : -1) * (guidageInterieur ? 1 : -1);
  const xy = typeGuidage === 'ab' ? ligneAB(pts, decalage) : courbeDecalee(pts, decalage);
  return {
    parcelle: a.parcelle,
    type: typeGuidage,
    nom: `${baseNomLignes()} ${numeroSuivant(s.etat, a.parcelle, baseNomLignes())}`,
    points: xy.map((p) => plan.versLatLon(p)),
  };
}

/** Toutes les parcelles : nombre de lignes et parcelles à contrôler (un appui zoome dessus). */
function panneauToutes(s: Session): HTMLElement {
  const lignes = apercuGuidages(s);
  const parcelles = new Set(lignes.map((g) => g.parcelle)).size;
  const aControler = parcellesAControler(s);
  return el(
    'div',
    {},
    el(
      'div',
      { class: 'doux' },
      `${lignes.length} lignes « ${baseNomLignes()} » sur ${parcelles} parcelles (celles de même nom sont remplacées).`,
    ),
    aControler.length > 0 &&
      el(
        'div',
        { class: 'rangee' },
        el('span', { class: 'sens' }, 'À contrôler :'),
        ...aControler.map((p) =>
          el(
            'button',
            {
              class: 'petit',
              onclick: () => {
                porteeGuidage = 'parcelle';
                parcelleCourante = p;
                afficher();
                cadrerParcelle(p);
              },
            },
            s.td.parcelles[p]!.nom,
          ),
        ),
      ),
  );
}

function panneauGuidage(s: Session): HTMLElement {
  const choix = <T extends string>(valeurs: [T, string][], actuel: T, changer: (v: T) => void) =>
    el(
      'div',
      { class: 'rangee' },
      ...valeurs.map(([v, t]) =>
        el(
          'button',
          {
            class: v === actuel ? 'actif' : '',
            onclick: () => {
              changer(v);
              afficher();
            },
          },
          t,
        ),
      ),
    );
  const lignes = (s.etat.guidages ?? []).filter((g) => g.parcelle === parcelleCourante);
  const parcelle = porteeGuidage === 'parcelle' ? coinsGuidage(s) : null;
  return el(
    'div',
    { class: 'info' },
    choix(
      [
        ['bord', 'Un bord'],
        ['parcelle', 'Parcelle'],
        ['toutes', 'Toutes'],
      ],
      porteeGuidage,
      (v) => {
        porteeGuidage = v;
        bordDebut = null;
        bord = null;
      },
    ),
    el('label', { class: 'rangee' }, el('span', { class: 'doux' }, 'Nom'), champNomLignes),
    porteeGuidage === 'bord' &&
      choix(
        [
          ['ab', 'Droite AB'],
          ['courbe', 'Courbe'],
        ],
        typeGuidage,
        (v) => (typeGuidage = v),
      ),
    choix(
      [
        ['int', 'Vers l’intérieur'],
        ['ext', 'Vers l’extérieur'],
      ],
      guidageInterieur ? 'int' : 'ext',
      (v) => (guidageInterieur = v === 'int'),
    ),
    porteeGuidage !== 'bord' &&
      el(
        'div',
        { class: 'rangee' },
        el('span', { class: 'doux' }, 'Coins dès'),
        ...SEUILS_COINS.map((v) =>
          el(
            'button',
            {
              class: `petit${v === seuilCoins ? ' actif' : ''}`,
              onclick: () => {
                seuilCoins = v;
                afficher();
              },
            },
            `${v}°`,
          ),
        ),
      ),
    porteeGuidage === 'toutes'
      ? panneauToutes(s)
      : porteeGuidage === 'parcelle'
        ? !parcelle
          ? el('div', { class: 'sens' }, 'Touche une parcelle.')
          : el(
              'div',
              { class: 'doux' },
              `${parcelle.coins.length} coins · ${parcelle.lignes.filter((g) => g.type === 'ab').length} droites AB, ${parcelle.lignes.filter((g) => g.type === 'courbe').length} courbes` +
                (parcelle.ignores > 0
                  ? ` · ${parcelle.ignores} côté(s) de moins de ${COTE_MIN_M} m sans ligne`
                  : ''),
            )
        : !bord
          ? el(
              'div',
              { class: 'sens' },
              bordDebut ? 'Touche le dernier sommet du bord.' : 'Touche le premier sommet du bord.',
            )
          : el(
              'div',
              { class: 'rangee' },
              el(
                'span',
                { class: 'doux', style: 'flex:1' },
                `Bord : ${sommetsDuBord(s.etat, bord).length} points`,
              ),
              el(
                'button',
                {
                  onclick: () => {
                    if (bord) bord = { ...bord, aRebours: !bord.aRebours };
                    afficher();
                  },
                },
                'Autre côté',
              ),
            ),
    ...lignes.map((g) =>
      el(
        'div',
        { class: 'rangee' },
        el('span', { style: 'flex:1' }, g.nom),
        el(
          'button',
          {
            class: 'petit',
            onclick: () =>
              modifier(
                () => ({ ...s.etat, guidages: (s.etat.guidages ?? []).filter((x) => x !== g) }),
                `Ligne « ${g.nom} » supprimée`,
                true,
              ),
          },
          'Supprimer',
        ),
      ),
    ),
  );
}

function panneauSelection(s: Session): HTMLElement {
  if (mode === 'limite') {
    if (!selLimite) return el('div', { class: 'info doux' }, 'Touche une limite.');
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
      el('div', { class: 'doux' }, `${longueur(s, ref).toFixed(1).replace('.', ',')} m`),
      sensLimite
        ? el('div', { class: 'sens' }, effetsLimite(s, ref)[sensLimite])
        : el('div', { class: 'sens' }, 'Choisis une flèche.'),
    );
  }
  const boutonAjout = el(
    'button',
    {
      class: ajoutEnCours ? 'actif' : '',
      onclick: () => {
        const actif = !ajoutEnCours;
        effacerSelection();
        ajoutEnCours = actif;
        message = actif ? { texte: 'Touche une limite.', erreur: false } : null;
        afficher();
      },
    },
    ajoutEnCours ? 'Annuler l’ajout' : 'Ajouter un point',
  );
  if (!selSommet) {
    return el(
      'div',
      { class: 'info' },
      el('div', { class: 'doux' }, ajoutEnCours ? 'Touche une limite.' : 'Touche un sommet.'),
      el('div', { class: 'rangee' }, boutonAjout),
    );
  }
  const ref = selSommet;
  const autres = new Set(
    sommetsEn(s.etat, latLon(s.etat.anneaux[ref.anneau]!.sommets[ref.sommet]!))
      .map((r) => nomParcelle(s, r.anneau))
      .filter((n) => n !== nomParcelle(s, ref.anneau)),
  );
  const glisse = !limiteGlisse
    ? null
    : !sensGlisse
      ? 'Choisis une flèche.'
      : sensGlisse === 'vers'
        ? 'Le bord raccourcit.'
        : 'Le bord s’allonge.';
  return el(
    'div',
    { class: 'info' },
    el(
      'div',
      {},
      el('strong', {}, `Sommet de ${nomParcelle(s, ref.anneau)}`),
      autres.size > 0 ? ` · commun avec ${[...autres].join(', ')}` : '',
    ),
    el(
      'div',
      { class: 'doux' },
      (() => {
        const v = s.etat.anneaux[ref.anneau]!.sommets[ref.sommet]!;
        return `${v.lat.toFixed(7)}, ${v.lon.toFixed(7)}`;
      })(),
    ),
    glisse && el('div', { class: 'sens' }, glisse),
    el('div', { class: 'rangee' }, el('button', { onclick: supprimer }, 'Supprimer'), boutonAjout),
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
    el('strong', {}, 'Surfaces'),
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
    el(
      'div',
      { class: 'rangee' },
      el('strong', { style: 'flex:1' }, `Version ${prochaineVersion()}`),
      el(
        'button',
        {
          class: 'petit',
          onclick: () => {
            const v = prompt(
              'Dernière version exportée :',
              suivi.derniereVersion ?? VERSION_DE_DEPART,
            );
            if (!v?.trim()) return;
            majSuivi({ ...suivi, derniereVersion: v.trim() });
            afficher();
          },
        },
        'Changer',
      ),
    ),
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
          ? el('div', { class: 'ok' }, '✓ Aucun problème')
          : el(
              'div',
              {},
              ...exportPrepare.alertes.map((a) =>
                el('div', { class: a.grave ? 'erreur' : '' }, (a.grave ? '✗ ' : '⚠ ') + a.message),
              ),
            ),
        el(
          'details',
          {},
          el('summary', {}, exportPrepare.resume),
          el('pre', {}, exportPrepare.details),
        ),
        el(
          'div',
          { class: 'rangee' },
          ecritureDossierPossible() &&
            el(
              'button',
              { class: 'principal', onclick: () => void telecharger('dossier') },
              `${graves.length > 0 ? 'Malgré tout : ' : ''}Enregistrer « ${nomDossierVersion(prochaineVersion())} »`,
            ),
          el(
            'button',
            {
              class: ecritureDossierPossible() ? '' : 'principal',
              onclick: () => void telecharger('xml'),
            },
            graves.length > 0 && !ecritureDossierPossible()
              ? 'Télécharger malgré tout'
              : `Télécharger ${NOM_FICHIER} seul`,
          ),
        ),
        emplacementConnu &&
          el(
            'div',
            { class: 'rangee' },
            el('span', { class: 'doux', style: 'flex:1' }, `Dans « ${emplacementConnu} »`),
            el(
              'button',
              {
                class: 'petit',
                onclick: () => {
                  void oublierEmplacement().then(() => {
                    emplacementConnu = null;
                    afficher();
                  });
                },
              },
              'Changer d’emplacement',
            ),
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
// Messages : bulle posée en bas de la carte, qui disparaît seule (touche-la pour la fermer).
const bulle = el('div', { class: 'bulle', hidden: '' });
bulle.addEventListener('click', () => {
  message = null;
  majBulle();
});
let messageAffiche: { texte: string; erreur: boolean } | null = null;
let minuterieBulle: ReturnType<typeof setTimeout> | undefined;

function majBulle(): void {
  bulle.hidden = !message || !session;
  bulle.className = message?.erreur ? 'bulle erreur' : 'bulle';
  bulle.textContent = message?.texte ?? '';
  if (message === messageAffiche) return;
  messageAffiche = message;
  clearTimeout(minuterieBulle);
  const m = message;
  if (!m || !session) return;
  minuterieBulle = setTimeout(
    () => {
      if (message !== m) return;
      message = null;
      majBulle();
    },
    m.erreur ? 7000 : 4000,
  );
}

zones.carte.append(carte.element, el('div', { class: 'gps-sur-carte' }, texteGps), bulle);
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
    ...(s ? [] : [el('h1', {}, 'Contours parcelles')]),
    el('div', { class: 'rangee' }, boutonFichier()),
    ...(s ? [panneauReference()] : []),
    panneauSauvegardeFichier(),
    panneauDrive(),
  ];
  if (s) {
    contenu.push(
      el(
        'div',
        { class: 'rangee' },
        el(
          'button',
          { onclick: reinitialiser, ...(s.historique.length > 0 ? {} : { disabled: '' }) },
          'Réinitialiser',
        ),
        el('button', { onclick: fermerFichier }, 'Fermer le fichier'),
      ),
      ...(sessionNonGardee
        ? [el('div', { class: 'erreur' }, 'Travail non enregistré sur cet appareil.')]
        : []),
    );
    if (s.alertesChargement.length > 0) {
      contenu.push(
        el(
          'div',
          { class: 'info' },
          el('strong', {}, 'Remarques sur le fichier'),
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
  // Sans fichier ouvert (pas de carte), le message reste en tête du panneau.
  const msg =
    message &&
    !session &&
    el('div', { class: message.erreur ? 'info erreur' : 'info' }, message.texte);
  majBulle();

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
    driveEnAttente() &&
      !drive.connecte() &&
      el(
        'button',
        {
          class: 'actif nuage',
          title: 'Reconnecter Google Drive',
          onclick: () => void reconnecterDrive(),
        },
        '☁',
      ),
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
          modeBouton('guidage', 'Guidage'),
        ),
        mode === 'simplifier'
          ? panneauSimplification(s)
          : mode === 'guidage'
            ? panneauGuidage(s)
            : panneauSelection(s),
        panneauRemplacement(s),
        raccourcis(),
      ];
      break;
    case 'suivi':
      contenu = [
        panneauSuiviParcelle(s) ?? el('div', { class: 'info doux' }, 'Touche une parcelle.'),
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
            couleursParEtat ? 'Couleurs : état' : 'Couleurs : voisins',
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
    (mode === 'guidage' && apercuGuidages(s).length > 0) ||
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
