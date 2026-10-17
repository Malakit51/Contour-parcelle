import { describe, expect, it } from 'vitest';
import { rectangleAutour, tuileDe, tuilesCouvrant } from '../src/geometrie/tuiles';

describe('tuiles de la photo', () => {
  it('numérotation Web Mercator (comme OpenStreetMap / la Géoplateforme « PM »)', () => {
    // Paris (Notre-Dame) au zoom 12 : tuile 2074 / 1409.
    expect(tuileDe([48.853, 2.3499], 12)).toEqual({ z: 12, x: 2074, y: 1409 });
    expect(tuileDe([0, 0], 1)).toEqual({ z: 1, x: 1, y: 1 });
  });

  it('un rectangle de 500 m : quelques tuiles par zoom, sans doublon entre deux parcelles', () => {
    const r = rectangleAutour(
      [
        [49, 4],
        [49.0045, 4.0068],
      ],
      0,
    );
    const t = tuilesCouvrant([r, r], 13, 19);
    expect(new Set(t.map((x) => `${x.z}/${x.x}/${x.y}`)).size).toBe(t.length);
    const z19 = t.filter((x) => x.z === 19).length;
    // Une tuile fait environ 50 m au zoom 19 à cette latitude : une centaine de tuiles.
    expect(z19).toBeGreaterThan(80);
    expect(z19).toBeLessThan(200);
    expect(t.filter((x) => x.z === 13)).toHaveLength(1);
  });
});
