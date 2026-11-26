import { describe, expect, it } from 'vitest';
import { alignements, niveauAlignement } from '../src/edition/alignement';
import { preparer } from './outils';

describe('alignement des points voisins d’un coin', () => {
  it('point du bord pile dans l’axe, l’autre décalé de 20 cm', () => {
    const { etat } = preparer({
      A: [
        [0, 0],
        [50, 0],
        [100, 0],
        [100, 50],
        [0, 50],
        [0, 25.2],
      ],
    });
    // Coin (100, 0) : voisin (50, 0) aligné avec (0, 0).
    const a = alignements(etat, { anneau: 0, sommet: 2 });
    const avant = a.find((x) => !x.apres)!;
    expect(avant.point).toBe(1);
    expect(avant.ecart).toBeLessThan(0.01);
    expect(niveauAlignement(avant.ecart)).toBe('aligne');
    // Coin (0, 50) : voisin (0, 25.2) face à (0, 0), décalé de 0 en x… aligné ; voisin (100, 50) est
    // un vrai coin (écart > 5 m), pas d'indicateur.
    const b = alignements(etat, { anneau: 0, sommet: 4 });
    expect(b.map((x) => x.point)).toEqual([5]);
  });

  it('décalage de 20 cm : orange', () => {
    const { etat } = preparer({
      A: [
        [0, 0],
        [50, 0.2],
        [100, 0],
        [100, 50],
        [0, 50],
      ],
    });
    const a = alignements(etat, { anneau: 0, sommet: 2 }).find((x) => !x.apres)!;
    expect(a.ecart).toBeCloseTo(0.2, 2);
    expect(niveauAlignement(a.ecart)).toBe('presque');
  });
});
