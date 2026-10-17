// Tuiles de la photo aérienne (Web Mercator, comme la Géoplateforme en « PM ») qui couvrent des
// zones données, pour les enregistrer sur le téléphone.

import type { LatLon } from './plan';

export interface Tuile {
  z: number;
  x: number;
  y: number;
}

/** Tuile qui contient le point, au zoom z. */
export function tuileDe(p: LatLon, z: number): Tuile {
  const n = 2 ** z;
  const lat = (p[0] * Math.PI) / 180;
  const x = Math.floor(((p[1] + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n);
  return { z, x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)) };
}

/**
 * Tuiles des zooms `zMin` à `zMax` qui couvrent chaque rectangle [sud-ouest, nord-est] (sans
 * doublon). Les rectangles sont à élargir avant (marge autour des parcelles).
 */
export function tuilesCouvrant(
  rectangles: readonly [LatLon, LatLon][],
  zMin: number,
  zMax: number,
): Tuile[] {
  const vues = new Set<string>();
  const tuiles: Tuile[] = [];
  for (let z = zMin; z <= zMax; z++) {
    for (const [so, ne] of rectangles) {
      const a = tuileDe([ne[0], so[1]], z); // nord-ouest : plus petits x et y
      const b = tuileDe([so[0], ne[1]], z); // sud-est
      for (let x = a.x; x <= b.x; x++) {
        for (let y = a.y; y <= b.y; y++) {
          const cle = `${z}/${x}/${y}`;
          if (vues.has(cle)) continue;
          vues.add(cle);
          tuiles.push({ z, x, y });
        }
      }
    }
  }
  return tuiles;
}

/** Rectangle autour des points, élargi de `marge` mètres de chaque côté. */
export function rectangleAutour(points: readonly LatLon[], marge: number): [LatLon, LatLon] {
  const lats = points.map((p) => p[0]);
  const lons = points.map((p) => p[1]);
  const dLat = marge / 111_320;
  const latMoy = (Math.min(...lats) + Math.max(...lats)) / 2;
  const dLon = marge / (111_320 * Math.cos((latMoy * Math.PI) / 180));
  return [
    [Math.min(...lats) - dLat, Math.min(...lons) - dLon],
    [Math.max(...lats) + dLat, Math.max(...lons) + dLon],
  ];
}
