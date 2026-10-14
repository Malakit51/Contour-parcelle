// Onglet Modifier : limite, point, simplification, Appliquer.

import { type Etat, latLon, limitesJumelles, sommetsEn } from '../edition/etat';
import { nouvelleSurface } from '../edition/export';
import { ajouterGuidages } from '../edition/guidages';
import {
  decalerLimite,
  decalerSommet,
  ErreurEdition,
  glisserSommetLeLong,
  retrouverLimite,
  simplifierParcelle,
  sommetsDuBord,
  supprimerSommet,
} from '../edition/operations';
import { planLocal } from '../geometrie/plan';
import { ecartMaximal } from '../geometrie/simplification';
import { el } from '../ui/dom';
import { type Session, TOLERANCES, ui } from './etat';
import { apercuGuidages, baseNomLignes } from './guidage';
import { afficher } from './mise-en-page';
import { effacerSelection, enMetres, enregistrerModification, metres, modifier } from './travail';
import { coteLimite, effetsLimite, longueur, nomParcelle } from './vue';

export const DIRECTIONS = {
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
export function fleche(direction: keyof typeof DIRECTIONS): void {
  if (!ui.session || !ui.selSommet) return;
  const s = ui.session;
  const ref = ui.selSommet;
  const d = Math.abs(metres());
  if (d === 0) {
    ui.message = { texte: 'Tape d’abord une distance.', erreur: true };
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
export function commandesSommet(): HTMLElement {
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
        class: ui.placerAuDoigt ? 'actif' : '',
        title: 'Placer au doigt',
        onclick: () => {
          ui.placerAuDoigt = !ui.placerAuDoigt;
          ui.message = ui.placerAuDoigt
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

export function supprimer(): void {
  if (!ui.session || !ui.selSommet) return;
  const s = ui.session;
  const ref = ui.selSommet;
  modifier(
    () => supprimerSommet(s.etat, ref),
    `Point de ${nomParcelle(s, ref.anneau)} supprimé`,
    false,
  );
}

/** Aperçu de la simplification de la parcelle courante (rien n'est encore modifié). */
export function apercuSimplification(s: Session) {
  if (ui.mode !== 'simplifier' || ui.parcelleCourante === null) return null;
  if (ui.porteeSimplif === 'bord') {
    return ui.bord ? simplifierParcelle(s.etat, ui.parcelleCourante, ui.tolerance, ui.bord) : null;
  }
  return simplifierParcelle(s.etat, ui.parcelleCourante, ui.tolerance);
}

export const enCm = (m: number) => `${Math.round(m * 100)} cm`;

export function appliquer(): void {
  if (!ui.session) return;
  const s = ui.session;
  const d = metres();
  if (d === 0 && (ui.mode === 'limite' || ui.mode === 'sommet')) {
    ui.message = { texte: 'Tape d’abord une distance.', erreur: true };
    afficher();
    return;
  }
  try {
    let nouveau: Etat;
    let quoi: string;
    if (ui.mode === 'limite' && ui.selLimite && ui.sensLimite) {
      const ecart = Math.abs(d);
      quoi = `Limite ${coteLimite(s, ui.selLimite)} de ${nomParcelle(s, ui.selLimite.anneau)} décalée de ${enMetres(ecart)} m ${effetsLimite(s, ui.selLimite)[ui.sensLimite]}`;
      nouveau = decalerLimite(s.etat, ui.selLimite, ui.sensLimite === 'exterieur' ? ecart : -ecart);
    } else if (ui.mode === 'sommet' && ui.selSommet && ui.limiteGlisse && ui.sensGlisse) {
      quoi = `Point de ${nomParcelle(s, ui.selSommet.anneau)} glissé de ${enMetres(Math.abs(d))} m ${ui.sensGlisse === 'vers' ? 'le long du bord (le bord raccourcit)' : 'dans le prolongement du bord'}`;
      nouveau = glisserSommetLeLong(
        s.etat,
        ui.selSommet,
        ui.limiteGlisse,
        d,
        ui.sensGlisse === 'vers',
      );
    } else if (
      ui.mode === 'simplifier' &&
      ui.parcelleCourante !== null &&
      apercuSimplification(s)
    ) {
      const r = apercuSimplification(s)!;
      const avant = r.bilan.reduce((n, b) => n + b.avant, 0);
      const apres = r.bilan.reduce((n, b) => n + b.apres, 0);
      quoi = `${s.td.parcelles[ui.parcelleCourante]!.nom}${ui.porteeSimplif === 'bord' ? ' (un bord)' : ''} simplifiée (tolérance ${enCm(ui.tolerance)}) : ${avant} → ${apres} points`;
      nouveau = r.etat;
    } else if (ui.mode === 'guidage' && apercuGuidages(s).length > 0) {
      const gs = apercuGuidages(s);
      const cote = `${enMetres(Math.abs(d))} m ${ui.guidageInterieur ? 'à l’intérieur' : 'à l’extérieur'}`;
      const base = baseNomLignes();
      const touchees = new Set(gs.map((g) => g.parcelle));
      const nom = s.td.parcelles[gs[0]!.parcelle]!.nom;
      quoi =
        ui.porteeGuidage === 'bord'
          ? `Ligne ${gs[0]!.type === 'ab' ? 'AB' : 'courbe'} « ${gs[0]!.nom} » ajoutée à ${nom} (${cote})`
          : ui.porteeGuidage === 'parcelle'
            ? `${gs.length} lignes « ${base} » sur ${nom} (${cote})`
            : `${gs.length} lignes « ${base} » sur ${touchees.size} parcelles (${cote})`;
      // Toute une parcelle : le jeu de même nom déjà créé sur la parcelle est remplacé.
      nouveau = ajouterGuidages(s.etat, gs, ui.porteeGuidage === 'bord' ? null : base);
    } else {
      return;
    }
    if (nouveau === s.etat) return;
    const avant = s.etat;
    const note = enregistrerModification(s, nouveau, quoi);
    if (ui.mode === 'limite' && ui.selLimite) {
      // La limite reste sélectionnée (avec son sens) pour pouvoir appliquer plusieurs fois.
      const retrouvee = retrouverLimite(avant, s.etat, ui.selLimite);
      const sens = ui.sensLimite;
      effacerSelection();
      if (retrouvee) {
        ui.selLimite = retrouvee;
        ui.sensLimite = sens;
      }
    } else if (ui.mode === 'sommet' || ui.mode === 'guidage') {
      // Le sommet ne change pas d'indice en glissant : on garde sommet, bord et sens. Le bord d'une
      // ligne de guidage reste choisi pour en tracer une autre (autre distance, autre type).
      ui.exportPrepare = null;
    } else {
      effacerSelection();
      // Une simplification se fait une fois : on revient au décalage de limite pour les retouches.
      if (ui.mode === 'simplifier') ui.mode = 'limite';
    }
    ui.message = { texte: `${quoi}${note}.`, erreur: false };
  } catch (e) {
    ui.message = {
      texte: e instanceof ErreurEdition ? e.message : `Erreur : ${(e as Error).message}`,
      erreur: true,
    };
  }
  afficher();
}

export function panneauSimplification(s: Session): HTMLElement {
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
          class: ui.porteeSimplif === v ? 'actif' : '',
          onclick: () => {
            ui.porteeSimplif = v;
            ui.bordDebut = null;
            ui.bord = null;
            afficher();
          },
        },
        t,
      ),
    ),
  );
  if (ui.porteeSimplif === 'bord' && !ui.bord) {
    return el(
      'div',
      { class: 'info' },
      portee,
      el(
        'div',
        { class: 'sens' },
        ui.bordDebut ? 'Touche le dernier sommet du bord.' : 'Touche le premier sommet du bord.',
      ),
    );
  }
  if (ui.parcelleCourante === null) {
    return el(
      'div',
      { class: 'info' },
      portee,
      el('div', { class: 'doux' }, 'Touche une parcelle.'),
    );
  }
  const p = ui.parcelleCourante;
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
    ui.bord &&
      el(
        'div',
        { class: 'rangee' },
        el('span', { class: 'doux' }, `Bord : ${sommetsDuBord(s.etat, ui.bord).length} points`),
        el(
          'button',
          {
            onclick: () => {
              if (ui.bord) ui.bord = { ...ui.bord, aRebours: !ui.bord.aRebours };
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
            class: t === ui.tolerance ? 'actif' : '',
            onclick: () => {
              ui.tolerance = t;
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
        { class: ecartOrigine > ui.tolerance ? 'erreur' : 'doux' },
        `Écart avec l’origine : ${enCm(ecartOrigine)}` +
          (ecartOrigine > ui.tolerance ? ' (déjà simplifiée ?)' : ''),
      ),
  );
}

export function panneauSelection(s: Session): HTMLElement {
  if (ui.mode === 'limite') {
    if (!ui.selLimite) return el('div', { class: 'info doux' }, 'Touche une limite.');
    const ref = ui.selLimite;
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
      ui.sensLimite
        ? el('div', { class: 'sens' }, effetsLimite(s, ref)[ui.sensLimite])
        : el('div', { class: 'sens' }, 'Choisis une flèche.'),
    );
  }
  const boutonAjout = el(
    'button',
    {
      class: ui.ajoutEnCours ? 'actif' : '',
      onclick: () => {
        const actif = !ui.ajoutEnCours;
        effacerSelection();
        ui.ajoutEnCours = actif;
        ui.message = actif ? { texte: 'Touche une limite.', erreur: false } : null;
        afficher();
      },
    },
    ui.ajoutEnCours ? 'Annuler l’ajout' : 'Ajouter un point',
  );
  if (!ui.selSommet) {
    return el(
      'div',
      { class: 'info' },
      el('div', { class: 'doux' }, ui.ajoutEnCours ? 'Touche une limite.' : 'Touche un sommet.'),
      el('div', { class: 'rangee' }, boutonAjout),
    );
  }
  const ref = ui.selSommet;
  const autres = new Set(
    sommetsEn(s.etat, latLon(s.etat.anneaux[ref.anneau]!.sommets[ref.sommet]!))
      .map((r) => nomParcelle(s, r.anneau))
      .filter((n) => n !== nomParcelle(s, ref.anneau)),
  );
  const glisse = !ui.limiteGlisse
    ? null
    : !ui.sensGlisse
      ? 'Choisis une flèche.'
      : ui.sensGlisse === 'vers'
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
export function raccourcis(): HTMLElement {
  return el(
    'div',
    { class: 'raccourcis' },
    ...[-1, -0.5, -0.1, 0.1, 0.5, 1].map((v) =>
      el(
        'button',
        {
          onclick: () => {
            ui.saisie = enMetres(Math.max(0, metres() + v));
            afficher();
          },
        },
        v > 0 ? `+${enMetres(v)}` : `−${enMetres(-v)}`,
      ),
    ),
  );
}
