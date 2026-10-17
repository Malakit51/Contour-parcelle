import { describe, expect, it } from 'vitest';
import { versLambert93 } from '../src/geometrie/lambert93';

describe('Lambert 93', () => {
  it('mêmes coordonnées que PROJ (pyproj, EPSG:4326 → 2154) au millimètre', () => {
    const attendus: [number, number, number, number][] = [
      [46.5, 3, 700000.0, 6600000.0],
      [49.0, 4.0, 773169.837, 6878250.027],
      [48.853, 2.3499, 652296.973, 6861636.359],
      [43.3, -1.5, 334836.342, 6254945.127],
      [50.9, 7.9, 1045193.721, 7100030.127],
    ];
    for (const [lat, lon, x, y] of attendus) {
      const [cx, cy] = versLambert93([lat, lon]);
      expect(cx).toBeCloseTo(x, 2);
      expect(cy).toBeCloseTo(y, 2);
    }
  });
});
