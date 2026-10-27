// Le travail en cours : ouverture, modifications, annulation, session gardée sur l’appareil.

import { type Etat, etatInitial, type Guidage, latLon } from '../edition/etat';
import { nouvelleSurface, parcellesModifiees } from '../edition/export';
import { repartirDe } from '../edition/repartir';
import { nettoyer } from '../edition/nettoyage';
import { ErreurEdition } from '../edition/operations';
import { planLocal } from '../geometrie/plan';
import { lireTaskData, type TaskData } from '../isoxml/lecture';
import { decoder } from '../isoxml/octets';
import {
  enregistrerSession,
  garderSurAppareil,
  lireSurAppareil,
  oublierSurAppareil,
  relireSession,
} from '../sauvegarde/session';
import {
  cleParcelle,
  enregistrer as enregistrerSuivi,
  type EntreeJournal,
  fusionner,
  type Suivi,
} from '../suivi/suivi';
import { programmerSauvegardeDrive } from './drive';
import { CLE_SESSION_ILLISIBLE, type Session, ui, ongletDuMode } from './etat';
import { appliquerNoms } from '../edition/noms';
import { afficher } from './mise-en-page';
import { ecrireStockage, nomAppareil, stockage } from './stockage';
import { cadrerTout, colorier } from './vue';

export function majSuivi(nouveau: Suivi): void {
  ui.suivi = nouveau;
  ui.suiviNonEnregistre = !enregistrerSuivi(stockage, ui.suivi);
  programmerSauvegardeDrive();
}

/** Parcelles dont le contour, le nom ou les lignes diffèrent entre deux états. */
export function parcellesChangees(a: Etat, b: Etat): number[] {
  const changees = new Set<number>();
  // Contours comparés parcelle par parcelle (et non anneau par anneau : des anneaux peuvent être
  // ajoutés ou retirés au milieu de la liste, et les indices se décaler).
  const signatures = (e: Etat) => {
    const m = new Map<number, string>();
    for (const x of e.anneaux) {
      const t = x.sommets.map((s) => `${s.lat},${s.lon}`).join(';');
      m.set(x.parcelle, `${m.get(x.parcelle) ?? ''}|${x.type}:${t}`);
    }
    return m;
  };
  const [sa, sb] = [signatures(a), signatures(b)];
  for (const p of new Set([...sa.keys(), ...sb.keys()])) {
    if (sa.get(p) !== sb.get(p)) changees.add(p);
  }
  for (const n of [...(a.noms ?? []), ...(b.noms ?? [])]) {
    const na = a.noms?.find((x) => x.parcelle === n.parcelle)?.nom;
    const nb = b.noms?.find((x) => x.parcelle === n.parcelle)?.nom;
    if (na !== nb) changees.add(n.parcelle);
  }
  for (const z of [...(a.zonesRetirees ?? []), ...(b.zonesRetirees ?? [])]) {
    if ((a.zonesRetirees ?? []).includes(z) !== (b.zonesRetirees ?? []).includes(z)) {
      const x = a.anneaux[z] ?? b.anneaux[z];
      if (x) changees.add(x.parcelle);
    }
  }
  for (const p of [...(a.supprimees ?? []), ...(b.supprimees ?? [])]) {
    if ((a.supprimees ?? []).includes(p) !== (b.supprimees ?? []).includes(p)) changees.add(p);
  }
  const ga = a.guidages ?? [];
  const gb = b.guidages ?? [];
  for (const g of [...ga.filter((x) => !gb.includes(x)), ...gb.filter((x) => !ga.includes(x))]) {
    changees.add(g.parcelle);
  }
  return [...changees];
}

/** Travail qui serait perdu en ouvrant un autre fichier : contours modifiés ou lignes de guidage. */
/** Lignes de guidage ajoutées ou retirées depuis le fichier ouvert (celles d'un export repris comptent pour lui). */
export const nouvellesLignes = (etat: Etat) => {
  const depart = new Set(ui.session?.initial.guidages ?? []);
  return (etat.guidages ?? []).filter((g) => !depart.has(g));
};
const lignesChangees = (etat: Etat) =>
  nouvellesLignes(etat).length > 0 ||
  (etat.guidages?.length ?? 0) !== (ui.session?.initial.guidages?.length ?? 0);

