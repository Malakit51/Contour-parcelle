// Onglet Suivi : état des contours et journal.

import { encoder } from '../isoxml/octets';
import {
  changerFiche,
  cleParcelle,
  csvJournal,
  csvSuivi,
  type EtatContour,
  fiche,
  importerCsv,
  LIBELLES,
} from '../suivi/suivi';
import { el } from '../ui/dom';
import { type Session, ui } from './etat';
import { enregistrer } from './exporter';
import { afficher } from './mise-en-page';
import { dateFr, effacerSelection, majSuivi, quandFr } from './travail';
import { cadrerParcelle } from './vue';

/** État du contour de la parcelle courante : trois boutons et la remarque. */
export function panneauSuiviParcelle(s: Session): HTMLElement | null {
  if (ui.parcelleCourante === null) return null;
  const p = s.td.parcelles[ui.parcelleCourante]!;
  const f = fiche(ui.suivi, p);
  const derniere = [...ui.suivi.journal].reverse().find((e) => e.cle === cleParcelle(p));
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
              majSuivi(changerFiche(ui.suivi, p, { etat: e }));
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
            majSuivi(changerFiche(ui.suivi, p, { remarque: r.trim() }));
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
export function panneauSuiviGeneral(s: Session): HTMLElement {
  const parcelles = s.td.parcelles
    .map((p, i) => ({ p, i, f: fiche(ui.suivi, p) }))
    .sort((a, b) => a.p.nom.localeCompare(b.p.nom, 'fr', { numeric: true }));
  const compte = (e: EtatContour) => parcelles.filter((x) => x.f.etat === e).length;
  const journal = [...ui.suivi.journal].reverse().slice(0, 50);
  const telechargerCsv = (texte: string, nom: string) =>
    enregistrer(encoder(texte), nom, 'text/csv');
  const bloc = el(
    'details',
    { class: 'info', ...(ui.suiviOuvert ? { open: '' } : {}) },
    el(
      'summary',
      {},
      `Suivi des contours : ${compte('verifie')} vérifiés, ${compte('a-confirmer')} à confirmer, ${compte('a-refaire')} à refaire`,
    ),
    ui.suiviNonEnregistre &&
      el('div', { class: 'erreur' }, 'Suivi non enregistré sur cet appareil.'),
    el(
      'table',
      {},
      el('tr', {}, el('th', {}, 'Parcelle'), el('th', {}, 'État ✓ ? ✗'), el('th', {}, 'Date')),
      ...parcelles.map(({ p, i, f }) => {
        const nom = el('td', { class: 'cliquable' }, p.nom);
        nom.addEventListener('click', () => {
          ui.parcelleCourante = i;
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
                    majSuivi(changerFiche(ui.suivi, p, { etat: e }));
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
        { onclick: () => telechargerCsv(csvSuivi(ui.suivi, s.td.parcelles), 'suivi-contours.csv') },
        'Suivi en CSV',
      ),
      el(
        'button',
        { onclick: () => telechargerCsv(csvJournal(ui.suivi), 'journal-contours.csv') },
        'Journal en CSV',
      ),
      boutonImportCsv(s),
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
  bloc.addEventListener('toggle', () => (ui.suiviOuvert = bloc.open));
  return bloc;
}

/** Reprend un CSV du suivi ou du journal (après un effacement des données de Chrome…). */
function boutonImportCsv(s: Session): HTMLElement {
  const choix = el('label', { class: 'bouton-fichier secondaire' }, 'Charger un CSV');
  const input = el('input', { type: 'file', accept: '.csv,text/csv,text/plain' });
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    try {
      const r = importerCsv(ui.suivi, await f.text(), s.td.parcelles);
      majSuivi(r.suivi);
      const b = r.bilan;
      const quoi =
        b.type === 'suivi'
          ? `Suivi repris : ${b.ajouts} parcelle(s) mise(s) à jour`
          : `Journal repris : ${b.ajouts} ligne(s) ajoutée(s)`;
      const deja =
        b.dejaLa > 0
          ? b.type === 'suivi'
            ? `, ${b.dejaLa} déjà à jour ou plus récente(s) sur l’appareil`
            : `, ${b.dejaLa} déjà présente(s)`
          : '';
      const inconnues =
        b.inconnues.length > 0
          ? b.type === 'suivi'
            ? `. Absentes du fichier ouvert : ${b.inconnues.join(', ')}`
            : `. Illisibles : ${b.inconnues.join(', ')}`
          : '';
      ui.message = { texte: `${quoi}${deja}${inconnues}.`, erreur: b.inconnues.length > 0 };
    } catch (e) {
      ui.message = { texte: `CSV non repris : ${(e as Error).message}`, erreur: true };
    }
    afficher();
  });
  choix.append(input);
  return choix;
}
