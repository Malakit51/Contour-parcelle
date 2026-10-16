import { describe, expect, it } from 'vitest';
import { collerBord, modeleLePlusProche } from '../src/edition/collage';
import { controler } from '../src/edition/controles';
import { latLon, sommetsEn, surfaceEtat } from '../src/edition/etat';
import { exporterEtat, verifierRelecture } from '../src/edition/export';
import { ErreurEdition } from '../src/edition/operations';
import { type XY } from '../src/geometrie/plan';
import { enMetres, preparer } from './outils';

const A: XY[] = [
  [0, 0],
  [100, 0],
  [100, 50],
  [0, 50],
];
const bordEst = { anneau: 0, debut: 1, fin: 2, aRebours: false };

/** Chaque sommet du bord recollé (x ≥ 90) est commun avec B. */
function sommetsCommunsAvecB(etat: ReturnType<typeof preparer>['etat']) {
  return etat.anneaux[0]!.sommets.filter((_, i) => enMetres(etat, 0)[i]![0]! > 90).every((s) =>
    sommetsEn(etat, latLon(s)).some((r) => r.anneau === 1),
  );
}

describe('coller un bord sur la parcelle voisine', () => {
  it('bande vide de 2 m : A reprend la limite de B, avec ses points intermédiaires', () => {
    const { td, etat } = preparer({
      A,
      B: [
        [102, 0],
        [200, 0],
        [200, 50],
        [102, 50],
        [101, 25],
      ],
    });
    expect(modeleLePlusProche(etat, bordEst)).toBe(1);
    const r = collerBord(etat, bordEst, 1);
    expect(enMetres(r.etat, 0)).toEqual([
      [0, 0],
      [102, 0],
      [101, 25],
      [102, 50],
      [0, 50],
    ]);
    // B ne bouge pas.
    expect(r.etat.anneaux[1]).toEqual(etat.anneaux[1]);
    expect(r.bilan).toMatchObject({ avant: 4, apres: 5, ajoutsModele: 0 });
    expect(r.bilan.ecartMax).toBeCloseTo(2, 2);
    expect(surfaceEtat(r.etat, 0) - surfaceEtat(etat, 0)).toBeCloseTo(75, 1);
    expect(sommetsCommunsAvecB(r.etat)).toBe(true);
    // Plus aucune alerte de limite commune ou de chevauchement.
    expect(controler(td, r.etat, [0, 1])).toEqual([]);
  });

  it('les bouts tombent au milieu des limites de B : ils y sont ajoutés, B garde sa surface', () => {
    const { td, etat } = preparer({
      A,
      B: [
        [102, -20],
        [200, -20],
        [200, 80],
        [102, 80],
      ],
    });
    const r = collerBord(etat, bordEst, 1);
    expect(enMetres(r.etat, 0)).toEqual([
      [0, 0],
      [102, 0],
      [102, 50],
      [0, 50],
    ]);
    expect(r.bilan.ajoutsModele).toBe(2);
    expect(enMetres(r.etat, 1)).toEqual([
      [102, -20],
      [200, -20],
      [200, 80],
      [102, 80],
      [102, 50],
      [102, 0],
    ]);
    expect(surfaceEtat(r.etat, 1)).toBeCloseTo(surfaceEtat(etat, 1), 3);
    expect(sommetsCommunsAvecB(r.etat)).toBe(true);
    expect(controler(td, r.etat, [0, 1])).toEqual([]);
  });

  it('chevauchement : A recule jusqu’à la limite de B', () => {
    const { etat } = preparer({
      A,
      B: [
        [97, -20],
        [200, -20],
        [200, 80],
        [97, 80],
      ],
    });
    const r = collerBord(etat, bordEst, 1);
    expect(enMetres(r.etat, 0)).toEqual([
      [0, 0],
      [97, 0],
      [97, 50],
      [0, 50],
    ]);
  });

  it('le premier point du fichier est dans le bord : sa ligne « start » est gardée', () => {
    const { td, etat } = preparer({
      A: [
        [100, 25],
        [100, 50],
        [0, 50],
        [0, 0],
        [100, 0],
      ],
      B: [
        [102, 0],
        [200, 0],
        [200, 50],
        [102, 50],
      ],
    });
    // Bord de (100, 50) à (100, 0) en passant par (100, 25), le premier point.
    const r = collerBord(etat, { anneau: 0, debut: 1, fin: 4, aRebours: true }, 1);
    // Comme pour une suppression : le point qui suit l'ancien premier point prend sa ligne.
    expect(enMetres(r.etat, 0)).toEqual([
      [102, 50],
      [0, 50],
      [0, 0],
      [102, 0],
    ]);
    expect(r.etat.anneaux[0]!.sommets[0]!.origine).toBe(etat.anneaux[0]!.sommets[0]!.origine);
    const texte = exporterEtat(td, r.etat);
    expect(verifierRelecture(td, r.etat, texte)).toEqual([]);
  });

  it('export d’un collage avec points ajoutés : relu point pour point', () => {
    const { td, etat } = preparer({
      A,
      B: [
        [102, -20],
        [200, -20],
        [200, 80],
        [102, 80],
        [101, 25],
      ],
    });
    const r = collerBord(etat, bordEst, 1);
    const texte = exporterEtat(td, r.etat);
    expect(verifierRelecture(td, r.etat, texte)).toEqual([]);
  });

  it('refuse un modèle trop loin, ou la même parcelle', () => {
    const { etat } = preparer({
      A,
      B: [
        [150, 0],
        [200, 0],
        [200, 50],
        [150, 50],
      ],
    });
    expect(modeleLePlusProche(etat, bordEst)).toBeNull();
    expect(() => collerBord(etat, bordEst, 1)).toThrow(ErreurEdition);
    expect(() => collerBord(etat, bordEst, 0)).toThrow(ErreurEdition);
  });

  it('refuse un bord qui passe par un sommet commun avec une troisième parcelle', () => {
    const { etat } = preparer({
      A: [
        [0, 0],
        [100, 0],
        [100, 25],
        [100, 50],
        [0, 50],
      ],
      B: [
        [102, 0],
        [200, 0],
        [200, 50],
        [102, 50],
      ],
      C: [
        [100, 25],
        [101, 24],
        [101, 26],
      ],
    });
    expect(() => collerBord(etat, { anneau: 0, debut: 1, fin: 3, aRebours: false }, 1)).toThrow(
      /troisième parcelle/,
    );
  });
});
