import { describe, expect, it } from 'vitest';
import { controler, seCroisent, sommetsPresqueCommuns } from '../src/edition/controles';
import {
  ajouterPoint,
  decalerLimite,
  decalerSommet,
  remplacerContour,
} from '../src/edition/operations';
import type { XY } from '../src/geometrie/plan';
import { latLon } from '../src/edition/etat';
import { plan, preparer } from './outils';

const carre = (x: number, y: number, c: number): XY[] => [
  [x, y],
  [x + c, y],
  [x + c, y + c],
  [x, y + c],
];

describe('croisement de segments', () => {
  it('distingue un vrai croisement d’un simple contact', () => {
    expect(seCroisent([0, 0], [10, 10], [0, 10], [10, 0])).toBe(true);
    expect(seCroisent([0, 0], [10, 0], [10, 0], [10, 10])).toBe(false); // extrémité commune
    expect(seCroisent([0, 0], [10, 0], [5, 0], [5, 10])).toBe(false); // contact en T
    expect(seCroisent([0, 0], [10, 0], [5, 0], [15, 0])).toBe(false); // recouvrement
  });
});

describe('contrôles avant export', () => {
  it('rien à signaler sur deux parcelles voisines correctes, même après un décalage', () => {
    const { td, etat } = preparer({ X: carre(0, 0, 100), Y: carre(100, 0, 100) });
    expect(controler(td, etat, [0, 1])).toEqual([]);
    expect(controler(td, decalerLimite(etat, { anneau: 0, debut: 1 }, 1), [0, 1])).toEqual([]);
  });

  it('rien à signaler après le décalage d’une limite partagée au bord en angle', () => {
    const { td, etat } = preparer({
      X: [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 80],
      ],
      Y: [
        [100, 0],
        [200, 0],
        [200, 70],
        [100, 100],
      ],
    });
    for (const d of [0.5, -0.5]) {
      expect(controler(td, decalerLimite(etat, { anneau: 0, debut: 1 }, d), [0, 1])).toEqual([]);
    }
  });

  it('signale un chevauchement', () => {
    const { td, etat } = preparer({ X: carre(0, 0, 100), Y: carre(90, 10, 50) });
    expect(controler(td, etat, [0])).toEqual([{ grave: true, message: 'X chevauche Y.' }]);
  });

  it('signale un contour qui se recoupe', () => {
    const { td, etat } = preparer({
      N: [
        [0, 0],
        [100, 100],
        [100, 0],
        [0, 100],
      ],
    });
    expect(controler(td, etat, [0])).toEqual([
      { grave: true, message: 'N : le contour se recoupe lui-même.' },
    ]);
  });

  it('repère les sommets presque communs', () => {
    const { td, etat } = preparer({ X: carre(0, 0, 100), Y: carre(100.5, 0, 100) });
    const presque = sommetsPresqueCommuns(td, etat, 1);
    expect(presque).toHaveLength(2);
    expect(presque[0]!.distance).toBeCloseTo(0.5, 2);
    expect(controler(td, etat, [1]).map((a) => a.grave)).toEqual([false, false]);
  });
});

describe('limite commune qui ne coïncide plus', () => {
  it('signalée quand un voisin perd ses sommets communs, pas après un déplacement commun', () => {
    const { td, etat } = preparer({ X: carre(0, 0, 100), Y: carre(100, 0, 100) });
    // Déplacement d'un sommet commun : il bouge chez les deux, rien à signaler.
    expect(controler(td, decalerSommet(etat, { anneau: 0, sommet: 2 }, 1, 0), [0, 1])).toEqual([]);
    // Contour de X remplacé : ses sommets communs avec Y ont disparu.
    const remplace = remplacerContour(
      etat,
      0,
      carre(0, 0, 98).map((p) => plan.versLatLon(p)),
    );
    expect(controler(td, remplace, [0]).map((a) => a.message)).toEqual([
      'X / Y : la limite commune ne coïncide plus (2 sommet(s) commun(s) perdu(s)) ; risque de bande vide ou de chevauchement, vérifie sur la carte.',
    ]);
  });
});

describe('point ajouté sur une limite commune puis décollé', () => {
  it('signale la bande vide quand un seul des deux voisins garde le point', () => {
    const { td, etat } = preparer({ X: carre(0, 0, 100), Y: carre(100, 0, 100) });
    const r = ajouterPoint(etat, { anneau: 0, debut: 1 }, plan.versLatLon([100, 50]));
    const deplace = decalerSommet(r.etat, r.sommet, 20, 0); // bouge chez les deux : rien à dire
    expect(controler(td, deplace, [0, 1])).toEqual([]);
    // X reprend son contour d'origine : Y garde le point déplacé, la limite ne coïncide plus.
    const remplace = remplacerContour(deplace, 0, etat.anneaux[0]!.sommets.map(latLon));
    const messages = controler(td, remplace, [0, 1]).map((a) => a.message);
    expect(messages).toEqual([
      'Y / X : la limite commune ne coïncide plus (1 point(s) de Y hors de la limite de X) ; risque de bande vide ou de chevauchement, vérifie sur la carte.',
    ]);
  });

  it("ne prend pas le reste d'une parcelle étroite pour la limite commune", () => {
    // Bande de 100 × 20 m le long de X, plusieurs points sur ses autres côtés.
    const bande: XY[] = [
      [100, 0],
      [100, 100],
      [110, 100],
      [120, 100],
      [120, 50],
      [120, 0],
      [110, 0],
    ];
    const { td, etat } = preparer({ X: carre(0, 0, 100), Y: bande });
    expect(controler(td, etat, [0, 1])).toEqual([]);
  });
});
