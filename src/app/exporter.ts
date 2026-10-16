// Onglet Export : vérification, récapitulatif de version, enregistrement.

import { type Alerte, controler } from '../edition/controles';
import {
  exporterEtat,
  nouvelleSurface,
  parcellesModifiees,
  verifierRelecture,
} from '../edition/export';
import { comparer } from '../isoxml/comparaison';
import { encoder } from '../isoxml/octets';
import { cleParcelle, VERSION_DE_DEPART, versionSuivante } from '../suivi/suivi';
import { el } from '../ui/dom';
import {
  ecrireDossierTaskdata,
  ecritureDossierPossible,
  NOM_DOSSIER,
  NOM_FICHIER,
  nomEmplacement,
  oublierEmplacement,
  ecrireDansSauvegardes,
  nomDossierSauvegardes,
} from '../ui/dossier';
import { CLE_DOSSIER_SAUVEGARDES, type Session, ui } from './etat';
import { afficher } from './mise-en-page';
import { ecrireStockage } from './stockage';
import { majSuivi } from './travail';

/** Écart de surface en hectares, signé, à 4 décimales : « +0,0395 ». */
export const haSigne = (m2: number) =>
  `${m2 > 0 ? '+' : m2 < 0 ? '−' : ''}${(Math.abs(m2) / 10_000).toFixed(4).replace('.', ',')}`;

// ---------- Export ----------

export function preparerExport(): void {
  if (!ui.session) return;
  const s = ui.session;
  let texte: string;
  try {
    texte = exporterEtat(s.td, s.etat);
  } catch (e) {
    ui.exportPrepare = null;
    ui.message = { texte: `Export impossible : ${(e as Error).message}`, erreur: true };
    afficher();
    return;
  }
  const alertes: Alerte[] = [
    ...verifierRelecture(s.td, s.etat, texte).map((m) => ({ grave: true, message: m })),
    ...controler(s.td, s.etat, parcellesModifiees(s.etat)),
  ];
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
  ui.exportPrepare = { texte, alertes, resume, details };
  afficher();
}

