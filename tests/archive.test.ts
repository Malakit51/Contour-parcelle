import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { zipDossierTaskdata } from '../src/isoxml/archive';

describe('export pour la clé', () => {
  it('TASKDATA.zip ne contient que TASKDATA.XML, à l’identique', () => {
    const xml = new Uint8Array(readFileSync('tests/fixtures/exemple.xml'));
    const contenu = unzipSync(zipDossierTaskdata(xml));
    expect(Object.keys(contenu)).toEqual(['TASKDATA.XML']);
    expect(contenu['TASKDATA.XML']).toEqual(xml);
  });
});
