import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { controler } from '../src/edition/controles';
import { etatInitial, surfaceEtat } from '../src/edition/etat';
import { exporterEtat } from '../src/edition/export';
import { simplifierParcelle } from '../src/edition/operations';
import { lireTaskData } from '../src/isoxml/lecture';
import { aireSignee, type XY } from '../src/geometrie/plan';
import { simplifierContour } from '../src/geometrie/simplification';

// Petit générateur pseudo-aléatoire reproductible.
function bruit(graine: number) {
  let s = graine;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31 - 0.5;
  };
}

/** Rectangle 100 × 50 m parcouru tous les 2 m, avec un « tremblement » GPS de ± amplitude. */
function rectangleBruite(amplitude: number): XY[] {
  const r = bruit(42);
  const coins: XY[] = [
    [0, 0],
    [100, 0],
    [100, 50],
    [0, 50],
  ];
  const pts: XY[] = [];
  for (let c = 0; c < 4; c++) {
    const a = coins[c]!;
    const b = coins[(c + 1) % 4]!;
    const n = Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2);
    for (let i = 0; i < n; i++) {
      pts.push([
        a[0] + ((b[0] - a[0]) * i) / n + (i ? r() * 2 * amplitude : 0),
        a[1] + ((b[1] - a[1]) * i) / n + (i ? r() * 2 * amplitude : 0),
      ]);
    }
  }
  return pts;
}

describe('simplification d’un contour', () => {
  it('un rectangle tremblé redevient 4 coins, placés au bon endroit', () => {
    const pts = rectangleBruite(0.05);
    expect(pts.length).toBe(150);
    const s = simplifierContour(pts, 0.25, new Set());
    expect(s.points).toHaveLength(4);
    const attendus: XY[] = [
      [0, 0],
      [100, 0],
      [100, 50],
      [0, 50],
    ];
    s.points.forEach((p, i) => {
      expect(Math.hypot(p[0] - attendus[i]![0], p[1] - attendus[i]![1])).toBeLessThan(0.05);
    });
    expect(s.ecartMax).toBeLessThan(0.1);
    expect(Math.abs(aireSignee(s.points)) - 5000).toBeLessThan(5);
  });

  it('garde le premier point en tête et ne bouge jamais un sommet fixe', () => {
    const pts = rectangleBruite(0.05);
    const fixe = 75; // milieu du côté opposé (point mesuré, légèrement tremblé)
    const s = simplifierContour(pts, 0.25, new Set([fixe]));
    expect(s.origines[0]).toBe(0);
    const k = s.origines.indexOf(fixe);
    expect(k).toBeGreaterThan(0);
    expect(s.points[k]).toEqual(pts[fixe]);
  });

  it('une forte tolérance ne retire jamais plus que nécessaire sous 3 points', () => {
    const triangle: XY[] = [
      [0, 0],
      [10, 0],
      [0, 10],
    ];
    expect(simplifierContour(triangle, 5, new Set()).points).toEqual(triangle);
  });

  it('un arc de cercle reste un arc : l’écart reste de l’ordre de la tolérance', () => {
    // Bord arrondi (chemin courbe) : demi-cercle de 50 m de rayon, fermé par un diamètre.
    const pts: XY[] = [];
    for (let i = 0; i <= 90; i++) {
      const a = (Math.PI * i) / 90;
      pts.push([50 * Math.cos(a), 50 * Math.sin(a)]);
    }
    const s = simplifierContour(pts, 0.25, new Set());
    expect(s.points.length).toBeGreaterThan(8);
    expect(s.points.length).toBeLessThan(40);
    expect(s.ecartMax).toBeLessThan(0.5);
  });
});

const REEL = 'donnees_locales/TASKDATA.XML';

describe.runIf(existsSync(REEL))('simplification de l’export réel', () => {
  it('toutes les parcelles à 25 cm : écart limité, surface quasi inchangée, voisins intacts', () => {
    const td = lireTaskData(readFileSync(REEL, 'utf8'));
    let etat = etatInitial(td);
    const avant = etat;
    for (let p = 0; p < td.parcelles.length; p++) {
      const r = simplifierParcelle(etat, p, 0.25);
      for (const b of r.bilan) expect(b.ecartMax, td.parcelles[p]!.nom).toBeLessThan(0.5);
      etat = r.etat;
    }
    for (let p = 0; p < td.parcelles.length; p++) {
      const ecart = Math.abs(surfaceEtat(etat, p) - surfaceEtat(avant, p)) / surfaceEtat(avant, p);
      expect(ecart, td.parcelles[p]!.nom).toBeLessThan(0.002);
    }
    const graves = controler(
      td,
      etat,
      td.parcelles.map((_, i) => i),
    ).filter((a) => a.grave);
    expect(graves).toEqual([]);
    // L'export se relit, et chaque sommet commun d'origine existe toujours chez les deux voisins.
    const relu = etatInitial(lireTaskData(exporterEtat(td, etat)));
    expect(relu.anneaux.reduce((n, a) => n + a.sommets.length, 0)).toBeLessThan(
      avant.anneaux.reduce((n, a) => n + a.sommets.length, 0),
    );
  });
});
