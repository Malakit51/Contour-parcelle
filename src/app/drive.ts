// Sauvegarde en ligne dans Google Drive.

import { GOOGLE_CLIENT_ID } from '../sauvegarde/config';
import { ConflitDrive, Drive, type FichierDrive } from '../sauvegarde/drive';
import { el } from '../ui/dom';
import { ui } from './etat';
import { afficher } from './mise-en-page';
import { changerNomAppareil, ecrireStockage, lireStockage, nomAppareil } from './stockage';
import { quandFr, reprendreSauvegarde, sauvegardeComplete } from './travail';

// ---------- Sauvegarde Google Drive ----------

export const drive = new Drive(GOOGLE_CLIENT_ID);
/** État de la sauvegarde en ligne : élément fixe, mis à jour seul (comme le texte du GPS). */
export const texteDrive = el('div', { class: 'doux' });

// La connexion à Google dure environ une heure. Le compte utilisé est retenu sur l'appareil : quand
// la connexion a expiré et qu'il reste des modifications à envoyer, un bouton ☁ dans la barre du
// haut reconnecte d'un appui (sans redemander le compte ni l'autorisation) et envoie.
export const CLE_COMPTE = 'contour-parcelle/compte-google';
export const CLE_ATTENTE = 'contour-parcelle/drive-en-attente';

/** Des modifications n'ont pas encore été envoyées sur Drive (connexion expirée). */
export const driveEnAttente = () => lireStockage(CLE_ATTENTE) === '1';

/** Après chaque modification, si on est connecté : sauvegarde en ligne quelques secondes après. */
export function programmerSauvegardeDrive(): void {
  if (!ui.session || !drive.configure()) return;
  if (!drive.connecte()) {
    // Drive déjà utilisé sur cet appareil : on retient qu'il y a quelque chose à envoyer.
    if (lireStockage(CLE_COMPTE)) ecrireStockage(CLE_ATTENTE, '1');
    return;
  }
  clearTimeout(ui.minuterieDrive);
  texteDrive.textContent = 'Modifications à envoyer sur Google Drive…';
  ui.minuterieDrive = setTimeout(() => void sauverSurDrive(), 4000);
}

/**
 * Date de la sauvegarde en ligne lors de la dernière lecture ou écriture par cet appareil : on
 * n'écrase jamais une sauvegarde modifiée depuis par un autre appareil (ConflitDrive).
 */
export const CLE_DRIVE_VU = 'contour-parcelle/drive-vu';

/** `forcer` : remplacer la sauvegarde en ligne même si un autre appareil l'a modifiée. */
export async function sauverSurDrive(forcer = false): Promise<void> {
  if (!ui.session) return;
  clearTimeout(ui.minuterieDrive);
  const contenu = sauvegardeComplete(ui.session);
  try {
    texteDrive.textContent = 'Envoi sur Google Drive…';
    let f: FichierDrive;
    try {
      f = await drive.ecrire(contenu, forcer ? undefined : lireStockage(CLE_DRIVE_VU));
    } catch (e) {
      // Première fois avec cette version de l'éditeur : si la sauvegarde en ligne vient de cet
      // appareil, ce n'est pas un conflit.
      if (!(e instanceof ConflitDrive) || lireStockage(CLE_DRIVE_VU) !== null) throw e;
      const lu = await drive.lire();
      if ((lu?.contenu as { appareil?: string } | undefined)?.appareil !== nomAppareil()) throw e;
      f = await drive.ecrire(contenu, lu!.fichier.modifie);
    }
    ecrireStockage(CLE_DRIVE_VU, f.modifie);
    ui.driveConflit = null;
    texteDrive.textContent = `Enregistré sur Google Drive le ${quandFr(f.modifie)}.`;
    if (driveEnAttente()) {
      ecrireStockage(CLE_ATTENTE, null);
      afficher();
    }
  } catch (e) {
    if (e instanceof ConflitDrive) {
      ui.driveConflit = e.fichier;
      texteDrive.textContent = `Sauvegarde en ligne modifiée le ${quandFr(e.fichier.modifie)} depuis un autre appareil : rien n’est envoyé. « Reprendre » pour récupérer ce travail, ou « Envoyer quand même » pour le remplacer par celui de cet appareil.`;
      if (lireStockage(CLE_COMPTE)) ecrireStockage(CLE_ATTENTE, '1');
      afficher();
      return;
    }
    texteDrive.textContent = `Pas enregistré sur Google Drive : ${(e as Error).message}`;
    if (lireStockage(CLE_COMPTE)) ecrireStockage(CLE_ATTENTE, '1');
    afficher();
  }
}

export async function connecterDrive(): Promise<void> {
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
    const autre =
      lu &&
      lu.fichier.modifie !== lireStockage(CLE_DRIVE_VU) &&
      enLigne?.appareil !== nomAppareil();
    texteDrive.textContent = lu
      ? `Sauvegarde en ligne du ${quandFr(enLigne?.enregistreLe ?? lu.fichier.modifie)} (${enLigne?.appareil ?? '?'}).` +
        (autre ? ' Elle vient d’un autre appareil : « Reprendre » pour récupérer son travail.' : '')
      : 'Aucune sauvegarde en ligne pour l’instant.';
  } catch (e) {
    texteDrive.textContent = (e as Error).message;
  }
  afficher();
}

/** Bouton ☁ : reconnecte au compte retenu et envoie les modifications en attente. */
export async function reconnecterDrive(): Promise<void> {
  try {
    await drive.connecter(lireStockage(CLE_COMPTE) ?? undefined);
    await sauverSurDrive();
    ui.message = driveEnAttente()
      ? { texte: texteDrive.textContent ?? 'Pas envoyé sur Google Drive.', erreur: true }
      : { texte: 'Envoyé sur Google Drive.', erreur: false };
  } catch (e) {
    ui.message = { texte: (e as Error).message, erreur: true };
  }
  afficher();
}

export async function reprendreDepuisDrive(): Promise<void> {
  try {
    texteDrive.textContent = 'Lecture de la sauvegarde en ligne…';
    const lu = await drive.lire();
    if (!lu) {
      texteDrive.textContent = 'Aucune sauvegarde en ligne pour l’instant.';
      return;
    }
    const quand = reprendreSauvegarde(lu.contenu, 'en ligne');
    if (quand) {
      ecrireStockage(CLE_DRIVE_VU, lu.fichier.modifie);
      ui.driveConflit = null;
    }
    texteDrive.textContent = quand
      ? `Repris depuis la sauvegarde en ligne du ${quand}.`
      : 'Reprise annulée.';
  } catch (e) {
    texteDrive.textContent = `Reprise impossible : ${(e as Error).message}`;
  }
  afficher();
}

export function panneauDrive(): HTMLElement {
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
          ui.driveConflit &&
            el(
              'button',
              {
                onclick: () => {
                  if (
                    confirm('Remplacer la sauvegarde en ligne par le travail de cet appareil ?')
                  ) {
                    void sauverSurDrive(true);
                  }
                },
              },
              'Envoyer quand même',
            ),
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
