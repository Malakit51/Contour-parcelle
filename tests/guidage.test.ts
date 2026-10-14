import { describe, expect, it } from 'vitest';
import { coins, cotesEntreCoins, courbeDecalee, estDroit, ligneAB } from '../src/geometrie/guidage';
import type { XY } from '../src/geometrie/plan';
import { etatInitial, latLon, type Guidage } from '../src/edition/etat';
import { exporterEtat } from '../src/edition/export';
import { lireTaskData } from '../src/isoxml/lecture';
import { plan, preparer } from './outils';

const carre: XY[] = [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100],
];

const arrondi = (pts: readonly XY[]) =>
  pts.map((p) => p.map((v) => Math.round(v * 1000) / 1000 + 0));

describe('lignes de guidage', () => {
  it('AB sur un bord droit : même ligne, décalée vers la gauche', () => {
    expect(
      arrondi(
        ligneAB(
          [
            [0, 0],
            [100, 0],
          ],
          0,
        ),
      ),
    ).toEqual([
      [0, 0],
      [100, 0],
    ]);
    expect(
      arrondi(
        ligneAB(
          [
            [0, 0],
            [100, 0],
          ],
          3,
        ),
      ),
    ).toEqual([
      [0, 3],
      [100, 3],
    ]);
    expect(
      arrondi(
        ligneAB(
          [
            [100, 0],
            [0, 0],
          ],
          3,
        ),
      ),
    ).toEqual([
      [100, -3],
      [0, -3],
    ]);
  });

  it('AB sur un bord tracé au tracteur : droite moyenne des points', () => {
    const bord: XY[] = [
      [0, 0.2],
      [25, -0.2],
      [50, 0.2],
      [75, -0.2],
      [100, 0.2],
      [125, -0.2],
    ];
    const [a, b] = ligneAB(bord, 0);
    expect(Math.abs(a[1])).toBeLessThan(0.1);
    expect(Math.abs(b[1])).toBeLessThan(0.1);
    expect(a[0]).toBeCloseTo(0, 0);
    expect(b[0]).toBeCloseTo(125, 0);
  });

  it('courbe : chaque côté reste à la distance demandée', () => {
    const bord: XY[] = [
      [0, 0],
      [100, 0],
      [100, 100],
    ];
    // À gauche en allant vers l'Est puis vers le Nord : à l'intérieur du virage.
    expect(arrondi(courbeDecalee(bord, 5))).toEqual([
      [0, 5],
      [95, 5],
      [95, 100],
    ]);
    expect(arrondi(courbeDecalee(bord, -5))).toEqual([
      [0, -5],
      [105, -5],
      [105, 100],
    ]);
  });
});

describe('écriture des lignes de guidage', () => {
  it('écrit un LSG A="5" juste avant le contour de la parcelle, au format de la console', () => {
    const { td, etat } = preparer({ X: carre, Y: carre });
    const g: Guidage = {
      parcelle: 1,
      type: 'ab',
      nom: 'A=B essai_1',
      points: [plan.versLatLon([0, 3]), plan.versLatLon([100, 3])],
    };
    const texte = exporterEtat(td, { ...etat, guidages: [g] });
    const lignes = texte.split('\r\n');
    const debut = lignes.indexOf('<LSG A="5" B="A=B essai_1">');
    expect(lignes[debut - 1]).toMatch(/^<PFD A="PFD2"/);
    expect(lignes[debut + 1]).toMatch(/^<PNT A="2" C="\d+\.\d{13}" D="\d+\.\d{13}" E="0"\/>$/);
    expect(lignes[debut + 3]).toBe('</LSG>');
    expect(lignes[debut + 4]).toBe('<PLN A="1">');
    // Relu : la ligne est reconnue comme segment A="5", les contours sont inchangés.
    const relu = lireTaskData(texte);
    expect(relu.segmentsIgnores).toHaveLength(1);
    expect(etatInitial(relu).anneaux.map((a) => a.sommets.map(latLon))).toEqual(
      etat.anneaux.map((a) => a.sommets.map(latLon)),
    );
  });
});

describe('coins et côtés d’une parcelle', () => {
  const rectangle: XY[] = [
    [0, 0],
    [50, 0.3],
    [100, 0],
    [100, 60],
    [0, 60],
  ];

  it('trouve les 4 coins d’un rectangle, pas le point presque aligné', () => {
    expect(coins(rectangle, 30).map((c) => c.sommet)).toEqual([0, 2, 3, 4]);
    expect(cotesEntreCoins(5, coins(rectangle, 30))).toEqual([
      [0, 1, 2],
      [2, 3],
      [3, 4],
      [4, 0],
    ]);
  });

  it('un coin coupé par deux points proches compte comme un seul coin', () => {
    // Coin (100, 0) remplacé par deux points à 2 m l'un de l'autre, qui tournent de 45° chacun.
    const coupe: XY[] = [
      [0, 0],
      [99, 0],
      [100, 1.4],
      [100, 60],
      [0, 60],
    ];
    const trouves = coins(coupe, 60);
    expect(trouves).toHaveLength(4);
    // Le côté Est part du deuxième point du coin coupé.
    expect(cotesEntreCoins(5, trouves)).toContainEqual([2, 3]);
  });

  it('distingue un côté droit d’un côté courbe', () => {
    expect(
      estDroit(
        [
          [0, 0],
          [50, 0.3],
          [100, 0],
        ],
        0.5,
      ),
    ).toBe(true);
    expect(
      estDroit(
        [
          [0, 0],
          [50, 8],
          [100, 0],
        ],
        0.5,
      ),
    ).toBe(false);
  });
});
