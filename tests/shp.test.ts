import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { etatInitial } from '../src/edition/etat';
import { shapefileParcelles } from '../src/edition/shp';
import { crc32 } from '../src/formats/zip';
import { lireTaskData } from '../src/isoxml/lecture';

describe('export shapefile', () => {
  it('crc32 connu', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('export de la console : 30 polygones dans un zip, en-têtes justes', () => {
    const td = lireTaskData(readFileSync('tests/fixtures/console-anonyme.xml', 'utf8'));
    const z = shapefileParcelles(td, etatInitial(td), () => 'à confirmer', 'parcelles');
    // Pour une vérification à la main avec un vrai lecteur de shapefile.
    if (process.env.SHP_SORTIE) writeFileSync(process.env.SHP_SORTIE, z);
    const v = new DataView(z.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    // Premier fichier : le .shp, avec son code 9994 et le type polygone (5).
    const nom = new TextDecoder().decode(z.slice(30, 30 + v.getUint16(26, true)));
    expect(nom).toBe('parcelles.shp');
    const shp = 30 + nom.length;
    expect(v.getInt32(shp, false)).toBe(9994);
    expect(v.getInt32(shp + 32, true)).toBe(5);
    // Fin de l'archive : 5 fichiers.
    expect(v.getUint16(z.length - 22 + 10, true)).toBe(5);
  });
});