export const travailEnCours = (etat: Etat) =>
  parcellesModifiees(etat).length > 0 ||
  lignesChangees(etat) ||
  (etat.supprimees?.length ?? 0) > 0 ||
  (etat.zonesRetirees?.length ?? 0) > 0 ||
  (etat.ajoutees?.length ?? 0) > 0 ||
  (etat.noms?.length ?? 0) > 0 ||
  etat.taches !== undefined;

/**
 * Passe à un nouvel état (annulable) et note la modification au journal. L'état est d'abord
 * nettoyé (points en double, sommets communs décollés) ; si des points ont été retirés, la
 * sélection est effacée (ses indices ne sont plus sûrs). Renvoie une remarque à ajouter au message.
 */
export function enregistrerModification(s: Session, brut: Etat, quoi: string): string {
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
  // Travaux de la console retirés ou remis : une ligne pour tout le fichier.
  if (s.etat.taches !== nouveau.taches) {
    entrees.push({
      quand: new Date().toISOString(),
      cle: 'fichier',
      parcelle: '—',
      action: quoi,
      surfaceAvant: null,
      surfaceApres: null,
    });
  }
  s.historique.push({ etat: s.etat, journal: entrees });
  s.retablir = [];
  s.etat = nouveau;
  appliquerNoms(s.td, s.etat);
  garderSession();
  majSuivi({ ...ui.suivi, journal: [...ui.suivi.journal, ...entrees] });
  if (net.doublons.size === 0) return '';
  effacerSelection();
  return ` (${[...net.doublons.values()].reduce((a, b) => a + b, 0)} point(s) en double retiré(s))`;
}

export function retirerDuJournal(entrees: EntreeJournal[]): void {
  if (entrees.length === 0) return;
  majSuivi({ ...ui.suivi, journal: ui.suivi.journal.filter((e) => !entrees.includes(e)) });
}

// ---------- Chargement ----------

/**
 * Ouvre un fichier lu (ou une session reprise) : `etat` est l'état modifié, s'il y en a un.
 * `nouveau` : travail qui n'est pas encore sur Drive (faux pour une reprise depuis l'appareil ou
 * depuis Drive), à envoyer.
 */
export function ouvrir(
  td: TaskData,
  nomFichier: string,
  etat: Etat | null,
  texteMessage: string,
  nouveau = true,
  lignesDepart: readonly Guidage[] = [],
): void {
  if (td.parcelles.length === 0) throw new Error('Aucune parcelle (PFD) dans ce fichier.');
  // Fichier repris d'un export de l'éditeur : ses lignes de guidage font partie du départ.
  const initial: Etat = lignesDepart.length
    ? { ...etatInitial(td), guidages: lignesDepart }
    : etatInitial(td);
  const tous = initial.anneaux.flatMap((a) => a.sommets.map(latLon));
  const centre: [number, number] = [
    tous.reduce((s, p) => s + p[0], 0) / tous.length,
    tous.reduce((s, p) => s + p[1], 0) / tous.length,
  ];
  ui.session = {
    td,
    nomFichier,
    plan: planLocal(centre),
    initial,
    etat: etat ?? initial,
    historique: [],
    retablir: [],
    couleurs: colorier(initial, td.parcelles.length),
  };
  appliquerNoms(td, ui.session.etat);
  ui.parcelleCourante = null;
  ui.onglet = ongletDuMode();
  effacerSelection();
  ui.message = { texte: texteMessage, erreur: false };
  garderSession(nouveau);
  // Travail fait avant le nettoyage automatique (14/10/2026) : points en double à retirer.
  const s = ui.session;
  if (nettoyer(s.etat).etat !== s.etat) {
    const note = enregistrerModification(
      s,
      s.etat,
      'Points en double retirés, sommets communs recollés',
    );
    ui.message = { texte: `${texteMessage} Contours nettoyés${note}.`, erreur: false };
  }
  afficher();
  cadrerTout();
}

export async function charger(fichier: File): Promise<void> {
  try {
    const td = lireTaskData(decoder(new Uint8Array(await fichier.arrayBuffer())));
    if (
      ui.session &&
      travailEnCours(ui.session.etat) &&
      !confirm(
        'Des modifications en cours sur le fichier ouvert seront perdues (pense à exporter). Continuer ?',
      )
    ) {
      return;
    }
    ouvrir(td, fichier.name, null, `${fichier.name} chargé : ${td.parcelles.length} parcelles.`);
  } catch (e) {
    ui.message = { texte: `Lecture impossible : ${(e as Error).message}`, erreur: true };
    afficher();
  }
}

