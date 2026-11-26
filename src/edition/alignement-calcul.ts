import { type XY } from '../geometrie/plan';

/** Distance de `p` à la droite (a, b), ou null si a et b sont à moins de 1 m l'un de l'autre. */
export function distancePointDroite(p: XY, a: XY, b: XY): number | null {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (l < 1) return null;
  return Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / l;
}
