import { describe, expect, it } from 'vitest';
import { controler } from '../src/edition/controles';
import { distanceM, latLon, type Etat } from '../src/edition/etat';
import { exporterEtat } from '../src/edition/export';
import { DOUBLON_M, nettoyer } from '../src/edition/nettoyage';
import { decalerLimite, retrouverLimite } from '../src/edition/operations';
import { lireTaskData } from '../src/isoxml/lecture';
import { preparer } from './outils';

/** Plus petite distance entre deux sommets consécutifs d'un anneau. */
function plusCourtCote(etat: Etat, anneau: number): number {
  const s = etat.anneaux[anneau]!.sommets;
  return Math.min(...s.map((u, i) => distanceM(latLon(u), latLon(s[(i + 1) % s.length]!))));
}

describe('nettoyage après modification', () => {
  // Cas constaté sur 130usag : le coin est le premier point du fichier et il est commun avec la
  // parcelle du sud ; la limite est est décalée puis remise en place.
  const X = [
    [100, 0],
    [100, 100],
    [0, 100],
    [0, 0],
  ] as [number, number][];
  const Y = [
    [0, -100],
    [100, -100],
    [100, 0],
    [0, 0],
  ] as [number, number][];

  it('un décalage aller-retour ne laisse ni point en double ni coin décollé', () => {
    const { td, etat } = preparer({ X, Y });
    const lim = { anneau: 0, debut: 0 };
    let e = nettoyer(decalerLimite(etat, lim, -2)).etat;
    const r = retrouverLimite(etat, e, lim)!;
    e = nettoyer(decalerLimite(e, r, 2)).etat;
    expect(plusCourtCote(e, 0)).toBeGreaterThan(DOUBLON_M);
    expect(plusCourtCote(e, 1)).toBeGreaterThan(DOUBLON_M);
    // Le coin de X est toujours exactement le sommet commun avec Y.
    const coin = e.anneaux[0]!.sommets[0]!;
    expect(e.anneaux[1]!.sommets.some((s) => s.lat === coin.lat && s.lon === coin.lon)).toBe(true);
    expect(controler(td, e, [0, 1]).filter((a) => a.grave)).toEqual([]);
    // Dans le fichier exporté, deux lignes PNT consécutives ne sont jamais identiques.
    const relu = lireTaskData(exporterEtat(td, e));
    for (const p of relu.parcelles) {
      const pts = p.anneaux[0]!.points;
      for (let i = 1; i < pts.length; i++) {
        expect(pts[i]!.lat === pts[i - 1]!.lat && pts[i]!.lon === pts[i - 1]!.lon).toBe(false);
      }
    }
  });

  it('fusionne deux sommets confondus en gardant le premier en tête', () => {
    const { etat } = preparer({ X });
    const a = etat.anneaux[0]!;
    const premier = a.sommets[0]!;
    const double = { lat: premier.lat + 1e-11, lon: premier.lon, origine: null };
    const sale: Etat = { anneaux: [{ ...a, sommets: [premier, double, ...a.sommets.slice(1)] }] };
    expect(controler(preparer({ X }).td, sale, [0]).map((x) => x.grave)).toContain(true);
    const r = nettoyer(sale);
    expect(r.doublons.get(0)).toBe(1);
    expect(r.etat.anneaux[0]!.sommets).toEqual(a.sommets);
  });

  it('ne touche à rien quand tout est propre', () => {
    const { etat } = preparer({ X, Y });
    const r = nettoyer(etat);
    expect(r.etat).toBe(etat);
    expect(r.recolles).toBe(0);
  });
});
