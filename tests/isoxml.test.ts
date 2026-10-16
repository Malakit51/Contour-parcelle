import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { comparer } from '../src/isoxml/comparaison';
import { exporterTaskData } from '../src/isoxml/ecriture';
import { lireTaskData } from '../src/isoxml/lecture';
import { decoder, encoder } from '../src/isoxml/octets';
import { surfaceParcelle } from '../src/isoxml/parcelles';

function charger(chemin: string) {
  const octets = new Uint8Array(readFileSync(chemin));
  return { octets, td: lireTaskData(decoder(octets)) };
}

describe('fichier d’exemple', () => {
  const { octets, td } = charger('tests/fixtures/exemple.xml');

  it('import puis export sans modification = fichier identique octet pour octet', () => {
    expect(encoder(exporterTaskData(td, { retirerSegments: false }))).toEqual(octets);
  });

  it('lit les parcelles, leurs anneaux et les noms avec entités', () => {
    expect(td.parcelles.map((p) => p.nom)).toEqual(['10 Est & Ouest', '11voisin']);
    const [p1, p2] = td.parcelles;
    expect(p1!.anneaux.map((a) => [a.type, a.points.length])).toEqual([
      [1, 5],
      [2, 4],
    ]);
    expect(p2!.anneaux.map((a) => [a.type, a.points.length])).toEqual([[1, 5]]);
    expect(p1!.surface?.texte).toBe('40000');
  });

  it('retire les segments LSG A="5" et rien d’autre', () => {
    const diffs = comparer(td.texte, exporterTaskData(td));
    expect(diffs.map((d) => [d.ligneAvant, d.ligneApres])).toEqual([
      [6, null],
      [7, null],
      [8, null],
      [9, null],
    ]);
    expect(diffs[0]!.avant).toBe('<LSG A="5" B="A=B 2026.01.01_10:00_1">\r\n');
  });

  it('modifie un point et la surface en gardant le nombre de décimales', () => {
    const p1 = td.parcelles[0]!;
    const exterieur = p1.anneaux[0]!.points[1]!;
    const interieur = p1.anneaux[1]!.points[1]!;
    const nouveau = exporterTaskData(td, {
      retirerSegments: false,
      points: [
        { point: exterieur, lat: 45.000001234, lon: 2.00254 },
        { point: interieur, lat: 45.0005004, lon: 2.0006 },
      ],
      surfaces: [{ parcelle: p1, m2: 39876.6 }],
    });
    expect(comparer(td.texte, nouveau).map((d) => d.apres)).toEqual([
      '<PFD A="PFD1" B="00000000000000000000000000000001" C="10 Est &amp; Ouest" D="39877" E="CTR1" F="FRM1">\r\n',
      '<PNT A="2" C="45.0000012340000" D="2.0025400000000"/>\r\n',
      '<PNT A="2" C="45.0005004" D="2.0006000"/>\r\n',
    ]);
  });

  it('calcule la surface : contour extérieur moins la zone exclue', () => {
    // 0,00254° de longitude à 45° N ≈ 200,4 m ; 0,0018° de latitude ≈ 199,9 m.
    expect(surfaceParcelle(td.parcelles[1]!)).toBeCloseTo(40060, -2);
    // Zone exclue : triangle rectangle de 7,9 m × 11,1 m ≈ 44 m².
    const exclu = surfaceParcelle(td.parcelles[1]!) - surfaceParcelle(td.parcelles[0]!);
    expect(exclu).toBeCloseTo(44, 0);
  });
});

// Fichier réel, présent seulement sur la machine de développement (jamais dans le dépôt).
// Export de la console du 13/10/2026, anonymisé (déplacé, tourné, identités remplacées).
const REEL = 'tests/fixtures/console-anonyme.xml';

describe.runIf(existsSync(REEL))('export réel de la console', () => {
  // Lecture paresseuse : le corps du describe s'exécute même quand le fichier est absent.
  let octets: Uint8Array;
  let td: ReturnType<typeof lireTaskData>;
  beforeAll(() => ({ octets, td } = charger(REEL)));

  it('import puis export sans modification = fichier identique octet pour octet', () => {
    expect(encoder(exporterTaskData(td, { retirerSegments: false }))).toEqual(octets);
  });

  it('30 parcelles avec un contour fermé', () => {
    expect(td.parcelles).toHaveLength(30);
    for (const p of td.parcelles) {
      for (const a of p.anneaux) {
        expect([a.points[0]!.lat, a.points[0]!.lon]).toEqual([
          a.points.at(-1)!.lat,
          a.points.at(-1)!.lon,
        ]);
      }
    }
  });

  it('l’export retire seulement les lignes des segments LSG A="5"', () => {
    const diffs = comparer(td.texte, exporterTaskData(td));
    expect(diffs.every((d) => d.apres === null)).toBe(true);
    for (const d of diffs) {
      expect(d.avant).toMatch(
        /^(<LSG A="5"[^>]*>|<PNT A="2" C="[-\d.]+" D="[-\d.]+" E="0"\/>|<\/LSG>)\r\n$/,
      );
    }
    expect(diffs).toHaveLength(td.segmentsIgnores.length * 4);
  });

  it('la surface calculée est proche de la surface D du fichier', () => {
    for (const p of td.parcelles) {
      const d = Number(p.surface!.texte);
      expect(Math.abs(surfaceParcelle(p) - d) / d, p.nom).toBeLessThan(0.001);
    }
  });
});
