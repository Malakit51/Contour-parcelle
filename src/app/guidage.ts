// Lignes de guidage : panneau, aperçu, jeux masqués.

import { type Guidage } from '../edition/etat';
import {
  aControler,
  COTE_MIN_M,
  jeux,
  lignesDeParcelle,
  ligneSurBord,
  retirerGuidages,
  type ReglagesGuidage,
} from '../edition/guidages';
import { sommetsDuBord } from '../edition/operations';
import { type LatLon } from '../geometrie/plan';
import { el } from '../ui/dom';
import { CLE_JEUX_MASQUES, type Session, SEUILS_COINS, ui } from './etat';
import { afficher } from './mise-en-page';
import { ecrireStockage, lireStockage } from './stockage';
import { metres, modifier } from './travail';
import { cadrerParcelle } from './vue';

// ---------- Lignes de guidage : masquer ou afficher un jeu ----------
//
// Seulement à l'écran : une ligne masquée reste dans le travail et dans l'export.

export function changerMasques(masques: Set<string>): void {
  ui.jeuxMasques = masques;
  ecrireStockage(CLE_JEUX_MASQUES, masques.size ? JSON.stringify([...masques]) : null);
  afficher();
}

/** Bouton « Lignes » en haut à droite de la carte, avec la liste des jeux à cocher. */
export function commandesLignes(s: Session): HTMLElement | null {
  const noms = jeux(s.etat.guidages ?? []);
  if (noms.length === 0) return null;
  const visibles = noms.filter((n) => !ui.jeuxMasques.has(n)).length;
  const bouton = el(
    'button',
    {
      class: `bouton-lignes${visibles < noms.length ? ' masquees' : ''}`,
      onclick: () => {
        ui.menuLignesOuvert = !ui.menuLignesOuvert;
        afficher();
      },
    },
    `Lignes ${visibles}/${noms.length}`,
  );
  if (!ui.menuLignesOuvert) return el('div', {}, bouton);
  return el(
    'div',
    {},
    bouton,
    el(
      'div',
      { class: 'menu-lignes' },
      ...noms.map((n) =>
        el(
          'button',
          {
            class: ui.jeuxMasques.has(n) ? '' : 'coche',
            onclick: () => {
              const m = new Set(ui.jeuxMasques);
              if (m.has(n)) m.delete(n);
              else m.add(n);
              changerMasques(m);
            },
          },
          `${ui.jeuxMasques.has(n) ? '☐' : '☑'} ${n}`,
        ),
      ),
      el(
        'button',
        {
          onclick: () => changerMasques(visibles > 0 ? new Set(noms) : new Set()),
        },
        visibles > 0 ? 'Tout masquer' : 'Tout afficher',
      ),
    ),
  );
}

// Nom des lignes (outil, largeur…) : « Semoir 4 m » donne « Semoir 4 m 1 », « Semoir 4 m 2 »…
// Retenu sur l'appareil. Case créée une seule fois (la recréer fermerait le clavier).
export const CLE_NOM_LIGNES = 'contour-parcelle/nom-guidage';
export const champNomLignes = el('input', {
  type: 'text',
  class: 'champ-nom',
  enterkeyhint: 'done',
  autocomplete: 'off',
  'aria-label': 'Nom des lignes',
});
champNomLignes.value = lireStockage(CLE_NOM_LIGNES) ?? 'Guidage';
champNomLignes.addEventListener('change', () => {
  ecrireStockage(CLE_NOM_LIGNES, champNomLignes.value.trim() || null);
});
champNomLignes.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') champNomLignes.blur();
});
export const baseNomLignes = () => champNomLignes.value.trim() || 'Guidage';

/** Vrai si la ligne fait partie du jeu « base » (« base 1 », « base 2 »…). */
/** Réglages des lignes de guidage tels que choisis dans le panneau. */
export const reglagesGuidage = (): ReglagesGuidage => ({
  distance: Math.abs(metres()),
  interieur: ui.guidageInterieur,
  seuil: ui.seuilCoins,
  base: baseNomLignes(),
});

/** Lignes que donnerait « Appliquer » : une sur le bord choisi, ou une par côté de la parcelle. */
export function apercuGuidages(s: Session): Guidage[] {
  if (ui.mode !== 'guidage') return [];
  if (ui.porteeGuidage === 'bord') {
    const g = apercuGuidage(s);
    return g ? [g] : [];
  }
  if (ui.porteeGuidage === 'parcelle') return coinsGuidage(s)?.lignes ?? [];
  return s.td.parcelles.flatMap((_, p) => lignesParcelle(s, p)?.lignes ?? []);
}

