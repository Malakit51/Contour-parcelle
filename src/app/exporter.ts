// Onglet Export : vérification, récapitulatif de version, enregistrement.

import { type Alerte, controler } from '../edition/controles';
import {
  exporterEtat,
  nouvelleSurface,
  parcellesModifiees,
  verifierRelecture,
} from '../edition/export';
import { comparer } from '../isoxml/comparaison';
import { blocsDeParcelle, tachesDuFichier } from '../isoxml/ecriture';
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
import { majSuivi, modifier } from './travail';
import { remettreParcelle, remettreZone } from '../edition/operations';

/** Écart de surface en hectares, signé, à 4 décimales : « +0,0395 ». */
export const haSigne = (m2: number) =>
  `${m2 > 0 ? '+' : m2 < 0 ? '−' : ''}${(Math.abs(m2) / 10_000).toFixed(4).replace('.', ',')}`;

// ---------- Export ----------

/**
 * Prépare l'export du travail en cours : texte du fichier, contrôles, différences avec l'original.
 * Fait tout seul à l'ouverture de l'onglet Export (et refait après chaque modification).
 */
export function preparerExport(): void {
  if (!ui.session) return;
  const s = ui.session;
  let texte: string;
  try {
    texte = exporterEtat(s.td, s.etat);
  } catch (e) {
    ui.exportPrepare = null;
    ui.erreurExport = (e as Error).message;
    return;
  }
  ui.erreurExport = null;
  const alertes: Alerte[] = [
    ...verifierRelecture(s.td, s.etat, texte).map((m) => ({ grave: true, message: m })),
    ...controler(s.td, s.etat, parcellesModifiees(s.etat)),
  ];
  const diffs = comparer(s.td.texte, texte);
  const modifiees = diffs.filter((d) => d.avant !== null && d.apres !== null).length;
  const ajoutees = diffs.filter((d) => d.avant === null).length;
  const retirees = diffs.filter((d) => d.apres === null).length;
  const resume = `${modifiees} ligne(s) modifiée(s), ${ajoutees} ajoutée(s), ${retirees} retirée(s)`;
  const details = diffs
    .map((d) =>
      d.avant !== null && d.apres !== null
        ? `ligne ${d.ligneAvant} modifiée\n  avant : ${d.avant.trimEnd()}\n  après : ${d.apres.trimEnd()}`
        : d.avant !== null
          ? `ligne ${d.ligneAvant} retirée : ${d.avant.trimEnd()}`
          : `ligne ajoutée (${d.ligneApres}) : ${d.apres!.trimEnd()}`,
    )
    .join('\n');
  ui.exportPrepare = { texte, alertes, resume, details, etat: s.etat };
}

/** Export prêt pour le travail en cours (préparé si besoin). */
export function exportAJour(): typeof ui.exportPrepare {
  if (!ui.session) return null;
  if (!ui.exportPrepare || ui.exportPrepare.etat !== ui.session.etat) preparerExport();
  return ui.exportPrepare;
}

/** Bouton principal de l'onglet Export (barre du bas) : écrire sur la clé, ou télécharger. */
export const exporterVersCle = () =>
  void telecharger(ecritureDossierPossible() ? 'dossier' : 'xml');
export const texteBoutonExport = () =>
  ecritureDossierPossible()
    ? `Enregistrer « ${nomDossierVersion(prochaineVersion())} »`
    : `Télécharger ${NOM_FICHIER}`;

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
  const prepare = exportAJour();
  if (!prepare || !ui.session) {
    ui.message = {
      texte: `Export impossible : ${ui.erreurExport ?? 'aucun fichier ouvert'}`,
      erreur: true,
    };
    afficher();
    return;
  }
  if (
    prepare.alertes.some((a) => a.grave) &&
    !confirm('Des problèmes graves ont été trouvés. Exporter quand même ?')
  ) {
    return;
  }
  const xml = encoder(prepare.texte);
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
 * Onglet Export : contrôle (fait tout seul), version et ce qui change par rapport au fichier ouvert.
 * Le bouton principal (« Enregistrer « TASKDATA 0.12 » ») est dans la barre du bas.
 */
/**
 * Travaux du fichier (TSK) : les garder, retirer ceux encore prévus (pulvérisations préparées
 * dans xarvio), ou tous (avec les chantiers enregistrés par la console). Seulement à l'export.
 */
function cadreTaches(s: Session): HTMLElement | null {
  const taches = tachesDuFichier(s.td.texte);
  if (taches.length === 0) return null;
  const prevues = taches.filter((t) => t.statut === '1').length;
  const choix = s.etat.taches ?? null;
  const options: [typeof choix, string, string][] = [
    [null, 'Garder', `${taches.length} travaux`],
    ...(prevues > 0
      ? ([['prevues', 'Retirer les prévus', `${prevues} pas encore faits`]] as [
          typeof choix,
          string,
          string,
        ][])
      : []),
    ['toutes', 'Retirer tout', `aussi les ${taches.length - prevues} chantiers enregistrés`],
  ];
  return el(
    'div',
    { class: 'info' },
    el('strong', {}, 'Travaux de la console'),
    el(
      'div',
      { class: 'doux' },
      `${prevues} prévu(s) (pulvérisations préparées…), ${taches.length - prevues} enregistré(s) par la console. Les retirer ne touche pas aux parcelles.`,
    ),
    el(
      'div',
      { class: 'cartes-sens' },
      ...options.map(([v, titre, effet]) =>
        el(
          'button',
          {
            class: `carte-sens${choix === v ? ' choisie' : ''}`,
            onclick: () => {
              if (choix === v) return;
              modifier(
                () => {
                  const { taches: _, ...reste } = s.etat;
                  return v ? { ...reste, taches: v } : reste;
                },
                v === 'prevues'
                  ? `${prevues} travaux prévus retirés de l’export`
                  : v === 'toutes'
                    ? `Tous les travaux (${taches.length}) retirés de l’export`
                    : 'Travaux gardés dans l’export',
                true,
              );
              afficher();
            },
          },
          el('span', { class: 'carte-sens-titre' }, titre),
          el('span', { class: 'carte-sens-effet' }, effet),
        ),
      ),
    ),
  );
}

