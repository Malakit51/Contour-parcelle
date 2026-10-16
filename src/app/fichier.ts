// Onglet Fichier : ouvrir, sauvegarde dans un fichier, partage.

import { encoder } from '../isoxml/octets';
import { aujourdhui } from '../suivi/suivi';
import { el } from '../ui/dom';
import { panneauDrive } from './drive';
import {
  CLE_DOSSIER_SAUVEGARDES,
  CLE_MISE_EN_PAGE,
  CLE_SESSION_ILLISIBLE,
  type Session,
  ui,
} from './etat';
import { enregistrerSauvegarde } from './exporter';
import {
  choisirDossierSauvegardes,
  ecritureDossierPossible,
  oublierDossierSauvegardes,
} from '../ui/dossier';
import { afficher } from './mise-en-page';
import { panneauReference } from './reference';
import { changerNomAppareil, ecrireStockage, nomAppareil } from './stockage';
import { TEXTE_VERSION } from './version';
import {
  charger,
  fermerFichier,
  reinitialiser,
  reprendreSauvegarde,
  sauvegardeComplete,
  travailEnCours,
} from './travail';

// ---------- Sauvegarde dans un fichier (clé USB…) ----------

export async function enregistrerFichierSauvegarde(): Promise<void> {
  if (!ui.session) return;
  if (nomAppareil() === 'appareil') changerNomAppareil();
  const contenu = sauvegardeComplete(ui.session);
  const nom = `contour-parcelle-sauvegarde-${aujourdhui()}.json`;
  const ou = await enregistrerSauvegarde(encoder(JSON.stringify(contenu)), nom, 'application/json');
  ui.message = { texte: `${ou}.`, erreur: ou.startsWith('Dossier') };
  afficher();
}

/** Réglage : dossier « Contour parcelle » où vont les CSV et les sauvegardes. */
function panneauDossierSauvegardes(): HTMLElement | null {
  if (!ecritureDossierPossible()) return null;
  return el(
    'div',
    { class: 'info' },
    el('strong', {}, 'Dossier des sauvegardes'),
    el(
      'div',
      { class: 'doux' },
      ui.dossierSauvegardes
        ? `CSV et sauvegardes vont dans « ${ui.dossierSauvegardes} ».`
        : 'Pas choisi : CSV et sauvegardes vont dans Téléchargements.',
    ),
    el(
      'div',
      { class: 'rangee' },
      el(
        'button',
        {
          onclick: async () => {
            try {
              const chemin = await choisirDossierSauvegardes();
              if (!chemin) return;
              ui.dossierSauvegardes = chemin;
              ecrireStockage(CLE_DOSSIER_SAUVEGARDES, chemin);
              ui.message = { texte: `Les sauvegardes iront dans « ${chemin} ».`, erreur: false };
            } catch (e) {
              ui.message = {
                texte: `Dossier non choisi : ${(e as Error).message}`,
                erreur: true,
              };
            }
            afficher();
          },
        },
        ui.dossierSauvegardes ? 'Changer' : 'Choisir le dossier',
      ),
      ui.dossierSauvegardes &&
        el(
          'button',
          {
            onclick: async () => {
              await oublierDossierSauvegardes();
              ui.dossierSauvegardes = null;
              ecrireStockage(CLE_DOSSIER_SAUVEGARDES, null);
              afficher();
            },
          },
          'Revenir à Téléchargements',
        ),
    ),
  );
}

// Partage direct (menu Android : Bluetooth, Quick Share, messagerie…). Chrome n'accepte de
// partager que certains types de fichiers, pas le .json : la sauvegarde part en .txt (même
// contenu, que « Charger une sauvegarde » relit aussi).
export type NavigateurPartage = Navigator & {
  canShare?: (donnees: { files: File[] }) => boolean;
  share?: (donnees: { files: File[]; title?: string }) => Promise<void>;
};

export function partagePossible(): boolean {
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

export async function partagerSauvegarde(): Promise<void> {
  if (!ui.session) return;
  if (nomAppareil() === 'appareil') changerNomAppareil();
  const contenu = sauvegardeComplete(ui.session);
  const nom = `contour-parcelle-sauvegarde-${aujourdhui()}.txt`;
  const fichier = new File([JSON.stringify(contenu)], nom, { type: 'text/plain' });
  try {
    await (navigator as NavigateurPartage).share!({ files: [fichier], title: nom });
    ui.message = { texte: `${nom} partagé.`, erreur: false };
  } catch (e) {
    // Fermer le menu de partage sans choisir n'est pas une erreur.
    if ((e as Error).name === 'AbortError') return;
    ui.message = { texte: `Partage impossible : ${(e as Error).message}`, erreur: true };
  }
  afficher();
}

export function boutonChargerSauvegarde(): HTMLElement {
  const choix = el('label', { class: 'bouton-fichier secondaire' }, 'Charger');
  const input = el('input', { type: 'file', accept: '.json,.txt,application/json,text/plain' });
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      const contenu: unknown = JSON.parse(await f.text());
      if (!reprendreSauvegarde(contenu, `« ${f.name} »`)) return;
    } catch (e) {
      ui.message = { texte: `Sauvegarde illisible : ${(e as Error).message}`, erreur: true };
      afficher();
    }
  });
  choix.append(input);
  return choix;
}

