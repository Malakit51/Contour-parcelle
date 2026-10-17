// Mise en page : zones fixes, bulle, volet, affichage de toute la page.

import { nouvelleSurface } from '../edition/export';
import { fiche, LIBELLES } from '../suivi/suivi';
import { el } from '../ui/dom';
import { estSupprimee } from '../edition/etat';
import { icone, type Icone } from '../ui/icones';
import { dessin } from './dessin';
import { drive, driveEnAttente, reconnecterDrive } from './drive';
import { CLE_HAUTEUR_VOLET, COULEURS_ETAT, type Cran, type OngletBas, ONGLETS, ui } from './etat';
import { exporterVersCle, exportAJour, panneauExport, texteBoutonExport } from './exporter';
import { contenuFichier, contenuReglages } from './fichier';
import { apercuGuidages, commandesLignes, panneauGuidage } from './guidage';
import { boiteMesure, majMesure } from './mesure';
import {
  apercuCollage,
  apercuCoupeCourante,
  apercuFusionCourante,
  choixActionCoupe,
  apercuSimplification,
  boutonSupprimerParcelle,
  cadreNouvelleParcelle,
  cadreZoneExclue,
  choixActionLimite,
  appliquer,
  commandesSommet,
  panneauSelection,
  panneauCollage,
  panneauCoupe,
  panneauFusion,
  panneauSimplification,
  raccourcis,
} from './modifier';
import { panneauSuivi } from './panneau-suivi';
import { panneauRemplacement } from './reference';
import { ecrireStockage } from './stockage';
import { annuler, arreterOutilsCarte, effacerSelection, enMetres, metres } from './travail';
import { cadrerParcelle, cadrerTout, carte, texteGps } from './vue';

export const app = document.getElementById('app')!;

// Case de la distance (barre du bas) : un vrai champ, pour avoir le clavier numérique du téléphone.
// Elle est créée une seule fois : la recréer pendant la saisie fermerait le clavier.
export const champDistance = el('input', {
  type: 'text',
  inputmode: 'decimal',
  enterkeyhint: 'done',
  autocomplete: 'off',
  class: 'champ-distance',
  placeholder: '0',
  'aria-label': 'Distance en mètres',
});
/** Onglet Fichiers : barre Importer / Exporter, comme la portée du suivi. */
function choixPorteeFichiers(): HTMLElement {
  return el(
    'div',
    { class: 'modes' },
    ...(
      [
        ['importer', 'Importer'],
        ['exporter', 'Exporter'],
      ] as const
    ).map(([v, t]) =>
      el(
        'button',
        {
          class: ui.porteeFichiers === v ? 'principal' : '',
          onclick: () => {
            ui.porteeFichiers = v;
            zones.panneau.scrollTop = 0;
            afficher();
          },
        },
        t,
      ),
    ),
  );
}

/** Onglet Fichiers, côté Exporter : le bouton du bas écrit l'export. */
const enExport = () => ui.onglet === 'fichiers' && ui.porteeFichiers === 'exporter';

// Bouton principal de la barre du bas : son texte dit ce qu'il va faire (« Décaler 0,5 m »).
let boutonAppliquer: HTMLButtonElement | null = null;
function texteAppliquer(): string {
  if (enExport()) {
    const graves = exportAJour()?.alertes.some((a) => a.grave) ?? false;
    return `${graves ? 'Malgré tout : ' : ''}${texteBoutonExport()}`;
  }
  const d = metres() > 0 ? ` ${enMetres(metres())} m` : '';
  if (ui.mode === 'limite' && ui.selLimite) return `Décaler${d}`;
  if (ui.mode === 'sommet' && ui.limiteGlisse) return `Déplacer${d}`;
  if (ui.mode === 'guidage' && ui.session) {
    const n = apercuGuidages(ui.session).length;
    if (ui.porteeGuidage === 'optimiser')
      return n > 1 ? `Créer ${n} lignes` : n > 0 ? 'Créer la ligne AB' : 'Appliquer';
    return n > 1 ? `Créer ${n} lignes` : 'Créer la ligne';
  }
  if (ui.mode === 'simplifier') return 'Simplifier';
  if (ui.mode === 'coller') return 'Coller';
  if (ui.mode === 'couper') return ui.actionCoupe === 'fusionner' ? 'Fusionner' : 'Couper';
  return 'Appliquer';
}

