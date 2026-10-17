// Onglet Modifier : limite, point, simplification, collage, Appliquer.

import { type BilanCollage, collerBord, modeleLePlusProche } from '../edition/collage';
import { remplacerLignesOutil } from '../edition/optimisation';
import { type Etat, latLon, limitesJumelles, parcelleContenant, sommetsEn } from '../edition/etat';
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
  supprimerParcelle,
  supprimerZone,
} from '../edition/operations';
import { blocsDeParcelle } from '../isoxml/ecriture';
import { planLocal } from '../geometrie/plan';
import { ecartMaximal } from '../geometrie/simplification';
import { el } from '../ui/dom';
import { apercuCoupe, couperParcelle, type Coupe } from '../edition/coupe';
import { ajouterZoneExclue } from '../edition/zones-exclues';
import { surfaceZone, texteSurface } from '../suivi/zones';
import { commencerTrace } from './trace-zone';
import { icone } from '../ui/icones';
import { type Session, TOLERANCES, ui } from './etat';
import { apercuGuidages, baseNomLignes, optimisationCourante, outilCourant } from './guidage';
import { afficher, croixDansLeVolet } from './mise-en-page';
import {
  arreterOutilsCarte,
  effacerSelection,
  enMetres,
  enregistrerModification,
  metres,
  modifier,
} from './travail';
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
        'aria-label': 'Placer au doigt',
        onclick: () => {
          const actif = !ui.placerAuDoigt;
          arreterOutilsCarte();
          ui.placerAuDoigt = actif;
          afficher();
        },
      },
      icone('doigt', 24),
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

/**
 * Aperçu du collage du bord choisi sur la parcelle modèle (rien n'est encore modifié), ou le
 * message qui explique pourquoi c'est impossible.
 */
export function apercuCollage(
  s: Session,
): { etat: Etat; bilan: BilanCollage } | { erreur: string } | null {
  if (ui.mode !== 'coller' || !ui.bord || ui.modele === null) return null;
  try {
    return collerBord(s.etat, ui.bord, ui.modele);
  } catch (e) {
    return { erreur: (e as Error).message };
  }
}

