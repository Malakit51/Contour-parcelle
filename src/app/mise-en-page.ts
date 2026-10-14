// Mise en page : zones fixes, bulle, volet, affichage de toute la page.

import { el } from '../ui/dom';
import { dessin } from './dessin';
import { drive, driveEnAttente, reconnecterDrive } from './drive';
import { CLE_HAUTEUR_VOLET, type Cran, type Onglet, ONGLETS, ui } from './etat';
import { panneauExport, tableauVersion } from './exporter';
import { contenuFichier } from './fichier';
import { apercuGuidages, commandesLignes, panneauGuidage } from './guidage';
import { boiteMesure, majMesure } from './mesure';
import {
  apercuSimplification,
  appliquer,
  commandesSommet,
  panneauSelection,
  panneauSimplification,
  raccourcis,
} from './modifier';
import { panneauSuiviGeneral, panneauSuiviParcelle } from './panneau-suivi';
import { panneauRemplacement } from './reference';
import { ecrireStockage } from './stockage';
import { annuler, effacerSelection, enMetres, metres } from './travail';
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
champDistance.addEventListener('input', () => {
  // Chiffres et une virgule (le point est accepté et converti) ; pas de signe : ce sont les
  // flèches sur la carte qui donnent le sens.
  const propre = champDistance.value
    .replace('.', ',')
    .replace(/[^0-9,]/g, '')
    .replace(/,(?=.*,)/g, '');
  if (propre !== champDistance.value) champDistance.value = propre;
  ui.saisie = propre;
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
  haut: el('div', { class: 'barre-haut' }),
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
  zones.onglets,
  zones.panneau,
  zones.bas,
);

export const voletVisible = () =>
  ui.voletActif && app.classList.contains('avec-volet') && poignee.offsetHeight > 0;

/** Hauteur (px) de chaque cran : replié = poignée, onglets et barre du bas ; plein = sous la barre du haut. */
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
    carte.margeHaut = 0;
    return;
  }
  const crans = hauteurs();
  const h = hauteur ?? crans[ui.cran];
  volet.classList.toggle('replie', h <= crans.replie + 4);
  // Volet haut : plus de place sous la carte pour la bulle et l'échelle, on les remonte / masque.
  app.classList.toggle('volet-haut', h > window.innerHeight * 0.6);
  app.style.setProperty('--volet', `${h}px`);
  carte.margeBas = h;
  carte.margeHaut = 64;
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
    poserVolet();
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
app.replaceChildren(zones.haut, zones.carte, volet);

export function remplir(
  zone: HTMLElement,
  ...contenu: (Node | string | null | false | undefined)[]
): void {
  zone.replaceChildren(...contenu.filter((c): c is Node | string => !!c));
}

