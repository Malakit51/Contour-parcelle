// Onglet Suivi : état des contours et journal.

import { encoder } from '../isoxml/octets';
import {
  changerFiche,
  cleParcelle,
  csvJournal,
  csvSuivi,
  aujourdhui,
  type EtatContour,
  csvNotes,
  enregistrerNote,
  fiche,
  importerCsv,
  notesDe,
  nouvelIdNote,
  supprimerNote,
  typesDeNotes,
  LIBELLES,
} from '../suivi/suivi';
import { el } from '../ui/dom';
import { couleurNote, type Session, ui } from './etat';
import { enregistrerSauvegarde } from './exporter';
import { afficher } from './mise-en-page';
import { dateFr, effacerSelection, majSuivi, quandFr } from './travail';
import { cadrerParcelle, carte } from './vue';

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

// ---------- Notes sur la parcelle ----------

// Champs créés une seule fois : les recréer pendant la saisie fermerait le clavier.
const listeTypes = el('datalist', { id: 'types-notes' });
const champTypeNote = el('input', {
  type: 'text',
  list: 'types-notes',
  placeholder: 'Type (vulpin, chardons…)',
  autocomplete: 'off',
  enterkeyhint: 'next',
  'aria-label': 'Type de note',
});
const champTexteNote = el('textarea', { placeholder: 'Note', 'aria-label': 'Note' });

function ouvrirNote(
  parcelle: number,
  id: string | null,
  type: string,
  texte: string,
  position: [number, number] | null,
  obstacle: boolean,
): void {
  ui.noteEnCours = { id, parcelle, position, obstacle };
  ui.placementNote = false;
  champTypeNote.value = type;
  champTexteNote.value = texte;
  afficher();
}

function enregistrerNoteEnCours(s: Session): void {
  const enCours = ui.noteEnCours;
  if (!enCours) return;
  const p = s.td.parcelles[enCours.parcelle]!;
  const type = champTypeNote.value.trim();
  const texte = champTexteNote.value.trim();
  if (!type && !texte) {
    ui.message = { texte: 'Tape au moins un type ou un texte.', erreur: true };
    afficher();
    return;
  }
  const maintenant = new Date().toISOString();
  const ancienne = (ui.suivi.notes ?? []).find((n) => n.id === enCours.id);
  const id = enCours.id ?? nouvelIdNote();
  majSuivi(
    enregistrerNote(ui.suivi, {
      id,
      cle: ancienne?.cle ?? cleParcelle(p),
      parcelle: ancienne?.parcelle ?? p.nom,
      type,
      texte,
      creee: ancienne?.creee ?? maintenant,
      modifiee: maintenant,
      position: enCours.position,
      ...(enCours.obstacle ? { obstacle: true } : {}),
    }),
  );
  ui.noteEnCours = null;
  ui.placementNote = false;
  ui.noteVue = id;
  ui.message = { texte: `Note enregistrée sur ${p.nom}.`, erreur: false };
  afficher();
}

function caseObstacle(coche: boolean): HTMLInputElement {
  const c = el('input', { type: 'checkbox', ...(coche ? { checked: '' } : {}) });
  c.addEventListener('change', () => {
    if (ui.noteEnCours) ui.noteEnCours.obstacle = c.checked;
  });
  return c;
}

