import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { etatInitial, latLon } from '../src/edition/etat';
import {
  directionDuSegment,
  directionsDesCotes,
  evaluerDirection,
  proposerPassages,
} from '../src/geometrie/passages';
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

describe('passages à dessiner', () => {
  it('rectangle : 5 segments horizontaux de 200 m, à 10, 30, 50, 70, 90 m du côté Sud', () => {
    const [longue] = directionsDesCotes(R);
    const a = evaluerDirection(R, [], longue!, [], { largeur: 20, tourniere: 0 });
    expect(a.lignes).toHaveLength(5);
    a.lignes.forEach(([p, q], k) => {
      expect(p[1]).toBeCloseTo(10 + 20 * k, 6);
      expect(q[1]).toBeCloseTo(10 + 20 * k, 6);
      expect(Math.abs(q[0] - p[0])).toBeCloseTo(200, 6);
    });
  });
});

describe('optimisation sur une parcelle de l’éditeur', () => {
  it('rectangle avec un poteau : ligne AB dans le long côté, poteau en bout d’outil', async () => {
    const { preparer, plan } = await import('./outils');
    const { optimiserParcelle, ligneDeProposition } = await import('../src/edition/optimisation');
    const { etat } = preparer({ R });
    const poteau = plan.versLatLon([50, 37]);
    const dehors = plan.versLatLon([500, 37]);
    const o = optimiserParcelle(etat, 0, [poteau, dehors], {
      nom: 'Pulvé 20 m',
      largeur: 20,
      tourniere: 0,
    })!;
    expect(o.obstacles).toEqual([poteau]);
    const meilleure = o.propositions[0]!;
    expect(meilleure.demiTours).toBe(4);
    expect(meilleure.obstacles[0]!.distanceBout).toBeCloseTo(0, 2);
    const g = ligneDeProposition(0, meilleure, o.plan, 'Pulvé 20 m 1');
    expect(g).toMatchObject({ parcelle: 0, type: 'ab', nom: 'Pulvé 20 m 1' });
    // Premier passage à 10 − 3 = 7 m du côté Sud.
    const [a, b] = g.points.map((q) => plan.versXY(q));
    expect(a![1]).toBeCloseTo(7, 1);
    expect(b![1]).toBeCloseTo(7, 1);
  });
});

describe('lignes de tournière', () => {
  it('pulvé 38 m, tournière 38 m : un tour à 19 m du bord, une ligne par côté, après la ligne AB', async () => {
    const { preparer, plan } = await import('./outils');
    const { optimiserParcelle, lignesOptimisees, lignesTourniere } =
      await import('../src/edition/optimisation');
    const grand: XY[] = [
      [0, 0],
      [600, 0],
      [600, 300],
      [0, 300],
    ];
    const { etat } = preparer({ G: grand });
    const outil = { nom: 'Pulvé 38 m', largeur: 38, tourniere: 38 };
    const tour = lignesTourniere(etat, 0, outil);
    expect(tour).toHaveLength(4);
    // Chaque ligne est à 19 m du côté qu'elle longe.
    const ys = tour.map((g) => g.points.map((q) => plan.versXY(q)));
    expect(ys[0]!.every(([, y]) => Math.abs(y - 19) < 0.01)).toBe(true);
    expect(ys[2]!.every(([, y]) => Math.abs(y - 281) < 0.01)).toBe(true);
    const o = optimiserParcelle(etat, 0, [], outil)!;
    const lignes = lignesOptimisees(etat, 0, o.propositions[0]!, o.plan, outil, true);
    expect(lignes.map((g) => g.nom)).toEqual([
      'Ligne AB Pulvé 38 m',
      'Fourrière Pulvé 38 m 1',
      'Fourrière Pulvé 38 m 2',
      'Fourrière Pulvé 38 m 3',
      'Fourrière Pulvé 38 m 4',
    ]);
    // Refaire l'optimisation remplace ces lignes (et les anciens noms « Pulvé 38 m 1 »), pas les autres.
    const { remplacerLignesOutil } = await import('../src/edition/optimisation');
    const autre = { ...lignes[0]!, nom: 'Semoir 4 m 1' };
    const ancienne = { ...lignes[0]!, nom: 'Pulvé 38 m 1' };
    const e = remplacerLignesOutil(
      { ...etat, guidages: [autre, ancienne, ...lignes] },
      0,
      outil,
      lignes,
    );
    expect(e.guidages!.map((g) => g.nom)).toEqual(['Semoir 4 m 1', ...lignes.map((g) => g.nom)]);
    expect(lignesOptimisees(etat, 0, o.propositions[0]!, o.plan, outil, false)).toHaveLength(1);
    // Semoir 4 m avec 12 m de tournière : 3 tours (à 2, 6 et 10 m).
    expect(lignesTourniere(etat, 0, { nom: 'S', largeur: 4, tourniere: 12 })).toHaveLength(12);
    expect(lignesTourniere(etat, 0, { nom: 'S', largeur: 4, tourniere: 0 })).toEqual([]);
  });
});

