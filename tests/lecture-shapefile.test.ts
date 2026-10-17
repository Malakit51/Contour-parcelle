import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { etatInitial, latLon } from '../src/edition/etat';
import { shapefileParcelles } from '../src/edition/shp';
import { dezipper } from '../src/formats/dezip';
import { lireShapefile } from '../src/formats/lecture-shapefile';
import { shapefilePolygones } from '../src/formats/shapefile';
import { crc32 } from '../src/formats/zip';
import { distanceExacte } from '../src/geometrie/plan';
import { lireTaskData } from '../src/isoxml/lecture';

const td = lireTaskData(readFileSync('tests/fixtures/console-anonyme.xml', 'utf8'));
const etat = etatInitial(td);

/** Archive .zip compressée (deflate), comme celles des autres logiciels. */
function zipDeflate(fichiers: { nom: string; octets: Uint8Array }[]): Uint8Array {
  const morceaux: Uint8Array[] = [];
  const centraux: Uint8Array[] = [];
  let pos = 0;
  for (const f of fichiers) {
    const nom = new TextEncoder().encode(f.nom);
    const comp = deflateRawSync(f.octets);
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0);
    l.writeUInt16LE(8, 8);
    l.writeUInt32LE(crc32(f.octets), 14);
    l.writeUInt32LE(comp.length, 18);
    l.writeUInt32LE(f.octets.length, 22);
    l.writeUInt16LE(nom.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc32(f.octets), 16);
    c.writeUInt32LE(comp.length, 20);
    c.writeUInt32LE(f.octets.length, 24);
    c.writeUInt16LE(nom.length, 28);
    c.writeUInt32LE(pos, 42);
    morceaux.push(l, nom, comp);
    centraux.push(c, nom);
    pos += 30 + nom.length + comp.length;
  }
  const taille = centraux.reduce((s, x) => s + x.length, 0);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(fichiers.length, 8);
  fin.writeUInt16LE(fichiers.length, 10);
  fin.writeUInt32LE(taille, 12);
  fin.writeUInt32LE(pos, 16);
  return new Uint8Array(Buffer.concat([...morceaux, ...centraux, fin]));
}

describe('lecture d’un shapefile', () => {
  it('relit l’export de l’éditeur : 30 parcelles, noms, GUID, zone exclue, au cm près', async () => {
    const z = shapefileParcelles(td, etat, () => 'à confirmer', 'parcelles');
    const f = await dezipper(z);
    expect([...f.keys()].sort()).toEqual([
      'parcelles.cpg',
      'parcelles.dbf',
      'parcelles.prj',
      'parcelles.shp',
      'parcelles.shx',
    ]);
    const dec = new TextDecoder();
    const lus = lireShapefile({
      shp: f.get('parcelles.shp')!,
      dbf: f.get('parcelles.dbf'),
      prj: dec.decode(f.get('parcelles.prj')),
      cpg: dec.decode(f.get('parcelles.cpg')),
    });
    expect(lus).toHaveLength(30);
    for (const [p, parcelle] of td.parcelles.entries()) {
      const lu = lus.find((l) => l.guid === parcelle.guid)!;
      expect(lu.nom).toBe(parcelle.nom);
      const ext = etat.anneaux.find((a) => a.parcelle === p && a.type === 1)!;
      const pts = ext.sommets.map(latLon);
      expect(lu.contour).toHaveLength(pts.length);
      // Chaque point lu est sur un point du contour d'origine (le sens a pu changer).
      for (const q of lu.contour)
        expect(Math.min(...pts.map((r) => distanceExacte(q, r)))).toBeLessThan(0.01);
    }
    expect(lus.find((l) => l.nom === '13 Jard')!.trous).toHaveLength(1);
    expect(lus.filter((l) => l.trous.length > 0)).toHaveLength(1);
  });

  it('archive compressée (deflate)', async () => {
    const octets = new TextEncoder().encode('Bonjour les parcelles '.repeat(50));
    const f = await dezipper(zipDeflate([{ nom: 'a/b.txt', octets }]));
    expect(f.get('a/b.txt')).toEqual(octets);
  });

  it('degrés sans .prj, nom pris dans un autre champ, encodage Windows', () => {
    const carre = [
      [4.0, 49.0],
      [4.0, 49.001],
      [4.001, 49.001],
      [4.001, 49.0],
    ] as [number, number][];
    const s = shapefilePolygones(
      [{ anneaux: [carre], valeurs: ['Îlot 3'] }],
      [{ nom: 'NUM_ILOT', type: 'C', longueur: 20 }],
      '',
    );
    // Le .dbf de l'éditeur est en UTF-8 : on le réécrit en Windows-1252 (« Î » sur un octet).
    const dbf = s.dbf.slice();
    const i = dbf.indexOf(0xc3);
    dbf.set([0xce, 0x6c, 0x6f, 0x74, 0x20, 0x33, 0x20], i);
    const [lu] = lireShapefile({ shp: s.shp, dbf });
    expect(lu!.nom).toBe('Îlot 3');
    expect(lu!.contour[0]).toEqual([49.0, 4.0]);
  });

  it('projection inconnue : refusée avec son nom', () => {
    const s = shapefilePolygones(
      [
        {
          anneaux: [
            [
              [0, 0],
              [0, 10],
              [10, 10],
            ],
          ],
          valeurs: ['x'],
        },
      ],
      [{ nom: 'NOM', type: 'C', longueur: 5 }],
      '',
    );
    expect(() =>
      lireShapefile({ shp: s.shp, prj: 'PROJCS["WGS_1984_UTM_Zone_31N",GEOGCS[...]]' }),
    ).toThrow(/UTM_Zone_31N/);
  });
});