/** Parcelles à contrôler après « Toutes les parcelles » : pas exactement 4 coins, ou un petit côté sans ligne. */
export function parcellesAControler(s: Session): number[] {
  return s.td.parcelles
    .map((_, p) => ({ p, r: lignesParcelle(s, p) }))
    .filter(({ r }) => r && aControler(r))
    .map(({ p }) => p)
    .sort((a, b) =>
      s.td.parcelles[a]!.nom.localeCompare(s.td.parcelles[b]!.nom, 'fr', { numeric: true }),
    );
}

/**
 * Toute la parcelle courante : coins du contour extérieur (seuil réglé) et une ligne par côté
 * d'au moins COTE_MIN_M mètres, droite AB si le côté est droit, sinon courbe.
 */
export function coinsGuidage(
  s: Session,
): { coins: LatLon[]; lignes: Guidage[]; ignores: number } | null {
  if (ui.mode !== 'guidage' || ui.porteeGuidage !== 'parcelle' || ui.parcelleCourante === null)
    return null;
  return lignesParcelle(s, ui.parcelleCourante);
}

export const lignesParcelle = (s: Session, p: number) =>
  lignesDeParcelle(s.etat, p, reglagesGuidage());

/** Ligne de guidage que donnerait « Appliquer » sur le bord choisi (rien n'est encore ajouté). */
export function apercuGuidage(s: Session): Guidage | null {
  if (ui.mode !== 'guidage' || !ui.bord) return null;
  return ligneSurBord(s.etat, ui.bord, ui.typeGuidage, reglagesGuidage());
}

/** Toutes les parcelles : nombre de lignes et parcelles à contrôler (un appui zoome dessus). */
export function panneauToutes(s: Session): HTMLElement {
  const lignes = apercuGuidages(s);
  const parcelles = new Set(lignes.map((g) => g.parcelle)).size;
  const aControler = parcellesAControler(s);
  const toutes = s.etat.guidages ?? [];
  return el(
    'div',
    {},
    el(
      'div',
      { class: 'doux' },
      `${lignes.length} lignes « ${baseNomLignes()} » sur ${parcelles} parcelles (celles de même nom sont remplacées).`,
    ),
    toutes.length > 0 &&
      el(
        'button',
        {
          onclick: () =>
            modifier(
              () => retirerGuidages(s.etat, null),
              `${toutes.length} lignes de guidage supprimées (toutes les parcelles)`,
              true,
            ),
        },
        `Supprimer toutes les lignes (${toutes.length})`,
      ),
    aControler.length > 0 &&
      el(
        'div',
        { class: 'rangee' },
        el('span', { class: 'sens' }, 'À contrôler :'),
        ...aControler.map((p) =>
          el(
            'button',
            {
              class: 'petit',
              onclick: () => {
                ui.porteeGuidage = 'parcelle';
                ui.parcelleCourante = p;
                afficher();
                cadrerParcelle(p);
              },
            },
            s.td.parcelles[p]!.nom,
          ),
        ),
      ),
  );
}

