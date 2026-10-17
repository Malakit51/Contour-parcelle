// Onglet Suivi : état des contours et journal.

import { encoder } from '../isoxml/octets';
import { type Parcelle } from '../isoxml/lecture';
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
  nouvelIdNote,
  supprimerNote,
  typesDeNotes,
  LIBELLES,
} from '../suivi/suivi';
import { el } from '../ui/dom';
import { icone } from '../ui/icones';
import { renommer } from '../edition/noms';
import { COULEURS_ETAT, couleurNote, type Session, ui } from './etat';
import { parcelleContenant, estSupprimee } from '../edition/etat';
import { nouvelleSurface } from '../edition/export';
import { enregistrerSauvegarde } from './exporter';
import { afficher } from './mise-en-page';
import {
  arreterOutilsCarte,
  dateFr,
  effacerSelection,
  majSuivi,
  modifier,
  quandFr,
} from './travail';
import { cadrerParcelle, carte } from './vue';
import { annulerTrace, commencerTrace } from './trace-zone';
import { surfaceZone, texteSurface } from '../suivi/zones';

/** Choix de la portée de l'onglet : barre groupée, comme la portée du guidage. */
function choixPortee(): HTMLElement {
  return el(
    'div',
    { class: 'modes' },
    ...(
      [
        ['parcelle', 'Parcelle'],
        ['toutes', 'Toutes'],
        ['journal', 'Journal'],
      ] as const
    ).map(([v, t]) =>
      el(
        'button',
        {
          class: ui.porteeSuivi === v ? 'principal' : '',
          onclick: () => {
            ui.porteeSuivi = v;
            afficher();
          },
        },
        t,
      ),
    ),
  );
}

/** Contenu de l'onglet Suivi : Parcelle (état, remarque, notes), Toutes (liste) ou Journal. */
export function panneauSuivi(s: Session): (HTMLElement | null | false)[] {
  // Le formulaire d'une note reste devant, quelle que soit la portée.
  if (ui.noteEnCours) return [formulaireNote(s, s.td.parcelles[ui.noteEnCours.parcelle]!.nom)];
  switch (ui.porteeSuivi) {
    case 'parcelle':
      return [
        choixPortee(),
        panneauSuiviParcelle(s) ??
          el(
            'div',
            { class: 'info doux' },
            'Touche une parcelle sur la carte, ou choisis-la dans « Toutes ».',
          ),
        panneauNotes(s),
      ];
    case 'toutes':
      return [choixPortee(), ...panneauToutes(s)];
    case 'journal':
      return [choixPortee(), ...panneauJournal(s)];
  }
}

/** Remarque d'avant les notes : devient une note sans endroit (type « Remarque »). */
function remarqueEnNote(p: Parcelle): void {
  const f = fiche(ui.suivi, p);
  const maintenant = new Date().toISOString();
  const avecNote = enregistrerNote(ui.suivi, {
    id: nouvelIdNote(),
    cle: cleParcelle(p),
    parcelle: p.nom,
    type: 'Remarque',
    texte: f.remarque,
    creee: maintenant,
    modifiee: maintenant,
    position: null,
  });
  // La date de la fiche est celle de l'état du contour : on la garde.
  majSuivi(changerFiche(avecNote, p, { remarque: '' }, f.date ? new Date(f.date) : new Date()));
  ui.message = { texte: `Remarque de ${p.nom} passée dans les notes.`, erreur: false };
  afficher();
}

