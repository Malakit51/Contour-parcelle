// Lignes de guidage : panneau, aperçu, jeux masqués.

import { type Guidage } from '../edition/etat';
import {
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
import { CLE_JEUX_MASQUES, CLE_SEUIL_COINS, type Session, SEUILS_COINS, ui } from './etat';
import { afficher, ouvrirReglages } from './mise-en-page';
import { ecrireStockage } from './stockage';
import { enMetres, metres, modifier } from './travail';
import { carte } from './vue';
import {
  lignesOptimisees,
  lignesTourniere,
  optimiserParcelle,
  type Outil,
} from '../edition/optimisation';
import { CLE_OUTIL_CHOISI, CLE_OUTILS } from './etat';
import { type Proposition } from '../geometrie/passages';

// ---------- Lignes de guidage : masquer ou afficher un jeu ----------
//
// Seulement à l'écran : une ligne masquée reste dans le travail et dans l'export.

export function changerMasques(masques: Set<string>): void {
  ui.jeuxMasques = masques;
  ecrireStockage(CLE_JEUX_MASQUES, masques.size ? JSON.stringify([...masques]) : null);
  afficher();
}

/** Défilement de la liste des jeux, gardé quand le menu est redessiné (après chaque case). */
let defilementJeux = 0;

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
  // « Tout masquer » en tête, puis la liste, qui défile si elle dépasse le bas de la carte.
  const liste = el(
    'div',
    { class: 'liste-jeux' },
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
  );
  const menu = el(
    'div',
    { class: 'menu-lignes' },
    el(
      'div',
      { class: 'menu-lignes-tete' },
      el(
        'button',
        {
          class: 'tout',
          onclick: () => changerMasques(visibles > 0 ? new Set(noms) : new Set()),
        },
        visibles > 0 ? 'Tout masquer' : 'Tout afficher',
      ),
      el(
        'button',
        {
          class: 'fermer',
          'aria-label': 'Fermer la liste des lignes',
          onclick: () => {
            ui.menuLignesOuvert = false;
            afficher();
          },
        },
        '✕',
      ),
    ),
    liste,
  );
  // Le menu prend toute la hauteur visible de la carte, à gauche des boutons ronds (sous la barre
  // du haut et au-dessus du volet s'ils sont posés sur la carte).
  requestAnimationFrame(() => {
    const r = carte.element.getBoundingClientRect();
    const haut = r.top + carte.margeHaut + 8;
    menu.style.top = `${haut}px`;
    menu.style.right = `${window.innerWidth - r.right + 64}px`;
    menu.style.maxHeight = `${Math.max(120, r.bottom - carte.margeBas - 8 - haut)}px`;
    liste.scrollTop = defilementJeux;
  });
  // Une liste retirée de la page envoie encore un défilement à 0 : on l’ignore.
  liste.addEventListener('scroll', () => {
    if (liste.isConnected) defilementJeux = liste.scrollTop;
  });
  return el('div', {}, bouton, menu);
}

// Nom des lignes : celui de l'outil choisi (« Semoir 4 m » donne « Semoir 4 m 1 », « … 2 »…).
export const baseNomLignes = () => outilCourant()?.nom ?? 'Guidage';

/** Vrai si la ligne fait partie du jeu « base » (« base 1 », « base 2 »…). */
/**
 * Distance des lignes au bord : celle de la case du bas, sinon la moitié de la largeur de l'outil
 * choisi (le centre du tracteur au premier passage).
 */
export const distanceGuidage = () =>
  metres() > 0 ? Math.abs(metres()) : (outilCourant()?.largeur ?? 0) / 2;