export function enregistrer(octets: Uint8Array, nom: string, type: string): void {
  const blob = new Blob([octets as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: nom });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

void nomEmplacement().then((n) => {
  ui.emplacementConnu = n;
});
// Le dossier des sauvegardes affiché doit exister encore (données du navigateur effacées…).
void nomDossierSauvegardes().then((n) => {
  if (!n && ui.dossierSauvegardes) {
    ui.dossierSauvegardes = null;
    ecrireStockage(CLE_DOSSIER_SAUVEGARDES, null);
  }
});

/**
 * Enregistre un fichier de sauvegarde (CSV, .json) : dans le dossier « Contour parcelle » s'il est
 * choisi et accessible, sinon par un téléchargement. Renvoie où il est parti, pour la bulle.
 */
export async function enregistrerSauvegarde(
  octets: Uint8Array,
  nom: string,
  type: string,
): Promise<string> {
  if (ui.dossierSauvegardes) {
    const chemin = await ecrireDansSauvegardes(octets, nom);
    if (chemin) return `${nom} enregistré dans « ${ui.dossierSauvegardes} »`;
    enregistrer(octets, nom, type);
    return `Dossier « ${ui.dossierSauvegardes} » inaccessible : ${nom} téléchargé dans Téléchargements`;
  }
  enregistrer(octets, nom, type);
  return `${nom} enregistré dans Téléchargements`;
}

/** Nom du dossier écrit sur la clé : « TASKDATA 0.12 », pour le retrouver tel quel sur la console. */
export const nomDossierVersion = (version: string) => `${NOM_DOSSIER} ${version}`;

/** Version que portera le prochain export (« 0.12 » après « 0.11 »…). */
export function prochaineVersion(): string {
  return versionSuivante(ui.suivi.derniereVersion ?? VERSION_DE_DEPART);
}

export async function telecharger(quoi: 'dossier' | 'xml'): Promise<void> {
  if (!ui.exportPrepare || !ui.session) return;
  if (
    ui.exportPrepare.alertes.some((a) => a.grave) &&
    !confirm('Des problèmes graves ont été trouvés. Exporter quand même ?')
  ) {
    return;
  }
  const xml = encoder(ui.exportPrepare.texte);
  const version = prochaineVersion();
  let destination: string;
  if (quoi === 'dossier') {
    try {
      const chemin = await ecrireDossierTaskdata(xml, nomDossierVersion(version), (c) =>
        confirm(`${c} existe déjà. Le remplacer ?\n\nConseil : travaille sur une copie.`),
      );
      if (!chemin) return;
      destination = chemin;
      ui.message = { texte: `Enregistré : ${chemin}`, erreur: false };
      ui.emplacementConnu = await nomEmplacement();
    } catch (e) {
      ui.message = { texte: `Enregistrement impossible : ${(e as Error).message}`, erreur: true };
      afficher();
      return;
    }
  } else {
    enregistrer(xml, NOM_FICHIER, 'application/xml');
    destination = `${NOM_FICHIER} (Téléchargements)`;
  }
  const s = ui.session;
  const quand = new Date().toISOString();
  const modifiees = parcellesModifiees(s.etat);
  const nbLignes = s.etat.guidages?.length ?? 0;
  const action =
    `Exporté : version ${version} (${destination})` +
    ` — ${modifiees.length} contour(s) modifié(s), ${nbLignes} ligne(s) de guidage`;
  majSuivi({
    ...ui.suivi,
    derniereVersion: version,
    journal: [
      ...ui.suivi.journal,
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
  ui.message = {
    texte:
      quoi === 'xml'
        ? `Version ${version} : ${NOM_FICHIER} téléchargé, à mettre dans un dossier ${NOM_DOSSIER} sur la clé.`
        : `Version ${version} exportée (${destination}).`,
    erreur: false,
  };
  afficher();
}

/**
 * Récapitulatif de la version qui sera exportée : ce qui change par rapport au fichier ouvert
 * (contours modifiés avec leur surface, lignes de guidage créées).
 */
export function tableauVersion(s: Session): HTMLElement {
  const modifiees = new Set(parcellesModifiees(s.etat));
  const guidages = s.etat.guidages ?? [];
  const parcelles = [...new Set([...modifiees, ...guidages.map((g) => g.parcelle)])].sort((a, b) =>
    s.td.parcelles[a]!.nom.localeCompare(s.td.parcelles[b]!.nom, 'fr', { numeric: true }),
  );
  const titre = el('strong', {}, `Version ${prochaineVersion()}`);
  if (parcelles.length === 0) {
    return el(
      'div',
      { class: 'info' },
      titre,
      el('div', { class: 'doux' }, `Aucun changement par rapport à ${s.nomFichier}.`),
    );
  }
  const ha = (m2: number) => (m2 / 10_000).toFixed(4).replace('.', ',');
  return el(
    'div',
    { class: 'info' },
    titre,
    el(
      'div',
      { class: 'doux' },
      `Par rapport à ${s.nomFichier} : ${modifiees.size} contour(s) modifié(s), ${guidages.length} ligne(s) de guidage.`,
    ),
    el(
      'table',
      {},
      el(
        'tr',
        {},
        el('th', {}, 'Parcelle'),
        el('th', {}, 'surface (ha)'),
        el('th', {}, 'écart (ha)'),
        el('th', {}, 'lignes'),
      ),
      ...parcelles.map((p) => {
        const avant = Number(s.td.parcelles[p]!.surface?.texte ?? NaN);
        const apres = nouvelleSurface(s.td, s.etat, p) ?? NaN;
        const n = guidages.filter((g) => g.parcelle === p).length;
        return el(
          'tr',
          {},
          el('td', {}, s.td.parcelles[p]!.nom),
          el('td', {}, ha(Math.round(apres))),
          el('td', {}, modifiees.has(p) ? haSigne(Math.round(apres) - avant) : '—'),
          el('td', {}, n > 0 ? String(n) : '—'),
        );
      }),
    ),
  );
}

export function panneauExport(): HTMLElement {
  const bloc = el(
    'div',
    { class: 'info' },
    el(
      'div',
      { class: 'rangee' },
      el('span', { class: 'doux', style: 'flex:1' }, `Numéro de version : ${prochaineVersion()}`),
      el(
        'button',
        {
          class: 'petit',
          onclick: () => {
            const v = prompt(
              'Dernière version exportée :',
              ui.suivi.derniereVersion ?? VERSION_DE_DEPART,
            );
            if (!v?.trim()) return;
            majSuivi({ ...ui.suivi, derniereVersion: v.trim() });
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
  if (ui.exportPrepare) {
    const graves = ui.exportPrepare.alertes.filter((a) => a.grave);
    bloc.append(
      el(
        'div',
        {},
        ui.exportPrepare.alertes.length === 0
          ? el('div', { class: 'ok' }, '✓ Aucun problème')
          : el(
              'div',
              {},
              ...ui.exportPrepare.alertes.map((a) =>
                el('div', { class: a.grave ? 'erreur' : '' }, (a.grave ? '✗ ' : '⚠ ') + a.message),
              ),
            ),
        el(
          'details',
          {},
          el('summary', {}, ui.exportPrepare.resume),
          el('pre', {}, ui.exportPrepare.details),
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
        ui.emplacementConnu &&
          el(
            'div',
            { class: 'rangee' },
            el('span', { class: 'doux', style: 'flex:1' }, `Dans « ${ui.emplacementConnu} »`),
            el(
              'button',
              {
                class: 'petit',
                onclick: () => {
                  void oublierEmplacement().then(() => {
                    ui.emplacementConnu = null;
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
