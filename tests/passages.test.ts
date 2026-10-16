import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { etatInitial, latLon } from '../src/edition/etat';
import { directionsDesCotes, evaluerDirection, proposerPassages } from '../src/geometrie/passages';
import { planLocal, type XY } from '../src/geometrie/plan';
import { lireTaskData } from '../src/isoxml/lecture';

// Rectangle de 200 m (Est-Ouest) sur 100 m, tourné dans le sens inverse des aiguilles d'une montre.
const R: XY[] = [
  [0, 0],
  [200, 0],
  [200, 100],
  [0, 100],
];

describe('directions candidates', () => {
  it('rectangle : deux directions, le long côté d’abord', () => {
    const d = directionsDesCotes(R);
    expect(d).toHaveLength(2);
    expect(d[0]!.longueur).toBeCloseTo(200, 3);
    expect(d[1]!.longueur).toBeCloseTo(100, 3);
  });
});

describe('passages et demi-tours', () => {
  const [longue, courte] = directionsDesCotes(R);

  it('sans tournière : 5 passages de 200 m dans le long, 10 de 100 m dans le court', () => {
    const a = evaluerDirection(R, [], longue!, [], { largeur: 20, tourniere: 0 });
    expect(a).toMatchObject({ passages: 5, demiTours: 4, decalage: 0, passagesCourts: 0 });
    expect(a.longueurPassages).toBeCloseTo(1000, 3);
    expect(a.cap).toBeCloseTo(90, 6);
    const b = evaluerDirection(R, [], courte!, [], { largeur: 20, tourniere: 0 });
    expect(b).toMatchObject({ passages: 10, demiTours: 9 });
    expect(b.cap).toBeCloseTo(0, 6);
  });

  it('avec 10 m de tournière : passages raccourcis de 10 m à chaque bout, tours de tournière comptés', () => {
    const a = evaluerDirection(R, [], longue!, [], { largeur: 20, tourniere: 10 });
    expect(a.passages).toBe(4);
    expect(a.longueurPassages).toBeCloseTo(4 * 180, 3);
    // 4 passages, 3 demi-tours d'un demi-cercle de 20 m, un tour de tournière (600 m).
    expect(a.longueurTotale).toBeCloseTo(720 + 3 * Math.PI * 10 + 600, 3);
    // Ligne AB : à 10 + 10 m du côté Sud, sur toute la longueur.
    expect(a.ab[0][1]).toBeCloseTo(20, 6);
    expect(a.ab[1][1]).toBeCloseTo(20, 6);
    expect(Math.abs(a.ab[1][0] - a.ab[0][0])).toBeCloseTo(200, 6);
  });

  it('la meilleure proposition est celle qui fait le moins de demi-tours', () => {
    const p = proposerPassages(R, [], [], { largeur: 20, tourniere: 0 });
    expect(p.map((x) => x.demiTours)).toEqual([4, 9]);
  });

  it('une zone exclue coupe les passages qui la traversent', () => {
    const trou: XY[] = [
      [90, 40],
      [110, 40],
      [110, 60],
      [90, 60],
    ];
    const a = evaluerDirection(R, [trou], longue!, [], { largeur: 20, tourniere: 0 });
    // Le passage au milieu (y = 50) est coupé en deux.
    expect(a.passages).toBe(6);
  });
});

describe('obstacles en bout d’outil', () => {
  const [longue] = directionsDesCotes(R);
  const reglages = { largeur: 20, tourniere: 0 };

  it('un poteau : les passages sont décalés pour qu’il tombe pile en bout d’outil', () => {
    // Sans décalage, les passages sont centrés à 10, 30, 50… : le poteau à 37 m tombe à 3 m du bout.
    const a = evaluerDirection(R, [], longue!, [[50, 37]], reglages);
    expect(a.decalage).toBeCloseTo(-3, 2);
    expect(a.obstacles[0]!.distanceBout).toBeCloseTo(0, 2);
  });

  it('poteaux alignés le long des passages : tous en bout d’outil', () => {
    const a = evaluerDirection(
      R,
      [],
      longue!,
      [
        [50, 37],
        [150, 37],
      ],
      reglages,
    );
    expect(a.obstacles.map((o) => o.distanceBout)).toEqual([0, 0]);
  });

  it('poteaux décalés de 7 m : le meilleur compromis (3,5 m chacun)', () => {
    const a = evaluerDirection(
      R,
      [],
      longue!,
      [
        [50, 37],
        [150, 44],
      ],
      reglages,
    );
    expect(Math.max(...a.obstacles.map((o) => o.distanceBout))).toBeCloseTo(3.5, 1);
  });

  it('un poteau dans la tournière ne compte pas', () => {
    const a = evaluerDirection(R, [], longue!, [[100, 4]], { largeur: 20, tourniere: 10 });
    expect(a.obstacles[0]!.dansTourniere).toBe(true);
    expect(a.decalage).toBe(0);
  });

  it('pulvé de 38 m : décalage de moins d’une demi-largeur', () => {
    const grand: XY[] = [
      [0, 0],
      [600, 0],
      [600, 300],
      [0, 300],
    ];
    const [d] = directionsDesCotes(grand);
    const a = evaluerDirection(grand, [], d!, [[300, 120]], { largeur: 38, tourniere: 0 });
    expect(Math.abs(a.decalage)).toBeLessThanOrEqual(19);
    expect(a.obstacles[0]!.distanceBout).toBeCloseTo(0, 2);
  });
});

describe('export de la console (anonymisé)', () => {
  it('chaque parcelle a au moins une proposition, avec des chiffres sensés', () => {
    const td = lireTaskData(readFileSync('tests/fixtures/console-anonyme.xml', 'utf8'));
    const etat = etatInitial(td);
    for (const a of etat.anneaux.filter((x) => x.type === 1)) {
      const plan = planLocal(latLon(a.sommets[0]!));
      const pts = a.sommets.map((s) => plan.versXY(latLon(s)));
      const p = proposerPassages(pts, [], [], { largeur: 24, tourniere: 24 });
      const nom = td.parcelles[a.parcelle]!.nom;
      expect(p.length, nom).toBeGreaterThan(0);
      for (const x of p) {
        expect(x.passages, nom).toBeGreaterThan(0);
        expect(x.longueurTotale, nom).toBeGreaterThan(x.longueurPassages);
      }
    }
  });
});
