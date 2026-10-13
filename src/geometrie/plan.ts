// Passage degrés <-> mètres sur un plan local tangent à l'ellipsoïde WGS84.
//
// Sur quelques kilomètres, l'erreur reste de l'ordre du millimètre : largement suffisant pour
// des décalages en centimètres et des parcelles de quelques hectares.

export type LatLon = readonly [lat: number, lon: number];
export type XY = readonly [x: number, y: number];

const A = 6378137; // demi-grand axe WGS84 (m)
const E2 = 6.69437999014e-3; // carré de l'excentricité WGS84

export interface Plan {
  versXY(p: LatLon): XY;
  versLatLon(p: XY): LatLon;
}

/** Plan local centré sur `origine` : x vers l'Est, y vers le Nord, en mètres. */
export function planLocal(origine: LatLon): Plan {
  const [lat0, lon0] = origine;
  const phi = (lat0 * Math.PI) / 180;
  const w = 1 - E2 * Math.sin(phi) ** 2;
  const rayonMeridien = (A * (1 - E2)) / w ** 1.5;
  const rayonNormal = A / Math.sqrt(w);
  const mParDegLat = (rayonMeridien * Math.PI) / 180;
  const mParDegLon = (rayonNormal * Math.cos(phi) * Math.PI) / 180;
  return {
    versXY: ([lat, lon]) => [(lon - lon0) * mParDegLon, (lat - lat0) * mParDegLat],
    versLatLon: ([x, y]) => [lat0 + y / mParDegLat, lon0 + x / mParDegLon],
  };
}

/** Aire signée (m²) d'un anneau ouvert ou fermé : positive si les points tournent dans le sens inverse des aiguilles d'une montre. */
export function aireSignee(anneau: readonly XY[]): number {
  let s = 0;
  for (let i = 0; i < anneau.length; i++) {
    const [x1, y1] = anneau[i]!;
    const [x2, y2] = anneau[(i + 1) % anneau.length]!;
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

export function distance(a: XY, b: XY): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}
