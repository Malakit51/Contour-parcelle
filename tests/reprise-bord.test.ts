import { describe, expect, it } from 'vitest';
import { controler } from '../src/edition/controles';
import { latLon, sommetsEn, surfaceEtat } from '../src/edition/etat';
import { exporterEtat, verifierRelecture } from '../src/edition/export';
import { ErreurEdition } from '../src/edition/operations';
import { reprendreBord } from '../src/edition/reprise-bord';
import { type XY } from '../src/geometrie/plan';
import { enMetres, plan, preparer } from './outils';

const ll = (pts: XY[]) => pts.map((p) => plan.versLatLon(p));
const arrondi = (pts: number[][]) => pts.map((p) => p.map((v) => Math.round(v * 100) / 100 + 0));

describe('reprendre un bord de l’ancien fichier', () => {
  it('bord extérieur : les bouts prennent la référence, le reste ne bouge pas', () => {
    const { etat } = preparer({
      A: [
        [0, 0],
        [100, 0],
        [100, 50],
        [0, 50],
      ],
    });
    // Ancien bord est : légèrement décalé, avec un point au milieu.
    const r = reprendreBord(
      etat,
      0,
      ll([
        [101, 0.5],
        [102, 25],
        [101, 49.5],
      ]),
    );
    expect(arrondi(enMetres(r.etat, 0))).toEqual([
      [0, 0],
      [101, 0.5],
      [102, 25],
      [101, 49.5],
      [0, 50],
    ]);
    expect(r.bilan.avant).toBe(4);
    expect(r.bilan.apres).toBe(5);
    expect(r.bilan.ecartMax).toBeGreaterThan(0.9);
    expect(surfaceEtat(r.etat, 0)).toBeGreaterThan(surfaceEtat(etat, 0));
  });

  it('chemin touché à rebours : même résultat', () => {
    const { etat } = preparer({
      A: [
        [0, 0],
        [100, 0],
        [100, 50],
        [0, 50],
      ],
    });
    const r = reprendreBord(
      etat,
      0,
      ll([
        [101, 49.5],
        [102, 25],
        [101, 0.5],
      ]),
    );
    expect(arrondi(enMetres(r.etat, 0))).toEqual([
      [0, 0],
      [101, 0.5],
      [102, 25],
      [101, 49.5],
      [0, 50],
    ]);
  });

  it('limite commune : le voisin reçoit les mêmes points, ni bande vide ni chevauchement', () => {
    const { td, etat } = preparer({
      A: [
        [0, 0],
        [100, 0],
        [100, 50],
        [0, 50],
      ],
      B: [
        [100, 0],
        [200, 0],
        [200, 50],
        [100, 50],
      ],
    });
    const r = reprendreBord(
      etat,
      0,
      ll([
        [100.5, 0],
        [103, 25],
        [100.5, 50],
      ]),
    );
    expect(r.bilan.voisins).toEqual([1]);
    for (const s of r.etat.anneaux[0]!.sommets.filter((_, i) => enMetres(r.etat, 0)[i]![0]! > 90)) {
      expect(sommetsEn(r.etat, latLon(s)).some((q) => q.anneau === 1)).toBe(true);
    }
    expect(controler(td, r.etat, [0, 1]).filter((a) => a.grave)).toEqual([]);
    const total = surfaceEtat(etat, 0) + surfaceEtat(etat, 1);
    expect(surfaceEtat(r.etat, 0) + surfaceEtat(r.etat, 1)).toBeCloseTo(total, 0);
    // L'export se relit et redonne les contours.
    const texte = exporterEtat(td, r.etat);
    expect(verifierRelecture(td, r.etat, texte)).toEqual([]);
  });

  it('refuse un bord qui passe par un point commun avec un voisin', () => {
    const { etat } = preparer({
      A: [
        [0, 0],
        [100, 0],
        [100, 25],
        [100, 50],
        [0, 50],
      ],
      B: [
        [100, 25],
        [200, 25],
        [200, 50],
        [100, 50],
      ],
    });
    expect(() =>
      reprendreBord(
        etat,
        0,
        ll([
          [101, 0],
          [101, 50],
        ]),
      ),
    ).toThrow(ErreurEdition);
  });

  it('refuse un bout à plus de 20 m du contour', () => {
    const { etat } = preparer({
      A: [
        [0, 0],
        [100, 0],
        [100, 50],
        [0, 50],
      ],
    });
    expect(() =>
      reprendreBord(
        etat,
        0,
        ll([
          [150, 0],
          [150, 50],
        ]),
      ),
    ).toThrow(ErreurEdition);
  });
});
