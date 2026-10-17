// Photo hors réseau : enregistre sur le téléphone (Cache du navigateur) les tuiles de la photo
// IGN autour des parcelles ; le service worker (public/sw.js) les sert ensuite à la carte, avec ou
// sans réseau.

import { anneauIgnore, latLon } from '../edition/etat';
import { rectangleAutour, tuilesCouvrant, type Tuile } from '../geometrie/tuiles';
import { el } from '../ui/dom';
import { urlTuilePhoto } from '../ui/carte';
import { type Session, ui } from './etat';
import { afficher } from './mise-en-page';
import { ecrireStockage, lireStockage } from './stockage';

const CACHE = 'photo-ign';
const CLE = 'contour-parcelle/photo-hors-reseau';
/** Zooms enregistrés : du plus large (photo floue de secours) au plus précis de l'IGN. */
const Z_MIN = 13;
const Z_MAX = 19;
/** Marge autour de chaque parcelle (m). */
const MARGE_M = 50;
/** Taille moyenne d'une tuile (octets), pour l'estimation avant d'enregistrer. */
const TAILLE_TUILE = 25_000;

let travail: { total: number; faits: number; erreurs: number; arret: boolean } | null = null;

function tuilesDuTravail(s: Session): Tuile[] {
  const rectangles = s.etat.anneaux
    .filter((a, i) => a.type === 1 && !anneauIgnore(s.etat, i))
    .map((a) => rectangleAutour(a.sommets.map(latLon), MARGE_M));
  return tuilesCouvrant(rectangles, Z_MIN, Z_MAX);
}

function infos(): { tuiles: number; date: string } | null {
  try {
    return JSON.parse(lireStockage(CLE) ?? 'null') as { tuiles: number; date: string } | null;
  } catch {
    return null;
  }
}

const mo = (octets: number) => `${Math.round(octets / 1e6)} Mo`;

async function enregistrer(s: Session): Promise<void> {
  if (!('caches' in window)) {
    ui.message = { texte: 'Ce navigateur ne sait pas garder la photo.', erreur: true };
    afficher();
    return;
  }
  const tuiles = tuilesDuTravail(s);
  // Demande à Chrome de ne pas effacer ces données quand le téléphone manque de place.
  void navigator.storage?.persist?.().catch(() => false);
  const cache = await caches.open(CACHE);
  travail = { total: tuiles.length, faits: 0, erreurs: 0, arret: false };
  afficher();
  let suivante = 0;
  let refus = false;
  const ouvrier = async () => {
    while (travail && !travail.arret && suivante < tuiles.length) {
      const t = tuiles[suivante++]!;
      const url = urlTuilePhoto(t.z, t.x, t.y);
      try {
        if (!(await cache.match(url))) {
          const r = await fetch(url, { mode: 'cors' });
          if (r.ok) await cache.put(url, r);
          else travail.erreurs++;
        }
      } catch {
        // Refus de l'IGN (CORS) ou coupure du réseau.
        travail.erreurs++;
        if (travail.faits === 0 && travail.erreurs > 20) refus = true;
      }
      travail.faits++;
      if (travail.faits % 25 === 0) afficher();
      if (refus) travail.arret = true;
    }
  };
  await Promise.all(Array.from({ length: 6 }, ouvrier));
  const fini = travail;
  travail = null;
  if (fini) {
    const gardees = (await cache.keys()).length;
    ecrireStockage(CLE, JSON.stringify({ tuiles: gardees, date: new Date().toISOString() }));
    ui.message = refus
      ? { texte: 'Le serveur de l’IGN refuse l’enregistrement de la photo.', erreur: true }
      : fini.arret
        ? { texte: `Arrêté : ${gardees} tuiles gardées.`, erreur: false }
        : {
            texte: `Photo gardée sur le téléphone : ${gardees} tuiles${fini.erreurs ? ` (${fini.erreurs} n’ont pas pu être chargées, relance plus tard)` : ''}.`,
            erreur: fini.erreurs > 0,
          };
  }
  afficher();
}

async function effacer(): Promise<void> {
  if (!confirm('Effacer la photo gardée sur le téléphone ? La carte la redemandera à l’IGN.'))
    return;
  if ('caches' in window) await caches.delete(CACHE);
  ecrireStockage(CLE, null);
  ui.message = { texte: 'Photo gardée effacée.', erreur: false };
  afficher();
}

/** Cadre des Réglages : enregistrer ou effacer la photo autour des parcelles. */
export function cadrePhotoHorsReseau(s: Session): HTMLElement {
  const deja = infos();
  const n = tuilesDuTravail(s).length;
  return el(
    'div',
    { class: 'info' },
    el('strong', {}, 'Photo hors réseau'),
    el(
      'div',
      { class: 'doux' },
      deja
        ? `${deja.tuiles} tuiles gardées sur le téléphone (le ${new Date(deja.date).toLocaleDateString('fr-FR')}). La carte les affiche même sans réseau.`
        : `Garde sur le téléphone la photo IGN autour de tes parcelles (environ ${n} tuiles, ${mo(n * TAILLE_TUILE)}), de préférence en Wi-Fi. La carte l’affichera même sans réseau.`,
    ),
    travail
      ? el(
          'div',
          { class: 'rangee' },
          el(
            'span',
            { class: 'sens', style: 'flex:1' },
            `Enregistrement : ${travail.faits} / ${travail.total}`,
          ),
          el(
            'button',
            {
              onclick: () => {
                if (travail) travail.arret = true;
              },
            },
            'Arrêter',
          ),
        )
      : el(
          'div',
          { class: 'rangee' },
          el(
            'button',
            { onclick: () => void enregistrer(s) },
            deja ? 'Mettre à jour' : 'Garder la photo',
          ),
          deja && el('button', { class: 'petit', onclick: () => void effacer() }, 'Effacer'),
        ),
  );
}