function formulaireNote(s: Session, nom: string): HTMLElement {
  const enCours = ui.noteEnCours!;
  listeTypes.replaceChildren(...typesDeNotes(ui.suivi).map((t) => el('option', { value: t })));
  return el(
    'div',
    { class: 'info formulaire-note' },
    el('strong', {}, `${enCours.id ? 'Modifier la note' : 'Nouvelle note'} · ${nom}`),
    listeTypes,
    champTypeNote,
    champTexteNote,
    el(
      'label',
      { class: 'case-obstacle' },
      caseObstacle(enCours.obstacle),
      'Obstacle (à mettre en bout d’outil)',
    ),
    el(
      'div',
      { class: ui.placementNote ? 'sens' : 'doux' },
      ui.placementNote
        ? 'Touche la carte à l’endroit voulu.'
        : enCours.position
          ? `Endroit : ${enCours.position[0].toFixed(6)}, ${enCours.position[1].toFixed(6)}`
          : 'Endroit : toute la parcelle',
    ),
    el(
      'div',
      { class: 'rangee' },
      el(
        'button',
        {
          class: ui.placementNote ? 'actif' : '',
          onclick: () => {
            ui.placementNote = !ui.placementNote;
            afficher();
          },
        },
        'Toucher la carte',
      ),
      el(
        'button',
        {
          onclick: async () => {
            ui.message = { texte: 'Recherche de la position…', erreur: false };
            afficher();
            try {
              const { p: ici, precision } = await carte.positionTelephone();
              if (ui.noteEnCours) ui.noteEnCours.position = [ici[0], ici[1]];
              ui.placementNote = false;
              ui.message = {
                texte: `Endroit noté ici (± ${Math.round(precision)} m).`,
                erreur: false,
              };
            } catch (e) {
              ui.message = { texte: `Pas de position : ${(e as Error).message}.`, erreur: true };
            }
            afficher();
          },
        },
        'Ici (GPS)',
      ),
      enCours.position &&
        el(
          'button',
          {
            onclick: () => {
              if (ui.noteEnCours) ui.noteEnCours.position = null;
              ui.placementNote = false;
              afficher();
            },
          },
          'Sans endroit',
        ),
    ),
    el(
      'div',
      { class: 'rangee' },
      el(
        'button',
        { class: 'principal', onclick: () => enregistrerNoteEnCours(s) },
        'Enregistrer la note',
      ),
      el(
        'button',
        {
          onclick: () => {
            ui.noteEnCours = null;
            ui.placementNote = false;
            afficher();
          },
        },
        'Annuler',
      ),
    ),
  );
}

/** Notes de la parcelle courante : liste, ou formulaire d'ajout ou de modification. */
export function panneauNotes(s: Session): HTMLElement | null {
  // Le formulaire reste ouvert même si on touche une autre parcelle : la note garde la sienne.
  if (ui.noteEnCours) return formulaireNote(s, s.td.parcelles[ui.noteEnCours.parcelle]!.nom);
  if (ui.parcelleCourante === null) return null;
  const i = ui.parcelleCourante;
  const p = s.td.parcelles[i]!;
  const notes = notesDe(ui.suivi, p);
  return el(
    'div',
    { class: 'info notes-parcelle' },
    el(
      'div',
      { class: 'entete-selection' },
      el('strong', {}, notes.length > 0 ? `Notes (${notes.length})` : 'Notes'),
      el(
        'button',
        { class: 'petit', onclick: () => ouvrirNote(i, null, '', '', null, false) },
        'Ajouter une note',
      ),
    ),
    ...notes.map((n) =>
      el(
        'div',
        { class: 'note' },
        el('span', { class: 'pastille-note', style: `background:${couleurNote(n.type)}` }),
        el(
          'span',
          {},
          el('strong', {}, n.type || 'Note'),
          n.obstacle ? el('span', { class: 'badge-obstacle' }, ' obstacle') : '',
          n.texte ? ` — ${n.texte}` : '',
          el(
            'span',
            { class: 'doux' },
            ` · ${dateFr(aujourdhui(new Date(n.creee)))}${n.position ? '' : ' · toute la parcelle'}`,
          ),
        ),
        el(
          'span',
          { class: 'rangee', style: 'margin:0;flex-wrap:nowrap' },
          n.position &&
            el(
              'button',
              {
                class: 'petit',
                onclick: () => {
                  ui.noteVue = n.id;
                  afficher();
                  carte.centrerSur(n.position!);
                },
              },
              'Voir',
            ),
          el(
            'button',
            {
              class: 'petit',
              onclick: () => ouvrirNote(i, n.id, n.type, n.texte, n.position, !!n.obstacle),
            },
            'Modifier',
          ),
          el(
            'button',
            {
              class: 'petit',
              onclick: () => {
                // « Annuler » ne vaut que pour les contours : on demande confirmation.
                if (!confirm(`Supprimer la note « ${n.type || n.texte} » ?`)) return;
                majSuivi(supprimerNote(ui.suivi, n.id));
                ui.message = { texte: 'Note supprimée.', erreur: false };
                afficher();
              },
            },
            'Supprimer',
          ),
        ),
      ),
    ),
  );
}

