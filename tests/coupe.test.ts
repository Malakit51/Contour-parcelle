import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { controler } from '../src/edition/controles';
import { apercuCoupe, couperParcelle } from '../src/edition/coupe';
import { etatInitial, latLon, sommetsEn, surfaceEtat } from '../src/edition/etat';
import { exporterEtat, nouvelleSurface, verifierRelecture } from '../src/edition/export';
import { lireTaskData } from '../src/isoxml/lecture';
import { type XY } from '../src/geometrie/plan';
import { enMetres, preparer } from './outils';

const R: XY[] = [
  [0, 0],
  [200, 0],
  [200, 100],
  [0, 100],
];

describe('couper une parcelle parallèlement à un côté', () => {
  it('rectangle, côté Sud, à 30 m : 6 000 m² côté bord, 14 000 de l’autre ; ligne commune', () => {
    const { td, etat } = preparer({ R });
    const a = apercuCoupe(etat, 0, 0, { distance: 30 });
    expect(a.surfaceBord).toBeCloseTo(6000, 0);
    expect(a.surfaceAutre).toBeCloseTo(14000, 0);
    // Pour une surface : la distance qui la donne.
    expect(apercuCoupe(etat, 0, 0, { surface: 5000 }).distance).toBeCloseTo(25, 3);
    const { etat: e, nouvelle } = couperParcelle(
      td,
      etat,
      0,
      0,
      30,
      'autre',
      'R Sud',
      'b'.repeat(32),
    );
    expect(nouvelle).toBe(1);
    // Le premier point du fichier (0, 0) part avec l'autre morceau : le premier bout de la coupe
    // prend sa ligne « start ».
    expect(enMetres(e, 0)).toEqual([
      [200, 30],
      [200, 100],
      [0, 100],
      [0, 30],
    ]);
    expect(e.anneaux[0]!.sommets[0]!.origine).toBe(etat.anneaux[0]!.sommets[0]!.origine);
    expect(surfaceEtat(e, 0)).toBeCloseTo(14000, 0);
    expect(surfaceEtat(e, 1)).toBeCloseTo(6000, 0);
    // Les deux bouts de la coupe sont communs aux deux parcelles.
    const communs = e.anneaux[0]!.sommets.filter((s) =>
      sommetsEn(e, latLon(s)).some((x) => e.anneaux[x.anneau]!.parcelle === 1),
    );
    expect(communs).toHaveLength(2);
    expect(controler(td, e, [0, 1])).toEqual([]);
    const sortie = exporterEtat(td, e);
    expect(verifierRelecture(td, e, sortie)).toEqual([]);
    expect(lireTaskData(sortie).parcelles.map((p) => p.nom)).toEqual(['R', 'R Sud']);
  });

  it('refuse une distance hors de la parcelle, un nom déjà pris', () => {
    const { td, etat } = preparer({ R });
    expect(() => apercuCoupe(etat, 0, 0, { distance: 150 })).toThrow(/ne traverse pas/);
    expect(() => couperParcelle(td, etat, 0, 0, 30, 'bord', 'r')).toThrow(/déjà/);
  });

  it('export de la console : 13 Jard coupée, sa zone exclue suit son morceau', () => {
    const texte = readFileSync('tests/fixtures/console-anonyme.xml', 'utf8');
    const td = lireTaskData(texte);
    const etat = etatInitial(td);
    const p = td.parcelles.findIndex((x) => x.nom === '13 Jard');
    const X = etat.anneaux.findIndex((a) => a.parcelle === p && a.type === 1);
    // Côté le plus long du contour.
    const pts = etat.anneaux[X]!.sommets.map(latLon);
    let seg = 0;
    let lmax = 0;
    pts.forEach((q, k) => {
      const r = pts[(k + 1) % pts.length]!;
      const l = Math.hypot(q[0] - r[0], (q[1] - r[1]) * Math.cos((q[0] * Math.PI) / 180));
      if (l > lmax) [lmax, seg] = [l, k];
    });
    const total = surfaceEtat(etat, p);
    const a = apercuCoupe(etat, p, seg, { surface: total / 3 });
    let e;
    try {
      e = couperParcelle(td, etat, p, seg, a.distance, 'autre', '13 Jard B').etat;
    } catch {
      // La zone exclue est sur la ligne : on coupe un peu plus loin.
      e = couperParcelle(td, etat, p, seg, a.distance + 30, 'autre', '13 Jard B').etat;
    }
    const n = td.parcelles.length - 1;
    // À quelques m² près sur 22 ha (calculs dans des plans locaux différents).
    expect(Math.abs(surfaceEtat(e, p) + surfaceEtat(e, n) - total)).toBeLessThan(50);
    const D = Number(td.parcelles[p]!.surface!.texte);
    expect((nouvelleSurface(td, e, p)! + nouvelleSurface(td, e, n)!) / D).toBeCloseTo(1, 3);
    expect(controler(td, e, [p, n]).filter((x) => x.grave)).toEqual([]);
    const sortie = exporterEtat(td, e);
    expect(verifierRelecture(td, e, sortie)).toEqual([]);
    const relu = lireTaskData(sortie);
    const zones = relu.parcelles.flatMap((x) =>
      x.anneaux.filter((r) => r.type === 2).map(() => x.nom),
    );
    expect(zones).toHaveLength(1);
  });
});