export function panneauGuidage(s: Session): HTMLElement {
  // Portée : barre groupée, comme les modes de l'onglet Modifier.
  const portee = el(
    'div',
    { class: 'modes' },
    ...(
      [
        ['bord', 'Un bord'],
        ['parcelle', 'Parcelle'],
        ['toutes', 'Toutes'],
      ] as const
    ).map(([v, t]) =>
      el(
        'button',
        {
          class: ui.porteeGuidage === v ? 'principal' : '',
          onclick: () => {
            ui.porteeGuidage = v;
            ui.bordDebut = null;
            ui.bord = null;
            afficher();
          },
        },
        t,
      ),
    ),
  );
  // Deux choix côte à côte, en cartes (titre + effet), comme le sens d'une limite.
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
  const parcelle = ui.porteeGuidage === 'parcelle' ? coinsGuidage(s) : null;
  // Ce qu'il reste à faire, ou ce qui sera créé.
  const etape =
    ui.porteeGuidage === 'bord'
      ? !ui.bord
        ? el(
            'div',
            { class: 'sens' },
            ui.bordDebut
              ? 'Touche le dernier sommet du bord.'
              : 'Touche le premier sommet du bord.',
          )
        : el(
            'div',
            { class: 'entete-selection' },
            el('strong', {}, `Bord de ${s.td.parcelles[ui.parcelleCourante!]!.nom}`),
            el(
              'span',
              { class: 'rangee', style: 'margin:0' },
              el('span', { class: 'doux' }, `${sommetsDuBord(s.etat, ui.bord).length} points`),
              el(
                'button',
                {
                  class: 'petit',
                  onclick: () => {
                    if (ui.bord) ui.bord = { ...ui.bord, aRebours: !ui.bord.aRebours };
                    afficher();
                  },
                },
                'Autre côté',
              ),
            ),
          )
      : ui.porteeGuidage === 'parcelle'
        ? !parcelle
          ? el('div', { class: 'sens' }, 'Touche une parcelle.')
          : el(
              'div',
              {},
              el(
                'div',
                { class: 'entete-selection' },
                el('strong', {}, `Lignes de ${s.td.parcelles[ui.parcelleCourante!]!.nom}`),
                el('span', { class: 'doux' }, `${parcelle.coins.length} coins`),
              ),
              el(
                'div',
                { class: 'doux' },
                `${parcelle.lignes.filter((g) => g.type === 'ab').length} droites AB, ${parcelle.lignes.filter((g) => g.type === 'courbe').length} courbes` +
                  (parcelle.ignores > 0
                    ? ` · ${parcelle.ignores} côté(s) de moins de ${COTE_MIN_M} m sans ligne`
                    : ''),
              ),
            )
        : null;
  const lignes = (s.etat.guidages ?? []).filter((g) => g.parcelle === ui.parcelleCourante);
  return el(
    'div',
    { class: 'panneau-guidage' },
    portee,
    etape,
    ui.porteeGuidage === 'bord' &&
      cartes(
        [
          ['ab', 'Droite AB', 'droite moyenne du bord'],
          ['courbe', 'Courbe', 'suit le bord'],
        ],
        ui.typeGuidage,
        (v) => (ui.typeGuidage = v),
      ),
    cartes(
      [
        ['int', 'Vers l’intérieur', 'ligne dans la parcelle'],
        ['ext', 'Vers l’extérieur', 'ligne hors de la parcelle'],
      ],
      ui.guidageInterieur ? 'int' : 'ext',
      (v) => (ui.guidageInterieur = v === 'int'),
    ),
    el(
      'div',
      { class: 'info reglages-guidage' },
      el('label', { class: 'rangee' }, el('span', { class: 'doux' }, 'Nom'), champNomLignes),
      ui.porteeGuidage !== 'bord' &&
        el(
          'div',
          { class: 'rangee' },
          el('span', { class: 'doux' }, 'Coins dès'),
          ...SEUILS_COINS.map((v) =>
            el(
              'button',
              {
                class: `petit${v === ui.seuilCoins ? ' actif' : ''}`,
                onclick: () => {
                  ui.seuilCoins = v;
                  afficher();
                },
              },
              `${v}°`,
            ),
          ),
        ),
    ),
    ui.porteeGuidage === 'toutes' && panneauToutes(s),
    lignes.length > 0 &&
      el(
        'div',
        { class: 'info' },
        el(
          'div',
          { class: 'entete-selection' },
          el('strong', {}, `Lignes déjà créées (${lignes.length})`),
          lignes.length > 1 &&
            el(
              'button',
              {
                class: 'petit',
                onclick: () =>
                  modifier(
                    () => retirerGuidages(s.etat, ui.parcelleCourante),
                    `${lignes.length} lignes de guidage de ${s.td.parcelles[ui.parcelleCourante!]!.nom} supprimées`,
                    true,
                  ),
              },
              'Tout supprimer',
            ),
        ),
        ...lignes.map((g) =>
          el(
            'div',
            { class: 'rangee' },
            el('span', { style: 'flex:1' }, g.nom),
            el('span', { class: 'doux' }, g.type === 'ab' ? 'droite' : 'courbe'),
            el(
              'button',
              {
                class: 'petit',
                onclick: () =>
                  modifier(
                    () => ({ ...s.etat, guidages: (s.etat.guidages ?? []).filter((x) => x !== g) }),
                    `Ligne « ${g.nom} » supprimée`,
                    true,
                  ),
              },
              'Supprimer',
            ),
          ),
        ),
      ),
  );
}