champDistance.addEventListener('input', () => {
  // Chiffres et une virgule (le point est accepté et converti) ; pas de signe : ce sont les
  // flèches sur la carte qui donnent le sens.
  const propre = champDistance.value
    .replace('.', ',')
    .replace(/[^0-9,]/g, '')
    .replace(/,(?=.*,)/g, '');
  if (propre !== champDistance.value) champDistance.value = propre;
  ui.saisie = propre;
  if (boutonAppliquer) boutonAppliquer.textContent = texteAppliquer();
});
champDistance.addEventListener('change', () => {
  // Pas de redessin ici : si on tape la distance puis « Appliquer », la case perd la main juste
  // avant l'appui ; redessiner la barre à ce moment ferait perdre l'appui sur le bouton.
  ui.saisie = champDistance.value === '' ? '' : enMetres(metres());
  champDistance.value = ui.saisie;
});
champDistance.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') champDistance.blur();
});

export const zones = {
  carte: el('div', { class: 'zone-carte' }),
  onglets: el('div', { class: 'onglets' }),
  panneau: el('div', { class: 'panneau' }),
  bas: el('div', { class: 'barre-bas' }),
};
// Messages : bulle posée en bas de la carte, qui disparaît seule (touche-la pour la fermer).
export const bulle = el('div', { class: 'bulle', hidden: '' });
bulle.addEventListener('click', () => {
  ui.message = null;
  majBulle();
});

export function majBulle(): void {
  bulle.hidden = !ui.message || !ui.session;
  bulle.className = ui.message?.erreur ? 'bulle erreur' : 'bulle';
  bulle.textContent = ui.message?.texte ?? '';
  if (ui.message === ui.messageAffiche) return;
  ui.messageAffiche = ui.message;
  clearTimeout(ui.minuterieBulle);
  const m = ui.message;
  if (!m || !ui.session) return;
  ui.minuterieBulle = setTimeout(
    () => {
      if (ui.message !== m) return;
      ui.message = null;
      majBulle();
    },
    m.erreur ? 7000 : 4000,
  );
}

zones.carte.append(
  carte.element,
  el('div', { class: 'gps-sur-carte' }, texteGps),
  bulle,
  boiteMesure,
);
// ---------- Volet à la Google Maps (option, en portrait) ----------
//
// La carte prend tout l'écran ; onglets, panneau et barre du bas sont dans un volet posé en bas,
// qu'on fait glisser par sa poignée : replié (onglets et barre du bas), à moitié, presque plein.
// En mise en page classique, le volet est transparent (display: contents).

export const poignee = el('div', { class: 'poignee', title: 'Glisser pour agrandir ou réduire' });
export const volet = el(
  'div',
  { class: 'volet' },
  poignee,
  zones.panneau,
  zones.bas,
  zones.onglets,
);

export const voletVisible = () =>
  ui.voletActif && app.classList.contains('avec-volet') && poignee.offsetHeight > 0;

/**
 * Croix de flèches du mode Point dans le volet ouvert (place suffisante) ; sinon sur la carte :
 * mise en page classique (panneau trop bas), paysage, ou volet replié.
 */
export const croixDansLeVolet = () => voletVisible() && ui.cran !== 'replie';

/** Hauteur (px) de chaque cran : replié = poignée, onglets et barre du bas ; plein = sous le cartouche de la parcelle. */
export function hauteurs(): Record<Cran, number> {
  // Poignée (marge −12) + onglets + barre du bas, deux espaces de 8 px et la marge du bas (zone
  // des boutons d'Android comprise) : le panneau est alors masqué.
  const replie =
    poignee.offsetHeight +
    zones.onglets.offsetHeight +
    zones.bas.offsetHeight +
    4 +
    parseFloat(getComputedStyle(volet).paddingBottom || '0');
  const plein = window.innerHeight - 72;
  return { replie, moitie: Math.max(replie, Math.round(window.innerHeight * 0.5)), plein };
}