describe('passages parallèles à un côté touché', () => {
  it('un segment du côté Sud (un peu courbe) : tout le côté, redressé', () => {
    const c: XY[] = [
      [0, 0],
      [50, 0.3],
      [100, 0],
      [150, -0.2],
      [200, 0],
      [200, 100],
      [0, 100],
    ];
    const d = directionDuSegment(c, 2);
    expect(d.sommets).toEqual([0, 1, 2, 3, 4]);
    expect(Math.abs(d.b[1] - d.a[1])).toBeLessThan(0.5);
    expect(d.longueur).toBeCloseTo(200, 0);
    const p = evaluerDirection(c, [], d, [], { largeur: 20, tourniere: 0 });
    expect(p.cap).toBeCloseTo(90, 0);
  });

  it('côté Est du rectangle : 10 passages Nord-Sud, à côté des propositions', async () => {
    const { preparer } = await import('./outils');
    const { optimiserParcelle } = await import('../src/edition/optimisation');
    const { etat } = preparer({ R });
    const outil = { nom: 'Pulvé 20 m', largeur: 20, tourniere: 0 };
    expect(optimiserParcelle(etat, 0, [], outil)!.manuelle).toBeNull();
    const o = optimiserParcelle(etat, 0, [], outil, 30, 1)!;
    expect(o.manuelle).toMatchObject({ passages: 10, demiTours: 9, sommets: [1, 2] });
    expect(o.manuelle!.cap).toBeCloseTo(0, 6);
    expect(o.manuelle!.longueurPassages).toBeCloseTo(1000, 3);
    // Les propositions calculées restent (le long côté d'abord).
    expect(o.propositions[0]!.demiTours).toBe(4);
  });
});

describe('passages des deux côtés de la ligne AB', () => {
  it('parcelle en L, côté du creux : les passages couvrent aussi la partie derrière la ligne AB', () => {
    const L: XY[] = [
      [0, 0],
      [200, 0],
      [200, 50],
      [100, 50],
      [100, 100],
      [0, 100],
    ];
    const d = directionDuSegment(L, 3);
    const p = evaluerDirection(L, [], d, [], { largeur: 20, tourniere: 0 });
    // 5 passages de 100 m à gauche du creux, 5 de 50 m à droite.
    expect(p.passages).toBe(10);
    expect(p.longueurPassages).toBeCloseTo(750, 3);
    const xs = p.lignes.map(([a]) => Math.round(a[0])).sort((x, y) => x - y);
    expect(xs).toEqual([10, 30, 50, 70, 90, 110, 130, 150, 170, 190]);
  });

  it('obstacle qui pousse les passages vers l’intérieur : la bande laissée après la tournière est couverte', () => {
    const [longue] = directionsDesCotes(R);
    // Tournière de 20 m, poteau à 45 m du bord Sud : passages décalés de +5 m (centres à 35, 55,
    // 75) ; la bande de 20 à 25 m serait oubliée sans un passage de plus, centré à 15 m.
    const a = evaluerDirection(R, [], longue!, [[100, 45]], { largeur: 20, tourniere: 20 });
    expect(a.decalage).toBeCloseTo(5, 2);
    expect(a.obstacles[0]!.distanceBout).toBeCloseTo(0, 2);
    const ys = a.lignes.map(([p]) => Math.round(p[1] * 100) / 100);
    expect(ys).toEqual([15, 35, 55, 75]);
  });
});