/** Réglages des lignes de guidage tels que choisis dans le panneau. */
export const reglagesGuidage = (): ReglagesGuidage => ({
  distance: distanceGuidage(),
  interieur: true,
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
  if (ui.porteeGuidage === 'optimiser') {
    const o = optimisationCourante(s);
    const prop = o?.proposition;
    return o && prop
      ? lignesOptimisees(
          s.etat,
          o.parcelle,
          prop,
          o.optimisation.plan,
          o.outil,
          ui.lignesTourniere,
          ui.seuilCoins,
        )
      : [];
  }
  return s.td.parcelles.flatMap((_, p) => lignesParcelle(s, p)?.lignes ?? []);
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
  const toutes = s.etat.guidages ?? [];
  return el(
    'div',
    {},
    el(
      'div',
      { class: 'doux' },
      `${lignes.length} lignes « ${baseNomLignes()} » sur ${parcelles} parcelles.`,
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
  );
}

export function panneauGuidage(s: Session): HTMLElement {
  const outil = outilCourant();
  if (ui.saisie === '' && outil && ui.porteeGuidage !== 'optimiser')
    ui.saisie = enMetres(outil.largeur / 2);
  // Portée : barre groupée, comme les modes de l'onglet Modifier.
  const portee = el(
    'div',
    { class: 'modes' },
    ...(
      [
        ['bord', 'Un bord'],
        ['parcelle', 'Parcelle'],
        ['toutes', 'Toutes'],
        ['optimiser', 'Optimiser'],
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
          effet && el('span', { class: 'carte-sens-effet' }, effet),
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
  if (ui.porteeGuidage === 'optimiser') {
    return el(
      'div',
      { class: 'panneau-guidage' },
      portee,
      ...panneauOptimisation(s),
      cadreLignes(s),
    );
  }
  return el(
    'div',
    { class: 'panneau-guidage' },
    portee,
    etape,
    ui.porteeGuidage === 'bord' &&
      cartes(
        [
          ['ab', 'Droite AB', ''],
          ['courbe', 'Courbe', ''],
        ],
        ui.typeGuidage,
        (v) => (ui.typeGuidage = v),
      ),
    choixOutil(),
    ui.porteeGuidage === 'toutes' && panneauToutes(s),
    cadreLignes(s),
  );
}

// ---------- Optimisation : outils et propositions ----------

export function outilCourant(): Outil | null {
  return ui.outils[ui.outilChoisi] ?? ui.outils[0] ?? null;
}

function garderOutils(): void {
  ecrireStockage(CLE_OUTILS, ui.outils.length ? JSON.stringify(ui.outils) : null);
  ecrireStockage(CLE_OUTIL_CHOISI, String(ui.outilChoisi));
}

/** « 38 », « 0,5 » → nombre ; null si la saisie n'est pas un nombre positif ou nul. */
function lireMetres(texte: string | null): number | null {
  if (texte === null) return null;
  const v = Number(texte.trim().replace(',', '.'));
  return Number.isFinite(v) && v >= 0 ? v : null;
}

/** Nom, largeur et tournière demandés l'un après l'autre (rare : une fois par outil). */
function saisirOutil(depart?: Outil): Outil | null {
  const nom = prompt('Nom de l’outil (devient le nom des lignes)', depart?.nom ?? 'Pulvé')?.trim();
  if (!nom) return null;
  const largeur = lireMetres(
    prompt(
      'Largeur de travail en mètres, exactement comme sur la console',
      String(depart?.largeur ?? ''),
    ),
  );
  if (!largeur) {
    alert('Largeur non valable.');
    return null;
  }
  const tourniere = lireMetres(
    prompt(
      'Largeur de la tournière en mètres (0 sans tournière)',
      String(depart?.tourniere ?? largeur),
    ),
  );
  if (tourniere === null) {
    alert('Tournière non valable.');
    return null;
  }
  return { nom, largeur, tourniere };
}

const m = (v: number) => `${String(Math.round(v * 100) / 100).replace('.', ',')} m`;

/** Optimisation de la parcelle courante avec l'outil choisi et les obstacles notés dessus. */
export function optimisationCourante(s: Session): {
  parcelle: number;
  outil: Outil;
  optimisation: NonNullable<ReturnType<typeof optimiserParcelle>>;
  /** Proposition choisie : une des propositions, ou les passages du côté touché. */
  proposition: Proposition;
} | null {
  const outil = outilCourant();
  const p = ui.parcelleCourante;
  if (ui.mode !== 'guidage' || ui.porteeGuidage !== 'optimiser' || !outil || p === null)
    return null;
  // Tous les obstacles notés : optimiserParcelle garde ceux dont l'endroit est dans la parcelle
  // (une note peut avoir été rangée dans une voisine).
  const obstacles = (ui.suivi.notes ?? [])
    .filter((n) => n.obstacle && !n.supprimee && n.position)
    .map((n) => n.position!);
  const segment = ui.coteOptimise?.parcelle === p ? ui.coteOptimise.segment : null;
  const optimisation = optimiserParcelle(s.etat, p, obstacles, outil, ui.seuilCoins, segment);
  if (!optimisation) return null;
  const { propositions, manuelle } = optimisation;
  if (ui.propositionChoisie === -1 && !manuelle) ui.propositionChoisie = 0;
  if (ui.propositionChoisie >= propositions.length) ui.propositionChoisie = manuelle ? -1 : 0;
  const proposition = ui.propositionChoisie === -1 ? manuelle : propositions[ui.propositionChoisie];
  if (!proposition) return null;
  return { parcelle: p, outil, optimisation, proposition };
}

function texteObstacles(prop: Proposition): string {
  if (prop.obstacles.length === 0) return 'pas d’obstacle noté';
  return prop.obstacles
    .map((o, i) => {
      const nom = prop.obstacles.length > 1 ? `obstacle ${i + 1}` : 'obstacle';
      return o.dansTourniere
        ? `${nom} dans la tournière`
        : o.distanceBout < 0.05
          ? `${nom} en bout d’outil`
          : `${nom} à ${m(o.distanceBout)} du bout`;
    })
    .join(', ');
}

/** Choix de l'outil (nom des lignes ; largeur et tournière pour l'optimisation). */
function choixOutil(): HTMLElement {
  const outil = outilCourant();
  return el(
    'div',
    { class: 'info reglages-guidage' },
    ui.outils.length === 0
      ? el(
          'div',
          { class: 'rangee' },
          el('span', { class: 'sens', style: 'flex:1' }, 'Ajoute tes outils dans les réglages.'),
          el('button', { class: 'petit', onclick: ouvrirReglages }, 'Réglages'),
        )
      : el(
          'div',
          { class: 'rangee' },
          ...ui.outils.map((o, i) =>
            el(
              'button',
              {
                class: o === outil ? 'actif' : '',
                onclick: () => {
                  ui.outilChoisi = i;
                  ui.propositionChoisie = 0;
                  // Les lignes suivent la largeur de l'outil : à une demi-largeur du bord.
                  ui.saisie = enMetres(o.largeur / 2);
                  garderOutils();
                  afficher();
                },
              },
              o.nom,
            ),
          ),
        ),
    outil &&
      ui.porteeGuidage !== 'optimiser' &&
      el(
        'div',
        { class: 'doux' },
        `Largeur ${enMetres(outil.largeur)} m : lignes à ${enMetres(distanceGuidage())} m du bord` +
          (Math.abs(distanceGuidage() - outil.largeur / 2) < 0.001 ? ' (demi-largeur).' : '.'),
      ),
  );
}

/** Réglages : la liste des outils (nom, largeur, tournière), à ajouter, modifier ou retirer. */
export function cadreOutils(): HTMLElement {
  return el(
    'div',
    { class: 'info' },
    el('strong', {}, 'Outils'),
    ...ui.outils.map((o) =>
      el(
        'div',
        { class: 'rangee' },
        el(
          'span',
          { style: 'flex:1' },
          el('strong', {}, o.nom),
          el('span', { class: 'doux' }, ` · ${m(o.largeur)} · tournière ${m(o.tourniere)}`),
        ),
        el(
          'button',
          {
            class: 'petit',
            onclick: () => {
              const n = saisirOutil(o);
              if (!n) return;
              ui.outils = ui.outils.map((x) => (x === o ? n : x));
              garderOutils();
              afficher();
            },
          },
          'Modifier',
        ),
        el(
          'button',
          {
            class: 'petit',
            onclick: () => {
              if (!confirm(`Retirer l’outil « ${o.nom} » ?`)) return;
              ui.outils = ui.outils.filter((x) => x !== o);
              ui.outilChoisi = 0;
              garderOutils();
              afficher();
            },
          },
          'Retirer',
        ),
      ),
    ),
    el(
      'div',
      { class: 'rangee' },
      el(
        'button',
        {
          onclick: () => {
            const o = saisirOutil();
            if (!o) return;
            ui.outils = [...ui.outils, o];
            ui.outilChoisi = ui.outils.length - 1;
            garderOutils();
            afficher();
          },
        },
        'Ajouter un outil',
      ),
    ),
  );
}

/** Réglages : à partir de quel virage un sommet compte comme un coin (guidage, coupe). */
export function cadreSeuilCoins(): HTMLElement {
  return el(
    'div',
    { class: 'info' },
    el('strong', {}, 'Coins des parcelles dès'),
    el(
      'div',
      { class: 'rangee' },
      ...SEUILS_COINS.map((v) =>
        el(
          'button',
          {
            class: v === ui.seuilCoins ? 'actif' : '',
            onclick: () => {
              ui.seuilCoins = v;
              ecrireStockage(CLE_SEUIL_COINS, String(v));
              afficher();
            },
          },
          `${v}°`,
        ),
      ),
    ),
  );
}

function panneauOptimisation(s: Session): (HTMLElement | false)[] {
  const outil = outilCourant();
  const outils = choixOutil();
  if (!outil) {
    return [outils];
  }
  if (ui.parcelleCourante === null)
    return [outils, el('div', { class: 'sens' }, 'Touche une parcelle.')];
  const o = optimisationCourante(s);
  const nom = s.td.parcelles[ui.parcelleCourante]!.nom;
  if (!o) {
    return [
      outils,
      el(
        'div',
        { class: 'erreur' },
        `Aucun côté droit d’au moins 20 m sur ${nom} : touche un bord pour y caler les passages.`,
      ),
    ];
  }
  // Le côté touché sur la carte (s'il y en a un) passe devant les propositions calculées.
  const { manuelle } = o.optimisation;
  const choix: [number, Proposition][] = [
    ...(manuelle ? [[-1, manuelle] as [number, Proposition]] : []),
    ...o.optimisation.propositions.slice(0, 3).map((p, i): [number, Proposition] => [i, p]),
  ];
  // Le côté touché peut redonner une des propositions : on le dit, pour ne pas chercher la différence.
  const pareille = manuelle
    ? o.optimisation.propositions
        .slice(0, 3)
        .findIndex(
          (p) =>
            Math.abs(((((p.cap - manuelle.cap) % 180) + 270) % 180) - 90) < 1 &&
            p.demiTours === manuelle.demiTours &&
            Math.abs(p.longueurTotale - manuelle.longueurTotale) < 1,
        )
    : -1;
  const propositions = choix.map(([i, prop]) =>
    el(
      'button',
      {
        class: `carte-sens${i === ui.propositionChoisie ? ' choisie' : ''}`,
        onclick: () => {
          ui.propositionChoisie = i;
          afficher();
        },
      },
      el(
        'span',
        { class: 'carte-sens-titre' },
        `${i === -1 ? `Ton côté${pareille >= 0 ? ` (= ${pareille + 1})` : ''}` : i + 1} · cap ${Math.round(prop.cap)}° · ${prop.demiTours} demi-tours`,
      ),
      el(
        'span',
        { class: 'carte-sens-effet' },
        `${(prop.longueurTotale / 1000).toFixed(1).replace('.', ',')} km estimés · ${prop.passages} passages` +
          (prop.passagesCourts > 0 ? ` (${prop.passagesCourts} courts)` : '') +
          ` · ${texteObstacles(prop)}` +
          (Math.abs(prop.decalage) >= 0.01 ? ` · décalé de ${m(Math.abs(prop.decalage))}` : ''),
      ),
    ),
  );
  return [
    outils,
    el(
      'div',
      { class: 'entete-selection' },
      el('strong', {}, `Passages sur ${nom}`),
      el('span', { class: 'doux' }, `${o.optimisation.propositions.length} direction(s)`),
    ),
    el('div', { class: 'propositions' }, ...propositions),
    el(
      'div',
      { class: manuelle ? 'doux' : 'sens' },
      manuelle
        ? 'Touche un autre bord pour changer de côté.'
        : 'Ou touche un bord de la parcelle : passages parallèles à ce côté.',
    ),
    // Tours de tournière : une ligne par côté, à une demi-largeur du bord (puis + une largeur).
    outil.tourniere > 0 &&
      (() => {
        const n = lignesTourniere(s.etat, ui.parcelleCourante!, outil, ui.seuilCoins).length;
        const tours = Math.max(1, Math.ceil(outil.tourniere / outil.largeur - 0.01));
        const distances = Array.from({ length: tours }, (_, k) =>
          m((k + 0.5) * outil.largeur),
        ).join(', ');
        return el(
          'div',
          { class: 'cartes-sens' },
          ...([true, false] as const).map((avec) =>
            el(
              'button',
              {
                class: `carte-sens${ui.lignesTourniere === avec ? ' choisie' : ''}`,
                onclick: () => {
                  ui.lignesTourniere = avec;
                  afficher();
                },
              },
              el(
                'span',
                { class: 'carte-sens-titre' },
                avec ? 'Avec la fourrière' : 'Sans la fourrière',
              ),
              el(
                'span',
                { class: 'carte-sens-effet' },
                avec ? `${n} ligne(s) à ${distances} du bord` : 'seulement la ligne AB',
              ),
            ),
          ),
        );
      })(),
    el(
      'div',
      { class: 'doux' },
      `Largeur ${m(outil.largeur)} (exactement celle de la console) · tournière ${m(outil.tourniere)}`,
    ),
  ];
}

/** Cadre « Lignes déjà créées » de la parcelle courante : toucher un nom montre la ligne. */
function cadreLignes(s: Session): HTMLElement | false {
  const lignes = (s.etat.guidages ?? []).filter((g) => g.parcelle === ui.parcelleCourante);
  return (
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
          {
            class: `rangee ligne-creee${ui.ligneVue?.parcelle === g.parcelle && ui.ligneVue.nom === g.nom ? ' choisie' : ''}`,
          },
          // Toucher le nom : la ligne est montrée (en violet) et la carte se cale dessus.
          el(
            'button',
            {
              class: 'nom-ligne',
              onclick: () => {
                const vue = ui.ligneVue?.parcelle === g.parcelle && ui.ligneVue.nom === g.nom;
                ui.ligneVue = vue ? null : { parcelle: g.parcelle, nom: g.nom };
                afficher();
                if (!vue) carte.cadrer([...g.points]);
              },
            },
            g.nom,
          ),
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
    )
  );
}