/** État du contour de la parcelle courante : trois états en barre groupée. */
function panneauSuiviParcelle(s: Session): HTMLElement | null {
  if (ui.parcelleCourante === null) return null;
  const p = s.td.parcelles[ui.parcelleCourante]!;
  const f = fiche(ui.suivi, p);
  const derniere = [...ui.suivi.journal].reverse().find((e) => e.cle === cleParcelle(p));
  return el(
    'div',
    { class: 'info' },
    el(
      'div',
      { class: 'entete-selection' },
      // Le nom de la parcelle : un appui pour le changer (écrit dans le fichier exporté).
      el(
        'button',
        {
          class: 'nom-fiche',
          'aria-label': `Renommer ${p.nom}`,
          onclick: () => {
            const i = ui.parcelleCourante!;
            const nom = prompt('Nom de la parcelle (écrit dans le fichier pour la console)', p.nom);
            if (nom === null || nom.trim() === p.nom) return;
            const ancien = p.nom;
            modifier(
              () => renommer(s.td, s.etat, i, nom),
              `${ancien} renommée « ${nom.trim().replace(/\s+/g, ' ')} »`,
              true,
            );
            afficher();
          },
        },
        p.nom,
        icone('modifier', 18),
      ),
      f.date ? el('span', { class: 'doux' }, `depuis le ${dateFr(f.date)}`) : '',
    ),
    el(
      'div',
      { class: 'modes etats-contour' },
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
    // Plus de remarque (doublon avec les notes) : une ancienne remarque peut passer en note.
    f.remarque &&
      el(
        'div',
        { class: 'rangee' },
        el('span', { class: 'doux', style: 'flex:1' }, `Ancienne remarque : ${f.remarque}`),
        el('button', { class: 'petit', onclick: () => remarqueEnNote(p) }, 'En faire une note'),
      ),
    derniere && el('div', { class: 'doux' }, `${quandFr(derniere.quand)} · ${derniere.action}`),
  );
}

/** Surface en hectares, deux décimales (« 22,60 ha »). */
const ha = (m2: number | null) =>
  m2 === null ? '' : `${(m2 / 10000).toFixed(2).replace('.', ',')} ha`;

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
  zone: [number, number][] | null = null,
): void {
  annulerTrace();
  ui.noteEnCours = { id, parcelle, position, obstacle, zone };
  ui.placementNote = false;
  ui.porteeSuivi = 'parcelle';
  champTypeNote.value = type;
  champTexteNote.value = texte;
  afficher();
}

