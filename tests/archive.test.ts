import { readFileSync } from 'node:fs';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  ErreurArchive,
  estUnZip,
  ouvrirArchive,
  refaireArchive,
  taskdataDe,
} from '../src/isoxml/archive';

const xml = new Uint8Array(readFileSync('tests/fixtures/exemple.xml'));
const bin = Uint8Array.from({ length: 5000 }, (_, i) => (i * 37) % 256);

function exemple() {
  return zipSync({
    'TASKDATA/': new Uint8Array(),
    'TASKDATA/TASKDATA.XML': xml,
    'TASKDATA/GRD00001.BIN': bin,
    'TASKDATA/TASK-1.CM': strToU8('x'),
  });
}

describe('zip de la console', () => {
  it('trouve TASKDATA.XML dans un sous-dossier', () => {
    const zip = exemple();
    expect(estUnZip(zip)).toBe(true);
    expect(estUnZip(xml)).toBe(false);
    const a = ouvrirArchive(zip);
    expect(a.cheminTaskdata).toBe('TASKDATA/TASKDATA.XML');
    expect(taskdataDe(a)).toEqual(xml);
  });

  it('refait un zip identique sauf TASKDATA.XML', () => {
    const a = ouvrirArchive(exemple());
    const nouveau = strToU8('nouveau');
    const relu = unzipSync(refaireArchive(a, nouveau));
    expect(Object.keys(relu)).toEqual([
      'TASKDATA/TASKDATA.XML',
      'TASKDATA/GRD00001.BIN',
      'TASKDATA/TASK-1.CM',
    ]);
    expect(relu['TASKDATA/TASKDATA.XML']).toEqual(nouveau);
    expect(relu['TASKDATA/GRD00001.BIN']).toEqual(bin);
  });

  it('refuse un zip sans TASKDATA.XML', () => {
    expect(() => ouvrirArchive(zipSync({ 'a.txt': strToU8('a') }))).toThrow(ErreurArchive);
  });
});