export function panneauSauvegardeFichier(): HTMLElement {
  return el(
    'div',
    { class: 'info' },
    el('strong', {}, 'Sauvegarde dans un fichier'),
    el(
      'div',
      { class: 'rangee' },
      ui.session
        ? el('button', { onclick: () => void enregistrerFichierSauvegarde() }, 'Enregistrer')
        : null,
      ui.session && partagePossible()
        ? el('button', { onclick: () => void partagerSauvegarde() }, 'Partager')
        : null,
      boutonChargerSauvegarde(),
    ),
  );
}

export function boutonFichier(): HTMLElement {
  const choix = el(
    'label',
    { class: 'bouton-fichier' },
    ui.session ? 'Ouvrir un autre TASKDATA.XML' : 'Ouvrir TASKDATA.XML',
  );
  const input = el('input', { type: 'file' });
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) void charger(f);
  });
  choix.append(input);
  return choix;
}

export function contenuFichier(s: Session | null): Node[] {
  const section = (titre: string) => el('h2', { class: 'titre-section' }, titre);
  const contenu: Node[] = [
    ...(s ? [] : [el('h1', {}, 'Contours parcelles')]),
    // Fichier ouvert : ouvrir, référence, réinitialiser, fermer.
    section('Fichier ouvert'),
    el(
      'div',
      { class: 'info' },
      s && el('strong', {}, s.nomFichier),
      el('div', { class: 'rangee' }, boutonFichier()),
      s &&
        el(
          'div',
          { class: 'rangee' },
          el(
            'button',
            { onclick: reinitialiser, ...(travailEnCours(s.etat) ? {} : { disabled: '' }) },
            'Réinitialiser',
          ),
          el('button', { onclick: fermerFichier }, 'Fermer le fichier'),
        ),
      s &&
        ui.sessionNonGardee &&
        el('div', { class: 'erreur' }, 'Travail non enregistré sur cet appareil.'),
    ),
    ...(s && s.alertesChargement.length > 0
      ? [
          el(
            'div',
            { class: 'info' },
            el('strong', {}, 'Remarques sur le fichier'),
            ...s.alertesChargement.map((a) => el('div', {}, a)),
          ),
        ]
      : []),
    ...(s ? [panneauReference()] : []),
    ...(ui.sessionIllisible
      ? [
          el(
            'div',
            { class: 'info' },
            el('strong', {}, 'Travail illisible mis de côté'),
            el(
              'div',
              { class: 'rangee' },
              el(
                'button',
                {
                  onclick: async () => {
                    const ou = await enregistrerSauvegarde(
                      encoder(ui.sessionIllisible!),
                      `contour-parcelle-travail-illisible-${aujourdhui()}.json`,
                      'application/json',
                    );
                    ui.message = { texte: `${ou}.`, erreur: false };
                    afficher();
                  },
                },
                'Télécharger le travail illisible',
              ),
              el(
                'button',
                {
                  onclick: () => {
                    if (!confirm('Supprimer définitivement ce travail illisible ?')) return;
                    ui.sessionIllisible = null;
                    ecrireStockage(CLE_SESSION_ILLISIBLE, null);
                    afficher();
                  },
                },
                'Supprimer',
              ),
            ),
          ),
        ]
      : []),
    // Sauvegarde : fichier, partage, Drive.
    section('Sauvegarde'),
    panneauSauvegardeFichier(),
    panneauDrive(),
    // Réglages : mise en page, version de l'application.
    section('Réglages'),
    ...[panneauDossierSauvegardes()].filter((x): x is HTMLElement => x !== null),
    el(
      'div',
      { class: 'info' },
      el('strong', {}, 'Mise en page (en portrait)'),
      el(
        'div',
        { class: 'rangee' },
        ...(
          [
            [false, 'Classique'],
            [true, 'Volet'],
          ] as const
        ).map(([v, t]) =>
          el(
            'button',
            {
              class: ui.voletActif === v ? 'actif' : '',
              onclick: () => {
                ui.voletActif = v;
                ecrireStockage(CLE_MISE_EN_PAGE, v ? 'volet' : null);
                afficher();
              },
            },
            t,
          ),
        ),
      ),
      el('div', { class: 'doux' }, TEXTE_VERSION),
    ),
  ];
  return contenu;
}