export function poserVolet(hauteur?: number): void {
  if (!voletVisible()) {
    app.style.removeProperty('--volet');
    carte.margeBas = 0;
    carte.margeHaut = 56;
    return;
  }
  const crans = hauteurs();
  const h = hauteur ?? crans[ui.cran];
  volet.classList.toggle('replie', h <= crans.replie + 4);
  // Volet haut : plus de place sous la carte pour la bulle et l'échelle, on les remonte / masque.
  app.classList.toggle('volet-haut', h > window.innerHeight * 0.6);
  app.style.setProperty('--volet', `${h}px`);
  carte.margeBas = h;
  carte.margeHaut = 56;
}

// Glissement : le volet suit le doigt, puis se cale sur le cran le plus proche. On l'attrape par
// la poignée (un simple appui y passe au cran suivant) ou par la barre des onglets (là, il faut
// glisser franchement vers le haut ou le bas : un appui reste un changement d'onglet).
export function rendreGlissant(zone: HTMLElement, appuiChangeDeCran: boolean): void {
  let depart: { y: number; x: number; h: number; glisse: boolean; id: number } | null = null;
  const commencer = () => {
    depart!.glisse = true;
    zone.setPointerCapture(depart!.id);
    volet.classList.add('glisse');
  };
  // Mouvements et lâcher suivis sur toute la fenêtre : le doigt sort vite de la poignée.
  const bouger = (e: PointerEvent) => {
    if (!depart || e.pointerId !== depart.id) return;
    const dy = depart.y - e.clientY;
    if (!depart.glisse) {
      if (Math.abs(dy) < 10 || Math.abs(dy) < Math.abs(e.clientX - depart.x)) return;
      commencer();
    }
    const { replie, plein } = hauteurs();
    poserVolet(Math.min(plein, Math.max(replie, depart.h + dy)));
  };
  const lacher = (e: PointerEvent) => {
    if (!depart || e.pointerId !== depart.id) return;
    const d = depart;
    depart = null;
    window.removeEventListener('pointermove', bouger);
    window.removeEventListener('pointerup', lacher);
    window.removeEventListener('pointercancel', lacher);
    if (!d.glisse) return; // simple appui sur un onglet : rien à faire ici
    volet.classList.remove('glisse');
    const crans = hauteurs();
    const h = d.h + (d.y - e.clientY);
    if (Math.abs(d.y - e.clientY) < 6) {
      ui.cran = ui.cran === 'replie' ? 'moitie' : ui.cran === 'moitie' ? 'plein' : 'replie';
    } else {
      ui.cran = (Object.keys(crans) as Cran[]).reduce((m, c) =>
        Math.abs(crans[c] - h) < Math.abs(crans[m] - h) ? c : m,
      );
      // Après un glissement depuis les onglets, le clic qui suit ne doit pas changer d'onglet.
      window.addEventListener(
        'click',
        (c) => {
          c.stopPropagation();
          c.preventDefault();
        },
        { capture: true, once: true },
      );
    }
    ecrireStockage(CLE_HAUTEUR_VOLET, ui.cran);
    // Replié ou non : la croix de flèches du mode Point change de place.
    if (ui.mode === 'sommet' && ui.selSommet) afficher();
    else poserVolet();
  };
  zone.addEventListener('pointerdown', (e) => {
    if (!voletVisible()) return;
    depart = { y: e.clientY, x: e.clientX, h: hauteurs()[ui.cran], glisse: false, id: e.pointerId };
    window.addEventListener('pointermove', bouger);
    window.addEventListener('pointerup', lacher);
    window.addEventListener('pointercancel', lacher);
    if (appuiChangeDeCran) commencer();
  });
}
rendreGlissant(poignee, true);
rendreGlissant(zones.onglets, false);
window.addEventListener('resize', () => poserVolet());

app.classList.add('mise-en-page');
app.replaceChildren(zones.carte, volet);

export function remplir(
  zone: HTMLElement,
  ...contenu: (Node | string | null | false | undefined)[]
): void {
  zone.replaceChildren(...contenu.filter((c): c is Node | string => !!c));
}