function enregistrerNoteEnCours(s: Session): void {
  const enCours = ui.noteEnCours;
  if (!enCours) return;
  // Une note posée à un endroit est rangée dans la parcelle qui contient cet endroit.
  const ici = enCours.position ? parcelleContenant(s.etat, enCours.position) : null;
  const p = s.td.parcelles[ici ?? enCours.parcelle]!;
  const deplacee = ici !== null && ici !== enCours.parcelle;
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
      cle: ici !== null || !ancienne ? cleParcelle(p) : ancienne.cle,
      parcelle: ici !== null || !ancienne ? p.nom : ancienne.parcelle,
      type,
      texte,
      creee: ancienne?.creee ?? maintenant,
      modifiee: maintenant,
      position: enCours.position,
      ...(enCours.obstacle ? { obstacle: true } : {}),
      ...(enCours.zone ? { zone: enCours.zone } : {}),
    }),
  );
  ui.noteEnCours = null;
  ui.placementNote = false;
  ui.noteVue = id;
  if (deplacee) ui.parcelleCourante = ici;
  ui.message = {
    texte: deplacee
      ? `Note enregistrée sur ${p.nom} (son endroit est dans cette parcelle).`
      : `Note enregistrée sur ${p.nom}.`,
    erreur: false,
  };
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
      { class: ui.placementNote || ui.traceZone ? 'sens' : 'doux' },
      ui.placementNote
        ? 'Touche la carte à l’endroit voulu.'
        : ui.traceZone
          ? ui.traceZone.mode === 'points'
            ? 'Touche les coins de la zone sur la carte, puis « Terminer » en haut.'
            : 'Fais le tour de la zone à pied, puis « Terminer » en haut.'
          : enCours.zone
            ? `Endroit : zone de ${texteSurface(surfaceZone(enCours.zone))} (${enCours.zone.length} points)`
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
            const actif = !ui.placementNote;
            annulerTrace();
            arreterOutilsCarte();
            ui.placementNote = actif;
            afficher();
          },
        },
        'Toucher la carte',
      ),
      el(
        'button',
        {
          class: ui.traceZone?.mode === 'points' ? 'actif' : '',
          onclick: () => commencerTrace('points'),
        },
        'Dessiner une zone',
      ),
      el(
        'button',
        {
          class: ui.traceZone?.mode === 'gps' ? 'actif' : '',
          onclick: () => commencerTrace('gps'),
        },
        'Tracer en marchant',
      ),
      el(
        'button',
        {
          onclick: async () => {
            ui.message = { texte: 'Recherche de la position…', erreur: false };
            afficher();
            try {
              const { p: ici, precision } = await carte.positionTelephone();
              annulerTrace();
              if (ui.noteEnCours) {
                ui.noteEnCours.position = [ici[0], ici[1]];
                ui.noteEnCours.zone = null;
              }
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
              annulerTrace();
              if (ui.noteEnCours) {
                ui.noteEnCours.position = null;
                ui.noteEnCours.zone = null;
              }
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
            annulerTrace();
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
function panneauNotes(s: Session): HTMLElement | null {
  // Le formulaire reste ouvert même si on touche une autre parcelle : la note garde la sienne.
  if (ui.noteEnCours) return formulaireNote(s, s.td.parcelles[ui.noteEnCours.parcelle]!.nom);
  if (ui.parcelleCourante === null) return null;
  const i = ui.parcelleCourante;
  const p = s.td.parcelles[i]!;
  // Une note posée à un endroit s'affiche dans la parcelle qui contient cet endroit (même si elle
  // a été créée alors qu'une voisine était choisie) ; sans endroit, dans sa parcelle.
  const cle = cleParcelle(p);
  const notes = (ui.suivi.notes ?? [])
    .filter((n) => {
      if (n.supprimee) return false;
      const ici = n.position ? parcelleContenant(s.etat, n.position) : null;
      return ici !== null ? ici === i : n.cle === cle;
    })
    .sort((x, y) => y.creee.localeCompare(x.creee));
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
          el('span', { class: 'parcelle-note' }, ` · ${n.parcelle}`),
          n.obstacle ? el('span', { class: 'badge-obstacle' }, ' obstacle') : '',
          n.texte ? ` — ${n.texte}` : '',
          el(
            'span',
            { class: 'doux' },
            ` · ${dateFr(aujourdhui(new Date(n.creee)))}${n.zone ? ` · zone de ${texteSurface(surfaceZone(n.zone))}` : n.position ? '' : ' · toute la parcelle'}`,
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
                  if (n.zone) carte.cadrer(n.zone);
                  else carte.centrerSur(n.position!);
                },
              },
              'Voir',
            ),
          el(
            'button',
            {
              class: 'petit',
              onclick: () =>
                ouvrirNote(i, n.id, n.type, n.texte, n.position, !!n.obstacle, n.zone ?? null),
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

/** Toutes les parcelles : compteurs (qui filtrent la liste), liste, couleurs de la carte. */
function panneauToutes(s: Session): HTMLElement[] {
  const parcelles = s.td.parcelles
    .map((p, i) => ({ p, i, f: fiche(ui.suivi, p) }))
    .filter(({ i }) => !estSupprimee(s.etat, i))
    .sort((a, b) => a.p.nom.localeCompare(b.p.nom, 'fr', { numeric: true }));
  const etats = Object.keys(LIBELLES) as EtatContour[];
  const compteurs = el(
    'div',
    { class: 'compteurs-suivi' },
    ...etats.map((e) =>
      el(
        'button',
        {
          class: `compteur etat-${e}${ui.filtreSuivi === e ? ' choisi' : ''}`,
          onclick: () => {
            ui.filtreSuivi = ui.filtreSuivi === e ? null : e;
            afficher();
          },
        },
        el(
          'span',
          { class: 'compteur-nombre' },
          String(parcelles.filter((x) => x.f.etat === e).length),
        ),
        el('span', { class: 'compteur-libelle' }, LIBELLES[e]),
      ),
    ),
  );
  const visibles = parcelles.filter((x) => ui.filtreSuivi === null || x.f.etat === ui.filtreSuivi);
  // Surface actuelle (celle écrite dans D à l'export) et notes sans endroit : celles-là n'ont pas
  // d'épingle sur la carte, la coche dit qu'il y en a.
  const surfaces = new Map(visibles.map(({ i }) => [i, nouvelleSurface(s.td, s.etat, i)]));
  const sansEndroit = new Set(
    (ui.suivi.notes ?? []).filter((n) => !n.supprimee && !n.position).map((n) => n.cle),
  );
  const total = [...surfaces.values()].reduce((a: number, m) => a + (m ?? 0), 0);
  // Un appui sur une ligne choisit la parcelle et montre sa fiche (portée Parcelle).
  const liste = el(
    'div',
    { class: 'liste-suivi' },
    ...visibles.map(({ p, i, f }) =>
      el(
        'button',
        {
          class: `ligne-suivi${i === ui.parcelleCourante ? ' courante' : ''}`,
          onclick: () => {
            ui.parcelleCourante = i;
            ui.porteeSuivi = 'parcelle';
            effacerSelection();
            afficher();
            cadrerParcelle(i);
          },
        },
        el('span', { class: 'pastille', style: `background:${COULEURS_ETAT[f.etat]}` }),
        el(
          'span',
          { class: 'ligne-suivi-texte' },
          el('span', { class: 'ligne-suivi-nom' }, p.nom),
          f.remarque && el('span', { class: 'doux' }, f.remarque),
        ),
        el('span', { class: 'ligne-suivi-surface' }, ha(surfaces.get(i) ?? null)),
        el(
          'span',
          { class: 'ligne-suivi-note', title: 'Note sans épingle' },
          sansEndroit.has(cleParcelle(p)) ? '✓' : '',
        ),
        el('span', { class: 'doux ligne-suivi-date' }, f.date ? dateFr(f.date) : ''),
      ),
    ),
  );
  const entete = el(
    'div',
    { class: 'ligne-suivi entete' },
    el('span', { class: 'pastille' }),
    el('span', { class: 'ligne-suivi-texte' }, 'Parcelle'),
    el('span', { class: 'ligne-suivi-surface' }, 'Surface'),
    el('span', { class: 'ligne-suivi-note' }, 'Note'),
    el('span', { class: 'ligne-suivi-date' }, 'Date'),
  );
  return [
    el(
      'div',
      { class: 'info' },
      ui.suiviNonEnregistre &&
        el('div', { class: 'erreur' }, 'Suivi non enregistré sur cet appareil.'),
      compteurs,
      visibles.length > 0 && entete,
      visibles.length > 0 ? liste : el('div', { class: 'doux' }, 'Aucune parcelle.'),
      visibles.length > 0 &&
        el('div', { class: 'doux total-suivi' }, `${visibles.length} parcelle(s) · ${ha(total)}`),
    ),
  ];
}

/** Journal des modifications, et les fichiers CSV (suivi, journal, notes). */
function panneauJournal(s: Session): HTMLElement[] {
  const journal = [...ui.suivi.journal].reverse().slice(0, 100);
  // Un seul bouton : le suivi, le journal et les notes partent ensemble, en fichiers CSV.
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
  return [
    el(
      'div',
      { class: 'info' },
      el('strong', {}, 'Fichiers CSV'),
      el(
        'div',
        { class: 'rangee' },
        el('button', { onclick: () => void exporterCsv() }, 'Exporter en CSV'),
        boutonImportCsv(s),
      ),
    ),
    el(
      'div',
      { class: 'info' },
      el(
        'div',
        { class: 'entete-selection' },
        el('strong', {}, 'Journal'),
        el(
          'span',
          { class: 'doux' },
          ui.suivi.journal.length > journal.length
            ? `${journal.length} dernières lignes sur ${ui.suivi.journal.length}`
            : `${journal.length} ligne(s)`,
        ),
      ),
      journal.length === 0 && el('div', { class: 'doux' }, 'Rien pour l’instant.'),
      ...journal.map((e) =>
        el(
          'div',
          { class: 'ligne-journal' },
          el('span', { class: 'doux' }, quandFr(e.quand)),
          el(
            'span',
            {},
            el('strong', {}, e.parcelle),
            ` · ${e.action}` +
              (e.surfaceAvant !== null && e.surfaceApres !== null
                ? ` · ${Math.round(e.surfaceApres - e.surfaceAvant) >= 0 ? '+' : ''}${Math.round(e.surfaceApres - e.surfaceAvant)} m²`
                : ''),
          ),
        ),
      ),
    ),
  ];
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