/** Enregistre le fichier ouvert et les contours modifiés sur l'appareil (après chaque changement). */
export function garderSession(envoyer = true): void {
  if (!ui.session) return;
  ui.sessionNonGardee = !garderSurAppareil(
    stockage,
    enregistrerSession(
      ui.session.td,
      ui.session.nomFichier,
      ui.session.etat,
      nomAppareil(),
      undefined,
      undefined,
      ui.session.initial.guidages,
    ),
  );
  if (envoyer) programmerSauvegardeDrive();
}

/** Tout le travail à sauvegarder (Drive, fichier, partage) : fichier, contours, guidages, suivi. */
export const sauvegardeComplete = (s: Session) =>
  enregistrerSession(
    s.td,
    s.nomFichier,
    s.etat,
    nomAppareil(),
    ui.suivi,
    undefined,
    s.initial.guidages,
  );

/**
 * Reprend une sauvegarde (Drive ou fichier) : remplace le travail de cet appareil, après
 * confirmation s'il était modifié, et fusionne le suivi. Renvoie la date et l'appareil, ou null
 * si l'utilisateur a renoncé.
 */
export function reprendreSauvegarde(contenu: unknown, provenance: string): string | null {
  const r = relireSession(contenu);
  const quand = `${quandFr(r.session.enregistreLe)} (${r.session.appareil})`;
  if (
    ui.session &&
    travailEnCours(ui.session.etat) &&
    !confirm(`Remplacer le travail de cet appareil par la sauvegarde ${provenance} du ${quand} ?`)
  ) {
    return null;
  }
  if (r.session.suivi) majSuivi(fusionner(ui.suivi, r.session.suivi));
  ouvrir(
    r.td,
    r.nom,
    r.etat,
    `Travail repris : sauvegarde ${provenance} du ${quand}.`,
    provenance !== 'en ligne',
    r.lignesDepart,
  );
  return quand;
}

/** Au démarrage : reprend le travail laissé sur cet appareil. */
export function reprendreSession(): void {
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
      r.lignesDepart,
    );
  } catch (e) {
    // Ne jamais effacer le travail sans prévenir : on le met de côté, téléchargeable.
    ui.sessionIllisible = JSON.stringify(brut);
    ecrireStockage(CLE_SESSION_ILLISIBLE, ui.sessionIllisible);
    oublierSurAppareil(stockage);
    ui.message = {
      texte: `Le travail enregistré sur cet appareil n’a pas pu être repris (${(e as Error).message}). Il est gardé de côté : onglet Fichiers, « Télécharger le travail illisible ».`,
      erreur: true,
    };
    afficher();
  }
}

/** Travail enregistré qui n'a pas pu être repris (gardé pour ne rien perdre). */

export function fermerFichier(): void {
  if (!ui.session) return;
  if (
    travailEnCours(ui.session.etat) &&
    !confirm('Fermer le fichier ? Les modifications non exportées seront perdues.')
  ) {
    return;
  }
  ui.session = null;
  oublierSurAppareil(stockage);
  effacerSelection();
  ui.message = { texte: 'Fichier fermé.', erreur: false };
  afficher();
}

/**
 * Arrête les outils qui attendent le prochain toucher sur la carte : règle, placement d'une note,
 * « ☝ au doigt », ajout d'un point. Un seul peut être actif à la fois.
 */
export function arreterOutilsCarte(): void {
  ui.mesure = null;
  ui.placementNote = false;
  ui.placerAuDoigt = false;
  ui.ajoutEnCours = false;
  ui.repriseBord = null;
  // Le tracé d'une zone au doigt attend des touchers : il s'arrête comme les autres outils. Le
  // tracé en marchant continue (il ne prend pas les touchers) ; il a ses propres boutons.
  if (ui.traceZone?.mode === 'points') ui.traceZone = null;
}

export function effacerSelection(): void {
  ui.placerAuDoigt = false;
  ui.ajoutEnCours = false;
  ui.sensGlisse = null;
  ui.bordDebut = null;
  ui.bord = null;
  ui.modele = null;
  ui.sensLimite = null;
  ui.selLimite = null;
  ui.selSommet = null;
  ui.limiteGlisse = null;
  ui.coupe = null;
  ui.coupeGarder = null;
  ui.fusion = null;
  ui.exportPrepare = null;
}

// ---------- Appliquer, annuler ----------

