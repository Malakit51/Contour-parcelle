// Outil de mesure (bouton 📏).

import { distanceExacte } from '../geometrie/plan';
import { el } from '../ui/dom';
import { ui } from './etat';
import { afficher, remplir } from './mise-en-page';
import { arreterOutilsCarte } from './travail';
import { annulerTrace, retirerDernierPoint, terminerTrace } from './trace-zone';
import { surfaceZone, texteSurface } from '../suivi/zones';

/** Résultat de la mesure, posé en haut de la carte (élément fixe, rempli à chaque affichage). */
export const boiteMesure = el('div', { class: 'boite-mesure', hidden: '' });

export const enM = (m: number) =>
  m >= 1000
    ? `${(m / 1000).toFixed(3).replace('.', ',')} km`
    : `${m.toFixed(1).replace('.', ',')} m`;

/**
 * Bandeau en haut de la carte : ce que fera le prochain toucher (un seul outil actif à la fois),
 * avec de quoi l'arrêter. Rien quand le toucher fait son travail habituel (choisir).
 */
export function majMesure(): void {
  const arreter = (texte = 'Annuler') =>
    el(
      'button',
      {
        onclick: () => {
          arreterOutilsCarte();
          afficher();
        },
      },
      texte,
    );
  // Tracé de la zone d'une note : nombre de points, retirer le dernier, terminer, annuler.
  const t = ui.traceZone;
  boiteMesure.classList.toggle('trace', !!t);
  if (t) {
    const n = t.points.length;
    const quoi =
      t.pour === 'exclue' ? 'Zone exclue' : t.pour === 'parcelle' ? 'Nouvelle parcelle' : 'Zone';
    boiteMesure.hidden = false;
    remplir(
      boiteMesure,
      el(
        'span',
        {},
        t.mode === 'points'
          ? n === 0
            ? `${quoi} : touche les coins sur la carte.`
            : `${quoi} : ${n} coin(s)${n >= 3 ? ` · ${texteSurface(surfaceZone(t.points))}` : ''}`
          : `En marchant : ${n} point(s)` +
              (t.precision !== null ? ` · GPS ± ${Math.round(t.precision)} m` : ' · GPS…') +
              (n >= 3 ? ` · ${texteSurface(surfaceZone(t.points))}` : ''),
      ),
      n > 0 && el('button', { onclick: retirerDernierPoint }, 'Retirer le dernier'),
      n >= 3 && el('button', { class: 'principal', onclick: terminerTrace }, 'Terminer'),
      el('button', { onclick: annulerTrace }, 'Annuler'),
    );
    return;
  }
  const consigne = ui.placementNote
    ? 'Touche la carte à l’endroit de la note.'
    : ui.placerAuDoigt
      ? '☝ Touche la carte là où le point doit aller.'
      : ui.ajoutEnCours
        ? 'Touche une limite pour y ajouter un point.'
        : null;
  if (consigne) {
    boiteMesure.hidden = false;
    remplir(boiteMesure, el('span', {}, consigne), arreter());
    return;
  }
  boiteMesure.hidden = ui.mesure === null;
  if (ui.mesure === null) return;
  const pts = ui.mesure;
  const longueurSegment = distanceExacte;
  let total = 0;
  for (let k = 1; k < pts.length; k++) total += longueurSegment(pts[k - 1]!, pts[k]!);
  const dernier = pts.length > 1 ? longueurSegment(pts[pts.length - 2]!, pts[pts.length - 1]!) : 0;
  remplir(
    boiteMesure,
    el(
      'span',
      {},
      pts.length < 2
        ? 'Règle : touche deux points (un sommet attire le doigt).'
        : pts.length === 2
          ? `Règle : ${enM(total)}`
          : `Règle : ${enM(total)} (dernier : ${enM(dernier)})`,
    ),
    pts.length > 0 &&
      el(
        'button',
        {
          onclick: () => {
            ui.mesure = [];
            afficher();
          },
        },
        'Effacer',
      ),
    arreter('Fermer'),
  );
}
