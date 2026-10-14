// Outil de mesure (bouton 📏).

import { distanceExacte } from '../geometrie/plan';
import { el } from '../ui/dom';
import { ui } from './etat';
import { afficher, remplir } from './mise-en-page';

/** Résultat de la mesure, posé en haut de la carte (élément fixe, rempli à chaque affichage). */
export const boiteMesure = el('div', { class: 'boite-mesure', hidden: '' });

export const enM = (m: number) =>
  m >= 1000
    ? `${(m / 1000).toFixed(3).replace('.', ',')} km`
    : `${m.toFixed(1).replace('.', ',')} m`;

export function majMesure(): void {
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
        ? 'Touche deux points (un sommet attire le doigt).'
        : pts.length === 2
          ? enM(total)
          : `${enM(total)} (dernier : ${enM(dernier)})`,
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
  );
}
