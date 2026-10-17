import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { controler } from '../src/edition/controles';
import { couperParcelle } from '../src/edition/coupe';
import { etatInitial, surfaceEtat } from '../src/edition/etat';
import { exporterEtat, verifierRelecture } from '../src/edition/export';
import { fusionnerParcelles } from '../src/edition/fusion';
import { lireTaskData } from '../src/isoxml/lecture';
import { enMetres, preparer } from './outils';

describe('fusionner deux parcelles', () => {
  it('deux rectangles côte à côte : un seul contour, la deuxième retirée', () => {
    const { td, etat } = preparer({
      A: [
        [0, 0],
        [100, 0],
        [100, 50],
        [0, 50],
      ],
      B: [
        [100, 0],
        [200, 0],
        [200, 50],
        [100, 50],
      ],
    });
    const e = fusionnerParcelles(td, etat, 0, 1);
    expect(enMetres(e, 0)).toEqual([
      [0, 0],
      [100, 0],
      [200, 0],
      [200, 50],
      [100, 50],
      [0, 50],
    ]);
    expect(surfaceEtat(e, 0)).toBeCloseTo(10000, 0);
    expect(e.supprimees).toEqual([1]);
    const sortie = exporterEtat(td, e);
    expect(verifierRelecture(td, e, sortie)).toEqual([]);
    expect(lireTaskData(sortie).parcelles.map((p) => p.nom)).toEqual(['A']);
  });

  it('refuse deux parcelles sans limite commune', () => {
    const { td, etat } = preparer({
      A: [
        [0, 0],
        [100, 0],
        [100, 50],
        [0, 50],
      ],
      B: [
        [101, 0],
        [200, 0],
        [200, 50],
        [101, 50],
      ],
    });
    expect(() => fusionnerParcelles(td, etat, 0, 1)).toThrow(/limite commune/);
  });

  it('export de la console : couper 14 Jard puis refusionner redonne son contour et sa surface', () => {
    const td = lireTaskData(readFileSync('tests/fixtures/console-anonyme.xml', 'utf8'));
    const etat0 = etatInitial(td);
    const p = td.parcelles.findIndex((x) => x.nom === '14 Jard');
    const { etat: coupe, nouvelle } = couperParcelle(td, etat0, p, 2, 60, 'autre', '14 Jard B');
    const e = fusionnerParcelles(td, coupe, p, nouvelle);
    expect(Math.abs(surfaceEtat(e, p) - surfaceEtat(etat0, p))).toBeLessThan(1);
    expect(controler(td, e, [p]).filter((x) => x.grave)).toEqual([]);
    const sortie = exporterEtat(td, e);
    expect(verifierRelecture(td, e, sortie)).toEqual([]);
    expect(lireTaskData(sortie).parcelles).toHaveLength(30);
  });

  it('22 Huss et 23 Huss (limite commune du fichier) : une seule parcelle, surfaces additionnées', () => {
    const td = lireTaskData(readFileSync('tests/fixtures/console-anonyme.xml', 'utf8'));
    const etat0 = etatInitial(td);
    const a = td.parcelles.findIndex((x) => x.nom === '22 Huss');
    const b = td.parcelles.findIndex((x) => x.nom === '23 Huss');
    const e = fusionnerParcelles(td, etat0, a, b);
    expect(surfaceEtat(e, a)).toBeCloseTo(surfaceEtat(etat0, a) + surfaceEtat(etat0, b), -2);
    const sortie = exporterEtat(td, e);
    expect(verifierRelecture(td, e, sortie)).toEqual([]);
    expect(controler(td, e, [a]).filter((x) => x.grave)).toEqual([]);
  });
});

describe('fusion : limite commune avec des points d’un seul côté', () => {
  it('B a un point de plus sur la limite, A aussi un autre : fusion correcte', () => {
    const { td, etat } = preparer({
      A: [
        [0, 0],
        [100, 0],
        [100, 20],
        [100, 50],
        [0, 50],
      ],
      B: [
        [100, 0],
        [200, 0],
        [200, 50],
        [100, 50],
        [100, 35],
      ],
    });
    const e = fusionnerParcelles(td, etat, 0, 1);
    expect(enMetres(e, 0)).toEqual([
      [0, 0],
      [100, 0],
      [200, 0],
      [200, 50],
      [100, 50],
      [0, 50],
    ]);
    expect(surfaceEtat(e, 0)).toBeCloseTo(10000, 0);
  });
});