export function metres(): number {
  const v = Number(ui.saisie.replace(',', '.'));
  return Number.isFinite(v) ? v : 0;
}

/** Écrit un nombre de mètres à la française, au millimètre près : « 0,35 ». */
export const enMetres = (v: number) => String(Math.round(v * 1000) / 1000).replace('.', ',');

/**
 * Applique une modification (annulable). `garderSelection` : le sommet reste sélectionné pour
 * enchaîner (flèches, placement au doigt) ; ses indices ne changent pas quand il bouge.
 */
export function modifier(operation: () => Etat, quoi: string, garderSelection: boolean): void {
  if (!ui.session) return;
  const s = ui.session;
  try {
    const nouveau = operation();
    const note = nouveau !== s.etat ? enregistrerModification(s, nouveau, quoi) : '';
    if (garderSelection) ui.exportPrepare = null;
    else effacerSelection();
    ui.message = { texte: `${quoi}${note}.`, erreur: false };
  } catch (e) {
    ui.message = {
      texte: e instanceof ErreurEdition ? e.message : `Erreur : ${(e as Error).message}`,
      erreur: true,
    };
  }
  afficher();
}

export function annuler(): void {
  const precedent = ui.session?.historique.pop();
  if (!ui.session || !precedent) return;
  ui.session.retablir.push({ etat: ui.session.etat, journal: precedent.journal });
  ui.session.etat = precedent.etat;
  appliquerNoms(ui.session.td, ui.session.etat);
  retirerDuJournal(precedent.journal);
  garderSession();
  effacerSelection();
  ui.message = { texte: 'Dernière modification annulée.', erreur: false };
  afficher();
}

/** Refait la dernière modification annulée (et remet ses lignes au journal). */
export function retablir(): void {
  const suivant = ui.session?.retablir.pop();
  if (!ui.session || !suivant) return;
  const s = ui.session;
  s.historique.push({ etat: s.etat, journal: suivant.journal });
  s.etat = suivant.etat;
  appliquerNoms(s.td, s.etat);
  majSuivi({ ...ui.suivi, journal: [...ui.suivi.journal, ...suivant.journal] });
  garderSession();
  effacerSelection();
  ui.message = { texte: 'Modification rétablie.', erreur: false };
  afficher();
}

/**
 * Après un export : le fichier exporté devient le fichier ouvert (« Réinitialiser » et « ce qui
 * change » partent de lui). On ne peut plus annuler au-delà. La parcelle choisie reste choisie.
 */
export function repartirDuFichier(texte: string, nom: string): void {
  const s = ui.session;
  if (!s) return;
  const guid = ui.parcelleCourante === null ? null : s.td.parcelles[ui.parcelleCourante]!.guid;
  const r = repartirDe(s.td, s.etat, texte);
  s.td = r.td;
  s.nomFichier = nom;
  // Le départ garde les lignes de guidage du fichier exporté : « Réinitialiser » les laisse.
  s.initial = r.etat;
  s.etat = r.etat;
  s.historique = [];
  s.retablir = [];
  s.couleurs = colorier(s.initial, r.td.parcelles.length);
  appliquerNoms(s.td, s.etat);
  const p = guid === null ? -1 : s.td.parcelles.findIndex((x) => x.guid === guid);
  ui.parcelleCourante = p >= 0 ? p : null;
  effacerSelection();
  garderSession();
}

/** Retour au fichier d'origine (contours et lignes de guidage). Annulable, comme une modification. */
export function reinitialiser(): void {
  if (!ui.session || !travailEnCours(ui.session.etat)) return;
  if (
    !confirm(
      `Revenir à « ${ui.session.nomFichier} » ? Contours modifiés et lignes de guidage depuis seront retirés (« Annuler » pour revenir).`,
    )
  ) {
    return;
  }
  enregistrerModification(ui.session, ui.session.initial, 'Retour au fichier d’origine');
  effacerSelection();
  ui.message = { texte: 'Retour au fichier d’origine.', erreur: false };
  afficher();
}

// ---------- Affichage ----------

export const dateFr = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '');
/** « 13/10/2026 14:05 » en heure du téléphone. */
export function quandFr(iso: string): string {
  const d = new Date(iso);
  const z = (n: number) => String(n).padStart(2, '0');
  return `${z(d.getDate())}/${z(d.getMonth() + 1)}/${d.getFullYear()} ${z(d.getHours())}:${z(d.getMinutes())}`;
}