describe('coupe d’une parcelle qui a une voisine', () => {
  it('le bout de la coupe sur la limite commune est ajouté chez la voisine ; aucune alerte', () => {
    const { td, etat } = preparer({
      R,
      V: [
        [200, 0],
        [300, 0],
        [300, 100],
        [200, 100],
      ],
    });
    // Coupe parallèle au côté Sud, à 40 m : la ligne traverse la limite commune avec V (x = 200).
    const { etat: e, nouvelle } = couperParcelle(td, etat, 0, 0, 40, 'autre', 'R Sud');
    // V a reçu le point (200, 40), commun aux trois.
    expect(enMetres(e, 1)).toContainEqual([200, 40]);
    expect(controler(td, e, [0, 1, nouvelle])).toEqual([]);
    expect(verifierRelecture(td, e, exporterEtat(td, e))).toEqual([]);
  });

  it('la limite commune passe entièrement au morceau coupé : pas d’alerte « limite perdue »', () => {
    const { td, etat } = preparer({
      R,
      V: [
        [0, -50],
        [200, -50],
        [200, 0],
        [0, 0],
      ],
    });
    const { etat: e, nouvelle } = couperParcelle(td, etat, 0, 2, 70, 'autre', 'R Sud');
    // Le morceau Sud (y < 30) a la limite commune avec V ; R garde le Nord.
    expect(controler(td, e, [0, 1, nouvelle])).toEqual([]);
  });
});

describe('contrôle : zone exclue dans une autre', () => {
  it('signalé, que la grande soit avant ou après la petite', async () => {
    const { ajouterZoneExclue } = await import('../src/edition/zones-exclues');
    const { plan } = await import('./outils');
    const { td, etat } = preparer({ R });
    const carre = (x: number, y: number, c: number) =>
      (
        [
          [x, y],
          [x + c, y],
          [x + c, y + c],
          [x, y + c],
        ] as XY[]
      ).map((q) => plan.versLatLon(q));
    const petite = ajouterZoneExclue(etat, 0, carre(50, 40, 10));
    // On met la grande autour à la main (ajouterZoneExclue la refuserait).
    const grande = ajouterZoneExclue(etat, 0, carre(20, 20, 60)).anneaux.at(-1)!;
    const e = { ...petite, anneaux: [...petite.anneaux, grande] };
    expect(controler(td, e, [0]).some((x) => /zone exclue/.test(x.message))).toBe(true);
  });
});