export const enCm = (m: number) => `${Math.round(m * 100)} cm`;
/** Écart lisible : en centimètres sous 1 m, en mètres au-delà. */
const ecartLisible = (m: number) => (m < 1 ? enCm(m) : `${enMetres(m)} m`);

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
    } else if (ui.mode === 'coller' && ui.bord && ui.modele !== null) {
      const r = apercuCollage(s);
      if (!r || 'erreur' in r) throw new ErreurEdition(r?.erreur ?? 'Rien à coller.');
      quoi = `Bord de ${nomParcelle(s, ui.bord.anneau)} collé sur ${nomParcelle(s, ui.modele)} (écart max ${ecartLisible(r.bilan.ecartMax)}, ${r.bilan.avant} → ${r.bilan.apres} points)`;
      nouveau = r.etat;
    } else if (ui.mode === 'couper' && ui.coupe) {
      const r = apercuCoupeCourante(s);
      if (!r || 'erreur' in r) throw new ErreurEdition(r?.erreur ?? 'Tape d’abord une distance.');
      const { coupe, garder } = r;
      const p = ui.coupe.parcelle;
      const ancien = s.td.parcelles[p]!.nom;
      const nom = prompt(
        `Nom de la nouvelle parcelle (le morceau ${garder === 'bord' ? 'de l’autre côté' : 'côté bord'}, ${haTexte(garder === 'bord' ? coupe.surfaceAutre : coupe.surfaceBord)})`,
        `${ancien} B`,
      );
      if (nom === null) return;
      const { etat: e, nouvelle } = couperParcelle(
        s.td,
        s.etat,
        p,
        ui.coupe.segment,
        coupe.distance,
        garder,
        nom,
      );
      quoi = `${ancien} coupée à ${enMetres(coupe.distance)} m du côté choisi : ${s.td.parcelles[nouvelle]!.nom} créée`;
      nouveau = e;
    } else if (ui.mode === 'guidage' && apercuGuidages(s).length > 0) {
      const gs = apercuGuidages(s);
      const cote = `${enMetres(Math.abs(d))} m ${ui.guidageInterieur ? 'à l’intérieur' : 'à l’extérieur'}`;
      const optim = ui.porteeGuidage === 'optimiser';
      const base = optim ? outilCourant()!.nom : baseNomLignes();
      const touchees = new Set(gs.map((g) => g.parcelle));
      const nom = s.td.parcelles[gs[0]!.parcelle]!.nom;
      const prop = optim ? optimisationCourante(s)?.proposition : null;
      quoi = prop
        ? `« ${gs[0]!.nom} » optimisée sur ${nom} (cap ${Math.round(prop.cap)}°, ${prop.demiTours} demi-tours)` +
          (gs.length > 1 ? ` et ${gs.length - 1} ligne(s) de fourrière` : '')
        : ui.porteeGuidage === 'bord'
          ? `Ligne ${gs[0]!.type === 'ab' ? 'AB' : 'courbe'} « ${gs[0]!.nom} » ajoutée à ${nom} (${cote})`
          : ui.porteeGuidage === 'parcelle'
            ? `${gs.length} lignes « ${base} » sur ${nom} (${cote})`
            : `${gs.length} lignes « ${base} » sur ${touchees.size} parcelles (${cote})`;
      // Toute une parcelle : le jeu de même nom déjà créé sur la parcelle est remplacé.
      nouveau = optim
        ? remplacerLignesOutil(s.etat, gs[0]!.parcelle, outilCourant()!, gs)
        : ajouterGuidages(s.etat, gs, ui.porteeGuidage === 'bord' ? null : base);
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
      // Zone exclue créée dans l'éditeur : pas de contour d'origine.
      if (a.parcelle !== p || !s.initial.anneaux[i]) return [];
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

/**
 * Mode Limite : décaler la limite touchée, ou coller un bord sur la parcelle voisine. Une limite
 * déjà touchée devient le bord à coller (on peut ensuite l'étendre en touchant ses deux bouts).
 */
export function choixActionLimite(): HTMLElement {
  return el(
    'div',
    { class: 'rangee' },
    ...(
      [
        ['limite', 'Décaler'],
        ['coller', 'Coller au voisin'],
      ] as const
    ).map(([v, t]) =>
      el(
        'button',
        {
          class: ui.mode === v ? 'actif' : '',
          onclick: () => {
            if (ui.mode === v) return;
            const limite = ui.selLimite;
            effacerSelection();
            arreterOutilsCarte();
            ui.mode = v;
            ui.actionLimite = v;
            if (v === 'coller' && limite && ui.session) {
              const n = ui.session.etat.anneaux[limite.anneau]!.sommets.length;
              ui.bordDebut = { anneau: limite.anneau, sommet: limite.debut };
              ui.bord = {
                anneau: limite.anneau,
                debut: limite.debut,
                fin: (limite.debut + 1) % n,
                aRebours: false,
              };
              ui.modele = modeleLePlusProche(ui.session.etat, ui.bord);
            }
            afficher();
          },
        },
        t,
      ),
    ),
  );
}

export function panneauCollage(s: Session): HTMLElement {
  if (!ui.bord) {
    return el(
      'div',
      { class: 'info' },
      el('strong', {}, 'Coller un bord sur la parcelle voisine'),
      el(
        'div',
        { class: 'sens' },
        ui.bordDebut
          ? 'Touche le dernier sommet du bord.'
          : 'Touche le premier sommet du bord qui doit bouger.',
      ),
    );
  }
  const bord = ui.bord;
  const x = nomParcelle(s, bord.anneau);
  const lignes: (HTMLElement | false)[] = [
    el('strong', {}, `Coller un bord de ${x}`),
    el(
      'div',
      { class: 'rangee' },
      el('span', { class: 'doux' }, `Bord : ${sommetsDuBord(s.etat, bord).length} points`),
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
  ];
  if (ui.modele === null) {
    lignes.push(el('div', { class: 'sens' }, 'Touche la parcelle voisine qui sert de modèle.'));
    return el('div', { class: 'info' }, ...lignes);
  }
  const y = nomParcelle(s, ui.modele);
  lignes.push(el('div', {}, `Modèle : ${y} (ne bouge pas)`));
  const r = apercuCollage(s);
  if (r && 'erreur' in r) {
    lignes.push(el('div', { class: 'erreur' }, r.erreur));
  } else if (r) {
    const p = s.etat.anneaux[bord.anneau]!.parcelle;
    const surface = Math.round(
      (nouvelleSurface(s.td, r.etat, p) ?? 0) - (nouvelleSurface(s.td, s.etat, p) ?? 0),
    );
    lignes.push(
      el(
        'div',
        { class: 'sens' },
        `${r.bilan.avant} → ${r.bilan.apres} points · écart max ${ecartLisible(r.bilan.ecartMax)} · surface ${surface >= 0 ? '+' : ''}${surface} m²`,
      ),
      r.bilan.ajoutsModele > 0 &&
        el(
          'div',
          { class: 'doux' },
          `${r.bilan.ajoutsModele === 1 ? '1 point ajouté' : `${r.bilan.ajoutsModele} points ajoutés`} sur la limite de ${y}, sans changer sa surface.`,
        ),
    );
  }
  lignes.push(el('div', { class: 'doux' }, 'Touche une autre parcelle pour changer de modèle.'));
  return el('div', { class: 'info' }, ...lignes);
}

/** Zone exclue (trou dans la parcelle) : la retirer, la parcelle reprend sa surface. */
function boutonRetirerZone(s: Session, anneau: number): HTMLElement {
  const nom = nomParcelle(s, anneau);
  return el(
    'div',
    { class: 'rangee' },
    el(
      'button',
      {
        class: 'danger',
        onclick: () =>
          modifier(
            () => supprimerZone(s.etat, anneau),
            `Zone exclue de ${nom} retirée (la parcelle la reprend)`,
            false,
          ),
      },
      'Supprimer la zone exclue',
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
    // Les deux sens, en clair, sur deux cartes (les flèches de la carte font la même chose).
    const effets = effetsLimite(s, ref);
    const carteSens = (sens: 'exterieur' | 'interieur') => {
      const m = /^(.*) \((.*)\)$/.exec(effets[sens]);
      const titreSens = m ? m[1]! : effets[sens];
      return el(
        'button',
        {
          class: `carte-sens${ui.sensLimite === sens ? ' choisie' : ''}`,
          onclick: () => {
            ui.sensLimite = sens;
            afficher();
          },
        },
        el('span', { class: 'carte-sens-titre' }, titreSens[0]!.toUpperCase() + titreSens.slice(1)),
        m && el('span', { class: 'carte-sens-effet' }, m[2]!),
      );
    };
    return el(
      'div',
      { class: 'selection-limite' },
      el(
        'div',
        { class: 'entete-selection' },
        el('strong', {}, titre),
        el('span', { class: 'doux' }, `${longueur(s, ref).toFixed(1).replace('.', ',')} m`),
      ),
      el('div', { class: 'cartes-sens' }, carteSens('exterieur'), carteSens('interieur')),
      type === 2 && boutonRetirerZone(s, ref.anneau),
    );
  }
  const boutonAjout = el(
    'button',
    {
      class: ui.ajoutEnCours ? 'actif' : '',
      onclick: () => {
        const actif = !ui.ajoutEnCours;
        effacerSelection();
        arreterOutilsCarte();
        ui.ajoutEnCours = actif;
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
  const v = s.etat.anneaux[ref.anneau]!.sommets[ref.sommet]!;
  // À droite de la croix : glisser le long d'un bord (deux cartes, comme les flèches de la carte).
  const carteGlisse = (sens: 'vers' | 'oppose') =>
    el(
      'button',
      {
        class: `carte-sens${ui.sensGlisse === sens ? ' choisie' : ''}`,
        onclick: () => {
          ui.sensGlisse = sens;
          afficher();
        },
      },
      el(
        'span',
        { class: 'carte-sens-titre' },
        sens === 'vers' ? 'Vers l’autre bout' : 'Dans le prolongement',
      ),
      el(
        'span',
        { class: 'carte-sens-effet' },
        sens === 'vers' ? 'le bord raccourcit' : 'le bord s’allonge',
      ),
    );
  const coordonnees = el(
    'div',
    { class: 'doux coordonnees' },
    `${v.lat.toFixed(7)}, ${v.lon.toFixed(7)}`,
  );
  const glisse = ui.limiteGlisse
    ? el(
        'div',
        { class: 'glisse-point' },
        coordonnees,
        el('div', { class: 'doux' }, 'Le long du bord :'),
        carteGlisse('vers'),
        carteGlisse('oppose'),
      )
    : el(
        'div',
        { class: 'glisse-point' },
        coordonnees,
        el(
          'div',
          { class: 'doux' },
          'Pour le faire glisser le long d’un bord, touche ce bord sur la carte.',
        ),
      );
  return el(
    'div',
    { class: 'selection-limite' },
    el(
      'div',
      { class: 'entete-selection' },
      el(
        'span',
        {},
        el('strong', {}, `Sommet de ${nomParcelle(s, ref.anneau)}`),
        autres.size > 0
          ? el('span', { class: 'doux' }, ` · commun avec ${[...autres].join(', ')}`)
          : '',
      ),
    ),
    // La croix est ici quand le volet est ouvert ; sinon elle reste sur la carte.
    croixDansLeVolet()
      ? el('div', { class: 'commandes-point' }, commandesSommet(), glisse)
      : glisse,
    el('div', { class: 'rangee' }, el('button', { onclick: supprimer }, 'Supprimer'), boutonAjout),
    s.etat.anneaux[ref.anneau]!.type === 2 && boutonRetirerZone(s, ref.anneau),
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

const haTexte = (m2: number) => `${(m2 / 10000).toFixed(2).replace('.', ',')} ha`;

/** Aperçu de la coupe en cours (côté touché, distance ou surface tapée), ou son erreur. */
export function apercuCoupeCourante(
  s: Session,
): { coupe: Coupe; garder: 'bord' | 'autre' } | { erreur: string } | null {
  const c = ui.coupe;
  if (ui.mode !== 'couper' || !c || c.parcelle !== ui.parcelleCourante || metres() <= 0)
    return null;
  try {
    const coupe = apercuCoupe(
      s.etat,
      c.parcelle,
      c.segment,
      ui.coupeMesure === 'distance' ? { distance: metres() } : { surface: metres() * 10000 },
    );
    const garder = ui.coupeGarder ?? (coupe.surfaceBord > coupe.surfaceAutre ? 'bord' : 'autre');
    return { coupe, garder };
  } catch (e) {
    return { erreur: (e as Error).message };
  }
}

/** Mode Couper : le côté touché, la distance ou la surface, et le morceau qui garde la parcelle. */
export function panneauCoupe(s: Session): HTMLElement {
  const c = ui.coupe;
  if (!c || c.parcelle !== ui.parcelleCourante) {
    return el(
      'div',
      { class: 'info' },
      el('strong', {}, 'Couper une parcelle'),
      el('div', { class: 'sens' }, 'Touche le côté de la parcelle parallèlement auquel couper.'),
    );
  }
  const nom = s.td.parcelles[c.parcelle]!.nom;
  const r = apercuCoupeCourante(s);
  const cartes = <T extends string>(
    valeurs: [T, string, string][],
    actuel: T,
    changer: (v: T) => void,
  ) =>
    el(
      'div',
      { class: 'cartes-sens' },
      ...valeurs.map(([v, titre, effet]) =>
        el(
          'button',
          {
            class: `carte-sens${v === actuel ? ' choisie' : ''}`,
            onclick: () => {
              changer(v);
              afficher();
            },
          },
          el('span', { class: 'carte-sens-titre' }, titre),
          el('span', { class: 'carte-sens-effet' }, effet),
        ),
      ),
    );
  return el(
    'div',
    { class: 'info' },
    el('strong', {}, `Couper ${nom} parallèlement au côté violet`),
    cartes(
      [
        ['distance', 'À une distance', 'en m du côté'],
        ['surface', 'Pour une surface', 'en ha, côté bord'],
      ],
      ui.coupeMesure,
      (v) => {
        ui.coupeMesure = v;
        ui.saisie = '';
      },
    ),
    !r &&
      el(
        'div',
        { class: 'sens' },
        ui.coupeMesure === 'distance'
          ? 'Tape la distance (m) dans la case du bas.'
          : 'Tape la surface côté bord (ha) dans la case du bas.',
      ),
    r && 'erreur' in r && el('div', { class: 'erreur' }, r.erreur),
    r &&
      'coupe' in r &&
      el(
        'div',
        { class: 'doux' },
        `Ligne de coupe à ${enMetres(r.coupe.distance)} m du côté · côté bord ${haTexte(r.coupe.surfaceBord)} · autre côté ${haTexte(r.coupe.surfaceAutre)}`,
      ),
    r &&
      'coupe' in r &&
      cartes(
        [
          ['bord', `${nom} garde le côté bord`, haTexte(r.coupe.surfaceBord)],
          ['autre', `${nom} garde l’autre côté`, haTexte(r.coupe.surfaceAutre)],
        ],
        r.garder,
        (v) => (ui.coupeGarder = v),
      ),
    r &&
      'coupe' in r &&
      el(
        'div',
        { class: 'doux' },
        'L’autre morceau devient une nouvelle parcelle (son nom est demandé). La ligne de coupe devient une limite commune.',
      ),
  );
}

/** Créer une parcelle : tracer son contour au doigt ou en en faisant le tour (GPS). */
export function cadreNouvelleParcelle(): HTMLElement | null {
  if (ui.selLimite || ui.selSommet) return null;
  const t = ui.traceZone?.pour === 'parcelle' ? ui.traceZone : null;
  return el(
    'div',
    { class: 'info' },
    el('strong', {}, 'Nouvelle parcelle'),
    el(
      'div',
      { class: 'doux' },
      'Trace son contour ; son nom est demandé à la fin. Ensuite, « Coller au voisin » pour la caler sur une voisine.',
    ),
    el(
      'div',
      { class: 'rangee' },
      el(
        'button',
        {
          class: t?.mode === 'points' ? 'actif' : '',
          onclick: () => commencerTrace('points', 'parcelle'),
        },
        'Dessiner au doigt',
      ),
      el(
        'button',
        {
          class: t?.mode === 'gps' ? 'actif' : '',
          onclick: () => commencerTrace('gps', 'parcelle'),
        },
        'Tracer en marchant',
      ),
    ),
  );
}

/**
 * Créer une zone exclue dans la parcelle choisie : la dessiner au doigt, en faire le tour à pied,
 * ou reprendre la zone dessinée d'une note de la parcelle (mare, bosquet…).
 */
export function cadreZoneExclue(s: Session): HTMLElement | null {
  const i = ui.parcelleCourante;
  if (i === null || ui.selLimite || ui.selSommet) return null;
  const p = s.td.parcelles[i]!;
  const notes = (ui.suivi.notes ?? []).filter(
    (n) => !n.supprimee && n.zone && n.position && parcelleContenant(s.etat, n.position) === i,
  );
  const t = ui.traceZone?.pour === 'exclue' ? ui.traceZone : null;
  return el(
    'div',
    { class: 'info' },
    el('strong', {}, `Ajouter une zone exclue à ${p.nom}`),
    el(
      'div',
      { class: 'doux' },
      'Trou dans la parcelle (mare, bosquet, poteau) : retiré de la surface, passages coupés autour.',
    ),
    el(
      'div',
      { class: 'rangee' },
      el(
        'button',
        {
          class: t?.mode === 'points' ? 'actif' : '',
          onclick: () => commencerTrace('points', 'exclue', i),
        },
        'Dessiner au doigt',
      ),
      el(
        'button',
        {
          class: t?.mode === 'gps' ? 'actif' : '',
          onclick: () => commencerTrace('gps', 'exclue', i),
        },
        'Tracer en marchant',
      ),
    ),
    ...notes.map((n) =>
      el(
        'div',
        { class: 'rangee' },
        el(
          'button',
          {
            onclick: () =>
              modifier(
                () => ajouterZoneExclue(s.etat, i, n.zone!),
                `Zone « ${n.type || n.texte} » (${texteSurface(surfaceZone(n.zone!))}) exclue de ${p.nom}`,
                false,
              ),
          },
          `Exclure la zone « ${n.type || n.texte || 'note'} » (${texteSurface(surfaceZone(n.zone!))})`,
        ),
      ),
    ),
  );
}

/** Bas de l'onglet Modifier : retirer toute la parcelle choisie du fichier (avec ses tâches). */
export function boutonSupprimerParcelle(s: Session): HTMLElement | null {
  const i = ui.parcelleCourante;
  if (i === null) return null;
  const p = s.td.parcelles[i]!;
  return el(
    'div',
    { class: 'rangee', style: 'justify-content:flex-end' },
    el(
      'button',
      {
        class: 'petit danger',
        onclick: () => {
          const n = blocsDeParcelle(s.td.texte, p.id).taches.length;
          if (
            !confirm(
              `Retirer toute la parcelle ${p.nom} du fichier exporté${n > 0 ? `, avec ses ${n} tâche(s)` : ''} ?\n\n` +
                'Pour enlever seulement le trou d’un poteau : touche un point du trou, puis « Supprimer la zone exclue ».\n' +
                'Elle reste dans la console et dans ton export d’origine. « Annuler » ou « Remettre » (onglet Export) la fait revenir.',
            )
          ) {
            return;
          }
          modifier(
            () => supprimerParcelle(ui.session!.etat, i),
            `${p.nom} retirée du fichier${n > 0 ? ` (avec ${n} tâche(s))` : ''}`,
            false,
          );
          ui.parcelleCourante = null;
          afficher();
        },
      },
      `Supprimer la parcelle ${p.nom}`,
    ),
  );
}