export function panneauExport(s: Session): HTMLElement[] {
  const prepare = exportAJour();
  const graves = prepare?.alertes.filter((a) => a.grave) ?? [];
  // 1. Contrôle du fichier produit.
  const controle = !prepare
    ? el(
        'div',
        { class: 'info' },
        el('strong', { class: 'erreur' }, '✗ Export impossible'),
        el('div', {}, ui.erreurExport ?? ''),
      )
    : el(
        'div',
        {
          class: `info controle-export${graves.length > 0 ? ' grave' : prepare.alertes.length > 0 ? ' alerte' : ' ok'}`,
        },
        el(
          'strong',
          {},
          graves.length > 0
            ? `✗ ${graves.length} problème(s) grave(s)`
            : prepare.alertes.length > 0
              ? `⚠ ${prepare.alertes.length} point(s) à regarder`
              : '✓ Prêt pour la console : aucun problème',
        ),
        ...prepare.alertes.map((a) =>
          el('div', { class: a.grave ? 'erreur' : '' }, (a.grave ? '✗ ' : '⚠ ') + a.message),
        ),
        el(
          'details',
          {},
          el('summary', { class: 'doux' }, `Fichier : ${prepare.resume}`),
          el('pre', {}, prepare.details || 'Identique au fichier ouvert.'),
        ),
      );
  // 2. Version et ce qui change.
  const modifiees = new Set(parcellesModifiees(s.etat));
  const guidages = s.etat.guidages ?? [];
  const parcelles = [...new Set([...modifiees, ...guidages.map((g) => g.parcelle)])].sort((a, b) =>
    s.td.parcelles[a]!.nom.localeCompare(s.td.parcelles[b]!.nom, 'fr', { numeric: true }),
  );
  const ha = (m2: number) => (m2 / 10_000).toFixed(4).replace('.', ',');
  const version = el(
    'div',
    { class: 'info' },
    el(
      'div',
      { class: 'entete-selection' },
      el('strong', {}, `Version ${prochaineVersion()}`),
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
        'Changer le numéro',
      ),
    ),
    // Zones exclues retirées : idem.
    ...(s.etat.zonesRetirees ?? []).map((z) => {
      const p = s.etat.anneaux[z]!.parcelle;
      return el(
        'div',
        { class: 'rangee' },
        el(
          'span',
          { class: 'erreur', style: 'flex:1' },
          `${s.td.parcelles[p]!.nom} : zone exclue retirée`,
        ),
        el(
          'button',
          {
            class: 'petit',
            onclick: () =>
              modifier(
                () => remettreZone(ui.session!.etat, z),
                `Zone exclue de ${s.td.parcelles[p]!.nom} remise`,
                false,
              ),
          },
          'Remettre',
        ),
      );
    }),
    // Parcelles retirées : rappelées ici, avec de quoi les remettre.
    ...(s.etat.supprimees ?? []).map((p) => {
      const n = blocsDeParcelle(s.td.texte, s.td.parcelles[p]!.id).taches.length;
      return el(
        'div',
        { class: 'rangee' },
        el(
          'span',
          { class: 'erreur', style: 'flex:1' },
          `${s.td.parcelles[p]!.nom} : retirée du fichier${n > 0 ? `, avec ${n} tâche(s)` : ''}`,
        ),
        el(
          'button',
          {
            class: 'petit',
            onclick: () =>
              modifier(
                () => remettreParcelle(ui.session!.etat, p),
                `${s.td.parcelles[p]!.nom} remise dans le fichier`,
                false,
              ),
          },
          'Remettre',
        ),
      );
    }),
    parcelles.length === 0 && !(s.etat.supprimees?.length ?? 0)
      ? el('div', { class: 'doux' }, `Aucun changement par rapport à ${s.nomFichier}.`)
      : parcelles.length === 0
        ? false
        : el(
            'div',
            {},
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
          ),
  );
  // 3. Où ça part : emplacement retenu, autre façon d'exporter.
  const ou = el(
    'div',
    { class: 'info' },
    el(
      'div',
      { class: 'doux' },
      ecritureDossierPossible()
        ? ui.emplacementConnu
          ? `Le bouton du bas écrit le dossier « ${nomDossierVersion(prochaineVersion())} » dans « ${ui.emplacementConnu} ».`
          : `Le bouton du bas demande où écrire le dossier « ${nomDossierVersion(prochaineVersion())} » (la clé USB).`
        : `Le bouton du bas télécharge ${NOM_FICHIER} : mets-le dans un dossier ${NOM_DOSSIER} sur la clé.`,
    ),
    el(
      'div',
      { class: 'rangee' },
      ecritureDossierPossible() &&
        ui.emplacementConnu &&
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
      ecritureDossierPossible() &&
        el(
          'button',
          { class: 'petit', onclick: () => void telecharger('xml') },
          `Télécharger ${NOM_FICHIER} seul`,
        ),
    ),
  );
  return [controle, version, cadreTaches(s), ou].filter((x): x is HTMLElement => x !== null);
}
