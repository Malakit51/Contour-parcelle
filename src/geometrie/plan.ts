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

/**
 * Distance (m) entre deux points, mesurée dans un plan local centré entre les deux : précise au
 * millimètre sur quelques kilomètres. (`distanceM` de l'état est une approximation plus rapide,
 * faite pour les tolérances de quelques centimètres.)
 */
export function distanceExacte(a: LatLon, b: LatLon): number {
  const plan = planLocal([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  const [xa, ya] = plan.versXY(a);
  const [xb, yb] = plan.versXY(b);
  return Math.hypot(xb - xa, yb - ya);
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

/** Intersection des droites (p + t·u) et (q + s·w). Renvoie null si elles sont presque parallèles. */
export function intersection(p: XY, u: XY, q: XY, w: XY, sinMin = 1e-9): XY | null {
  const det = u[0] * w[1] - u[1] * w[0];
  if (Math.abs(det) <= sinMin * Math.hypot(...u) * Math.hypot(...w)) return null;
  const t = ((q[0] - p[0]) * w[1] - (q[1] - p[1]) * w[0]) / det;
  return [p[0] + t * u[0], p[1] + t * u[1]];
}

/** Position de `p` par rapport au segment [a, b] : t (0 en a, 1 en b) et distance à la droite (m). */
export function positionSurSegment(p: XY, a: XY, b: XY): { t: number; ecart: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  const ecart = Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / Math.sqrt(l2);
  return { t, ecart };
}

/** Vrai si le point `p` est à l'intérieur du polygone `pts` (règle pair-impair). */
export function pointDansPolygone(p: XY, pts: readonly XY[]): boolean {
  let dedans = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!;
    const [xj, yj] = pts[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      dedans = !dedans;
    }
  }
  return dedans;
}

/** Distance (m) du point `p` au segment [a, b]. */
export function distancePointSegment(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