export function afficher(): void {
  // Parcelle choisie qui n'existe plus (parcelle créée puis annulée, ou retirée) : plus de choix.
  if (
    ui.session &&
    ui.parcelleCourante !== null &&
    estSupprimee(ui.session.etat, ui.parcelleCourante)
  ) {
    ui.parcelleCourante = null;
  }
  app.classList.toggle('avec-volet', ui.voletActif && ui.session !== null);
  ui.gpsAffiche = carte.gpsActif();
  const defilement = zones.panneau.scrollTop;
  // Sans fichier ouvert (pas de carte), le message reste en tête du panneau.
  const msg =
    ui.message &&
    !ui.session &&
    el('div', { class: ui.message.erreur ? 'info erreur' : 'info' }, ui.message.texte);
  majBulle();

  if (!ui.session) {
    ui.onglet = 'fichiers';
    zones.carte.hidden = true;
    remplir(zones.onglets);
    remplir(zones.bas);
    remplir(zones.panneau, msg, ...contenuFichier(null));
    carte.definirCommandes(null);
    carte.definirCommandesDroite(null);
    carte.definirCommandesBas(null);
    carte.definirCartouche(null);
    return;
  }
  const s = ui.session;
  zones.carte.hidden = false;

  // Cartouche de la parcelle choisie (nom, surface, état), en haut à gauche de la carte. Pas de
  // liste : on choisit une parcelle en la touchant sur la carte (ou dans Suivi, Toutes).
  const courante = ui.parcelleCourante === null ? null : s.td.parcelles[ui.parcelleCourante]!;
  let cartouche: HTMLElement | null = null;
  if (courante) {
    const p = ui.parcelleCourante!;
    const etatCourant = fiche(ui.suivi, courante).etat;
    const surface = nouvelleSurface(s.td, s.etat, p);
    cartouche = el(
      'div',
      { class: 'cartouche' },
      el(
        'button',
        {
          class: 'cartouche-texte',
          title: 'Cadrer la parcelle',
          onclick: () => cadrerParcelle(p),
        },
        el('span', { class: 'pastille', style: `background:${COULEURS_ETAT[etatCourant]}` }),
        el(
          'span',
          { class: 'cartouche-lignes' },
          el('span', { class: 'cartouche-nom' }, courante.nom),
          el(
            'span',
            { class: 'cartouche-detail' },
            [
              surface !== null ? `${(surface / 10000).toFixed(2).replace('.', ',')} ha` : null,
              LIBELLES[etatCourant].toLowerCase(),
            ]
              .filter(Boolean)
              .join(' · '),
          ),
        ),
      ),
      el(
        'button',
        {
          class: 'cartouche-fermer',
          title: 'Toutes les parcelles',
          'aria-label': 'Toutes les parcelles',
          onclick: () => {
            ui.parcelleCourante = null;
            effacerSelection();
            afficher();
            cadrerTout();
          },
        },
        icone('fermer', 18),
      ),
    );
  }
  const rond = (nom: Icone, titre: string, action: () => void, classe = '') =>
    el(
      'button',
      { class: `rond ${classe}`, title: titre, 'aria-label': titre, onclick: action },
      icone(nom),
    );

  // En haut à droite, sous le choix du fond : lignes, mesure, Drive à reconnecter, réglages.
  const boutonsCarte = el(
    'div',
    { class: 'boutons-ronds' },
    commandesLignes(s),
    rond(
      'mesure',
      'Mesurer',
      () => {
        const ouvrir = ui.mesure === null;
        arreterOutilsCarte();
        ui.mesure = ouvrir ? [] : null;
        afficher();
      },
      ui.mesure !== null ? 'actif' : '',
    ),
    driveEnAttente() &&
      !drive.connecte() &&
      rond('nuage', 'Reconnecter Google Drive', () => void reconnecterDrive(), 'alerte'),
    rond(
      'reglages',
      'Réglages',
      () => {
        arreterOutilsCarte();
        if (ui.onglet === 'reglages') ui.onglet = ui.ongletAvantReglages;
        else {
          ui.ongletAvantReglages = ui.onglet;
          ui.onglet = 'reglages';
          // Volet replié : on l'ouvre à moitié pour voir les réglages.
          if (ui.cran === 'replie') ui.cran = 'moitie';
        }
        zones.panneau.scrollTop = 0;
        afficher();
      },
      ui.onglet === 'reglages' ? 'actif' : '',
    ),
  );
  // En bas à droite, comme sur Google Maps : ma position et, GPS allumé, centrer dessus.
  const boutonsBas = el(
    'div',
    { class: 'boutons-ronds' },
    carte.gpsActif() && rond('centrer', 'Centrer sur ma position', () => carte.centrerSurGps()),
    rond(
      'gps',
      carte.gpsActif() ? 'Arrêter le GPS' : 'Ma position (GPS)',
      () => {
        carte.basculerGps();
        afficher();
      },
      carte.gpsActif() ? 'actif' : '',
    ),
  );

  const ICONES_ONGLETS: Record<OngletBas, Icone> = {
    modifier: 'modifier',
    guidage: 'lignes',
    suivi: 'suivi',
    fichiers: 'fichier',
  };
  remplir(
    zones.onglets,
    ...(Object.keys(ONGLETS) as OngletBas[]).map((o) =>
      el(
        'button',
        {
          class: o === ui.onglet ? 'onglet choisi' : 'onglet',
          onclick: () => {
            if (o !== ui.onglet) arreterOutilsCarte();
            ui.onglet = o;
            // Guidage et Modifier ont chacun leurs modes : on passe de l'un à l'autre.
            if (o === 'guidage' && ui.mode !== 'guidage') {
              ui.modeModifier = ui.mode;
              ui.mode = 'guidage';
              effacerSelection();
            } else if (o === 'modifier' && ui.mode === 'guidage') {
              ui.mode = ui.modeModifier;
              effacerSelection();
            }
            zones.panneau.scrollTop = 0;
            afficher();
          },
        },
        icone(ICONES_ONGLETS[o], 24),
        ONGLETS[o],
      ),
    ),
  );

  const modeBouton = (m: typeof ui.mode, texte: string) => {
    // « Limite » regroupe Décaler et Coller au voisin : on y revient sur la dernière action choisie.
    const limite = m === 'limite' || m === 'coller';
    const actif = limite ? ui.mode === 'limite' || ui.mode === 'coller' : ui.mode === m;
    return el(
      'button',
      {
        class: actif ? 'principal' : '',
        onclick: () => {
          if (actif) return;
          ui.mode = limite ? ui.actionLimite : m;
          effacerSelection();
          arreterOutilsCarte();
          afficher();
        },
      },
      texte,
    );
  };
  // Raccourcis de distance : seulement quand une distance sert.
  const distanceUtile =
    (ui.mode === 'limite' && ui.selLimite !== null) ||
    (ui.mode === 'sommet' && ui.selSommet !== null) ||
    ui.mode === 'guidage' ||
    (ui.mode === 'couper' &&
      ui.actionCoupe === 'couper' &&
      ui.coupe !== null &&
      ui.coupeMesure === 'distance');

  let contenu: (Node | null | false)[];
  switch (ui.onglet) {
    case 'modifier':
      contenu = [
        el(
          'div',
          { class: 'modes' },
          modeBouton('limite', 'Limite'),
          modeBouton('sommet', 'Point'),
          modeBouton('simplifier', 'Simplifier'),
          modeBouton('couper', 'Couper'),
        ),
        (ui.mode === 'limite' || ui.mode === 'coller') && choixActionLimite(),
        ui.mode === 'couper' && choixActionCoupe(),
        ui.mode === 'couper'
          ? ui.actionCoupe === 'fusionner'
            ? panneauFusion(s)
            : panneauCoupe(s)
          : ui.mode === 'simplifier'
            ? panneauSimplification(s)
            : ui.mode === 'guidage'
              ? panneauGuidage(s)
              : ui.mode === 'coller'
                ? panneauCollage(s)
                : panneauSelection(s),
        // Recoller sur l'ancien TASKDATA se fait point par point : le remplacement est à côté.
        ui.mode === 'sommet' && panneauRemplacement(s),
        distanceUtile && raccourcis(),
        (ui.mode === 'limite' || ui.mode === 'sommet') && cadreZoneExclue(s),
        (ui.mode === 'limite' || ui.mode === 'sommet') && cadreNouvelleParcelle(),
        boutonSupprimerParcelle(s),
      ];
      break;
    case 'guidage':
      contenu = [panneauGuidage(s), ui.porteeGuidage !== 'optimiser' && raccourcis()];
      break;
    case 'suivi':
      contenu = panneauSuivi(s);
      break;
    case 'fichiers':
      contenu = [
        choixPorteeFichiers(),
        ...(ui.porteeFichiers === 'importer' ? contenuFichier(s) : panneauExport(s)),
      ];
      break;
    case 'reglages':
      contenu = contenuReglages(s);
      break;
  }
  remplir(zones.panneau, msg, ...contenu);

  // Fichiers, Exporter : le bouton principal écrit l'export (sur la clé, ou en téléchargement).
  const exportEnCours = enExport();
  // Pas de distance à saisir pour l'optimisation du guidage (la largeur vient de l'outil).
  const sansBouton =
    ui.onglet === 'suivi' ||
    ui.onglet === 'reglages' ||
    (ui.onglet === 'fichiers' && !exportEnCours);
  const sansDistance =
    exportEnCours ||
    sansBouton ||
    (ui.onglet === 'guidage' && ui.porteeGuidage === 'optimiser') ||
    (ui.onglet === 'modifier' &&
      (ui.mode === 'simplifier' ||
        ui.mode === 'coller' ||
        (ui.mode === 'couper' && ui.actionCoupe === 'fusionner')));
  const peutAppliquer = exportEnCours
    ? exportAJour() !== null
    : (ui.mode === 'limite' && ui.selLimite !== null && ui.sensLimite !== null) ||
      (ui.mode === 'sommet' &&
        ui.selSommet !== null &&
        ui.limiteGlisse !== null &&
        ui.sensGlisse !== null) ||
      (ui.mode === 'guidage' && apercuGuidages(s).length > 0) ||
      (ui.mode === 'coller' && 'etat' in (apercuCollage(s) ?? {})) ||
      (ui.mode === 'couper' && 'coupe' in (apercuCoupeCourante(s) ?? {})) ||
      (ui.mode === 'couper' && 'contour' in (apercuFusionCourante(s) ?? {})) ||
      (ui.mode === 'simplifier' &&
        (apercuSimplification(s)?.bilan.some((b) => b.apres !== b.avant || b.ecartMax > 0) ??
          false));
  remplir(
    zones.bas,
    el(
      'button',
      {
        class: 'annuler',
        title: 'Annuler la dernière modification',
        'aria-label': 'Annuler',
        onclick: annuler,
        ...(s.historique.length > 0 ? {} : { disabled: '' }),
      },
      icone('annuler', 24),
    ),
    // Pas de distance là où elle ne sert pas : le bouton prend la place.
    !sansDistance &&
      el(
        'label',
        { class: 'case-distance' },
        champDistance,
        el('span', {}, ui.mode === 'couper' && ui.coupeMesure === 'surface' ? 'ha' : 'm'),
      ),
    // Suivi et Fichier : rien à appliquer, seul « Annuler » reste.
    !sansBouton &&
      (boutonAppliquer = el(
        'button',
        {
          class: exportEnCours ? 'principal large' : 'principal',
          onclick: exportEnCours ? exporterVersCle : appliquer,
          ...(peutAppliquer ? {} : { disabled: '' }),
        },
        texteAppliquer(),
      )),
  );
  if (document.activeElement !== champDistance) champDistance.value = ui.saisie;
  // Croix de flèches : dans le volet ouvert, sinon sur la carte.
  carte.definirCommandes(
    ui.onglet === 'modifier' && ui.mode === 'sommet' && ui.selSommet && !croixDansLeVolet()
      ? commandesSommet()
      : null,
  );
  carte.definirCommandesDroite(boutonsCarte);
  carte.definirCommandesBas(boutonsBas);
  carte.definirCartouche(cartouche);
  majMesure();
  poserVolet();
  carte.afficher(dessin(s));
  zones.panneau.scrollTop = defilement;
}