/** Liste de toutes les parcelles avec leur état, journal et exports CSV. */
export function panneauSuiviGeneral(s: Session): HTMLElement {
  const parcelles = s.td.parcelles
    .map((p, i) => ({ p, i, f: fiche(ui.suivi, p) }))
    .sort((a, b) => a.p.nom.localeCompare(b.p.nom, 'fr', { numeric: true }));
  const compte = (e: EtatContour) => parcelles.filter((x) => x.f.etat === e).length;
  const journal = [...ui.suivi.journal].reverse().slice(0, 50);
  // Un seul bouton : le suivi et le journal partent ensemble, en deux fichiers CSV.
  const exporterCsv = async () => {
    const ou = [
      await enregistrerSauvegarde(
        encoder(csvSuivi(ui.suivi, s.td.parcelles)),
        `suivi-contours-${aujourdhui()}.csv`,
        'text/csv',
      ),
      await enregistrerSauvegarde(
        encoder(csvJournal(ui.suivi)),
        `journal-contours-${aujourdhui()}.csv`,
        'text/csv',
      ),
      ...((ui.suivi.notes ?? []).some((n) => !n.supprimee)
        ? [
            await enregistrerSauvegarde(
              encoder(csvNotes(ui.suivi)),
              `notes-parcelles-${aujourdhui()}.csv`,
              'text/csv',
            ),
          ]
        : []),
    ];
    ui.message = { texte: `${ou.join('. ')}.`, erreur: ou.some((t) => t.startsWith('Dossier')) };
    afficher();
  };
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
      'div',
      { class: 'rangee' },
      el('button', { onclick: () => void exporterCsv() }, 'Exporter en CSV'),
      boutonImportCsv(s),
    ),
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
  // Plusieurs fichiers à la fois : le suivi et le journal se reprennent d'un coup.
  const input = el('input', { type: 'file', accept: '.csv,text/csv,text/plain', multiple: '' });
  input.addEventListener('change', async () => {
    const fichiers = [...(input.files ?? [])];
    input.value = '';
    const messages: { texte: string; erreur: boolean }[] = [];
    for (const f of fichiers) messages.push(await reprendreCsv(s, f));
    if (messages.length === 0) return;
    ui.message = {
      texte: messages.map((m) => m.texte).join(' '),
      erreur: messages.some((m) => m.erreur),
    };
    afficher();
  });
  choix.append(input);
  return choix;
}

async function reprendreCsv(s: Session, f: File): Promise<{ texte: string; erreur: boolean }> {
  try {
    const r = importerCsv(ui.suivi, await f.text(), s.td.parcelles);
    majSuivi(r.suivi);
    const b = r.bilan;
    const quoi =
      b.type === 'suivi'
        ? `Suivi repris : ${b.ajouts} parcelle(s) mise(s) à jour`
        : b.type === 'notes'
          ? `Notes reprises : ${b.ajouts} ajoutée(s)`
          : `Journal repris : ${b.ajouts} ligne(s) ajoutée(s)`;
    const deja =
      b.dejaLa > 0
        ? b.type === 'suivi'
          ? `, ${b.dejaLa} déjà à jour ou plus récente(s) sur l’appareil`
          : `, ${b.dejaLa} déjà présente(s)`
        : '';
    const inconnues =
      b.inconnues.length > 0
        ? b.type !== 'journal'
          ? `. Absentes du fichier ouvert : ${b.inconnues.join(', ')}`
          : `. Illisibles : ${b.inconnues.join(', ')}`
        : '';
    return { texte: `${quoi}${deja}${inconnues}.`, erreur: b.inconnues.length > 0 };
  } catch (e) {
    return { texte: `${f.name} non repris : ${(e as Error).message}`, erreur: true };
  }
}
