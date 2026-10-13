import { describe, expect, it } from 'vitest';
import { controler, seCroisent, sommetsPresqueCommuns } from '../src/edition/controles';
import { decalerLimite } from '../src/edition/operations';
import type { XY } from '../src/geometrie/plan';
import { preparer } from './outils';

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