export function afficher(): void {
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
    ui.onglet = 'fichier';
    zones.carte.hidden = true;
    remplir(zones.haut);
    remplir(zones.onglets);
    remplir(zones.bas);
    remplir(zones.panneau, msg, ...contenuFichier(null));
    carte.definirCommandes(null);
    carte.definirCommandesDroite(null);
    return;
  }
  const s = ui.session;
  zones.carte.hidden = false;

  const choixParcelle = el('select', {});
  choixParcelle.append(el('option', { value: '' }, 'Toutes les parcelles'));
  s.td.parcelles
    .map((p, i) => ({ nom: p.nom, i }))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { numeric: true }))
    .forEach(({ nom, i }) => {
      const o = el('option', { value: String(i) }, nom);
      if (i === ui.parcelleCourante) o.selected = true;
      choixParcelle.append(o);
    });
  choixParcelle.addEventListener('change', () => {
    ui.parcelleCourante = choixParcelle.value === '' ? null : Number(choixParcelle.value);
    effacerSelection();
    afficher();
    if (ui.parcelleCourante === null) cadrerTout();
    else cadrerParcelle(ui.parcelleCourante);
  });

  remplir(
    zones.haut,
    choixParcelle,
    el('button', { onclick: () => carte.zoomer(1) }, '+'),
    el('button', { onclick: () => carte.zoomer(-1) }, '−'),
    el(
      'button',
      {
        class: carte.gpsActif() ? 'actif' : '',
        onclick: () => {
          carte.basculerGps();
          afficher();
        },
      },
      'GPS',
    ),
    carte.gpsActif() && el('button', { onclick: () => carte.centrerSurGps() }, '⌖'),
    el(
      'button',
      {
        class: ui.mesure !== null ? 'actif' : '',
        title: 'Mesurer',
        onclick: () => {
          ui.mesure = ui.mesure === null ? [] : null;
          afficher();
        },
      },
      '📏',
    ),
    driveEnAttente() &&
      !drive.connecte() &&
      el(
        'button',
        {
          class: 'actif nuage',
          title: 'Reconnecter Google Drive',
          onclick: () => void reconnecterDrive(),
        },
        '☁',
      ),
  );

  remplir(
    zones.onglets,
    ...(Object.keys(ONGLETS) as Onglet[]).map((o) =>
      el(
        'button',
        {
          class: o === ui.onglet ? 'onglet choisi' : 'onglet',
          onclick: () => {
            ui.onglet = o;
            zones.panneau.scrollTop = 0;
            afficher();
          },
        },
        ONGLETS[o],
      ),
    ),
  );

  const modeBouton = (m: typeof ui.mode, texte: string) =>
    el(
      'button',
      {
        class: ui.mode === m ? 'principal' : '',
        onclick: () => {
          ui.mode = m;
          effacerSelection();
          afficher();
        },
      },
      texte,
    );

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
          modeBouton('guidage', 'Guidage'),
        ),
        ui.mode === 'simplifier'
          ? panneauSimplification(s)
          : ui.mode === 'guidage'
            ? panneauGuidage(s)
            : panneauSelection(s),
        panneauRemplacement(s),
        raccourcis(),
      ];
      break;
    case 'suivi':
      contenu = [
        panneauSuiviParcelle(s) ?? el('div', { class: 'info doux' }, 'Touche une parcelle.'),
        el(
          'div',
          { class: 'rangee' },
          el(
            'button',
            {
              onclick: () => {
                ui.couleursParEtat = !ui.couleursParEtat;
                afficher();
              },
            },
            ui.couleursParEtat ? 'Couleurs : état' : 'Couleurs : voisins',
          ),
        ),
        panneauSuiviGeneral(s),
      ];
      break;
    case 'export':
      contenu = [tableauVersion(s), panneauExport()];
      break;
    case 'fichier':
      contenu = contenuFichier(s);
      break;
  }
  remplir(zones.panneau, msg, ...contenu);

  const peutAppliquer =
    (ui.mode === 'limite' && ui.selLimite !== null && ui.sensLimite !== null) ||
    (ui.mode === 'sommet' &&
      ui.selSommet !== null &&
      ui.limiteGlisse !== null &&
      ui.sensGlisse !== null) ||
    (ui.mode === 'guidage' && apercuGuidages(s).length > 0) ||
    (ui.mode === 'simplifier' &&
      (apercuSimplification(s)?.bilan.some((b) => b.apres !== b.avant || b.ecartMax > 0) ?? false));
  remplir(
    zones.bas,
    el('label', { class: 'case-distance' }, champDistance, 'm'),
    el(
      'button',
      { class: 'principal', onclick: appliquer, ...(peutAppliquer ? {} : { disabled: '' }) },
      'Appliquer',
    ),
    el(
      'button',
      { onclick: annuler, ...(s.historique.length > 0 ? {} : { disabled: '' }) },
      'Annuler',
    ),
  );
  if (document.activeElement !== champDistance) champDistance.value = ui.saisie;
  carte.definirCommandes(ui.mode === 'sommet' && ui.selSommet ? commandesSommet() : null);
  carte.definirCommandesDroite(commandesLignes(s));
  majMesure();
  poserVolet();
  carte.afficher(dessin(s));
  zones.panneau.scrollTop = defilement;
}
