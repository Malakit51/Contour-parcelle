import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  etatInitial,
  latLon,
  limitesJumelles,
  sommetsEn,
  surfaceEtat,
  type Etat,
  type RefLimite,
} from '../src/edition/etat';
import { exporterEtat } from '../src/edition/export';
import {
  cotesLimite,
  decalerLimite,
  retrouverLimite,
  ErreurEdition,
  glisserSommet,
  sensPositif,
} from '../src/edition/operations';
import { positionSurSegment, type XY } from '../src/geometrie/plan';
import { comparer } from '../src/isoxml/comparaison';
import { lireTaskData } from '../src/isoxml/lecture';
import { enMetres, plan, preparer } from './outils';

describe('décaler une limite non partagée', () => {
  it('rectangle : le bord Nord monte de 1 m, les bords voisins gardent leur direction', () => {
    const { etat } = preparer({
      R: [
        [0, 0],
        [100, 0],
        [100, 50],
        [0, 50],
      ],
    });
    const apres = decalerLimite(etat, { anneau: 0, debut: 2 }, 1);
    expect(enMetres(apres, 0)).toEqual([
      [0, 0],
      [100, 0],
      [100, 51],
      [0, 51],
    ]);
    expect(surfaceEtat(apres, 0) - surfaceEtat(etat, 0)).toBeCloseTo(100, 3);
  });

  it('trapèze : les nouvelles extrémités restent sur les limites voisines', () => {
    const pts: XY[] = [
      [0, 0],
      [120, 0],
      [100, 60],
      [10, 50],
    ];
    const { etat } = preparer({ T: pts });
    const apres = decalerLimite(etat, { anneau: 0, debut: 2 }, -0.5);
    const [, , p2, p3] = apres.anneaux[0]!.sommets.map((s) => plan.versXY(latLon(s)));
    expect(positionSurSegment(p2!, pts[1]!, pts[2]!).ecart).toBeLessThan(1e-6);
    expect(positionSurSegment(p3!, pts[3]!, pts[0]!).ecart).toBeLessThan(1e-6);
    // Nouvelle limite parallèle à l'ancienne, à 50 cm vers l'intérieur.
    expect(positionSurSegment(p2!, pts[2]!, pts[3]!).ecart).toBeCloseTo(0.5, 6);
    expect(positionSurSegment(p3!, pts[2]!, pts[3]!).ecart).toBeCloseTo(0.5, 6);
    expect(enMetres(apres, 0).slice(0, 2)).toEqual(pts.slice(0, 2));
  });

  it('refuse un décalage qui dépasse le sommet suivant', () => {
    const { etat } = preparer({
      R: [
        [0, 0],
        [100, 0],
        [100, 50],
        [0, 50],
      ],
    });
    expect(() => decalerLimite(etat, { anneau: 0, debut: 2 }, -60)).toThrow(ErreurEdition);
  });
});

describe('décaler une limite partagée', () => {
  it('bord extérieur aligné : les deux parcelles bougent ensemble, sans point ajouté', () => {
    const { etat } = preparer({
      X: [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
      ],
      Y: [
        [100, 0],
        [200, 0],
        [200, 100],
        [100, 100],
      ],
    });
    const ref: RefLimite = { anneau: 0, debut: 1 };
    expect(limitesJumelles(etat, ref)).toEqual([{ anneau: 1, debut: 0, fin: 3 }]);
    const apres = decalerLimite(etat, ref, 1);
    expect(enMetres(apres, 0)).toEqual([
      [0, 0],
      [101, 0],
      [101, 100],
      [0, 100],
    ]);
    expect(enMetres(apres, 1)).toEqual([
      [101, 0],
      [200, 0],
      [200, 100],
      [101, 100],
    ]);
  });

  // Le cas du schéma : le bord Nord fait un angle au sommet commun.
  const schema = {
    X: [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 80],
    ] as XY[],
    Y: [
      [100, 0],
      [200, 0],
      [200, 70],
      [100, 100],
    ] as XY[],
  };

  for (const distance of [2, -2]) {
    it(`bord en angle, décalage ${distance} m : contour extérieur inchangé`, () => {
      const { etat } = preparer(schema);
      const apres = decalerLimite(etat, { anneau: 0, debut: 1 }, distance);
      const total = (e: Etat) => surfaceEtat(e, 0) + surfaceEtat(e, 1);
      expect(total(apres)).toBeCloseTo(total(etat), 6);
      // Bande de 2 m sous un bord Nord en pente : 199,4 m² (vers Y) ou 199,6 m² (vers X).
      expect(surfaceEtat(apres, 0) - surfaceEtat(etat, 0)).toBeCloseTo(distance * 99.75, 0);

      const gagnant = distance > 0 ? 0 : 1;
      const perdant = 1 - gagnant;
      // Le gagnant garde l'ancien sommet du Nord et reçoit le nouveau en plus.
      expect(apres.anneaux[gagnant]!.sommets).toHaveLength(5);
      expect(apres.anneaux[perdant]!.sommets).toHaveLength(4);
      // Le nouveau sommet Nord est sur l'ancienne limite Nord du perdant.
      const nordPerdant = gagnant === 0 ? schema.Y.slice(2, 4) : [schema.X[2]!, schema.X[3]!];
      const nouveauNord = enMetres(apres, perdant).find(
        (p) => p[1]! > 50 && Math.abs(p[0]! - (100 + distance)) < 0.01,
      )!;
      expect(
        positionSurSegment(nouveauNord as unknown as XY, nordPerdant[0]!, nordPerdant[1]!).ecart,
      ).toBeLessThan(1e-3);
      // Tous les sommets de la nouvelle limite sont identiques dans les deux parcelles.
      for (const s of apres.anneaux[perdant]!.sommets) {
        if (Math.abs(plan.versXY(latLon(s))[0] - (100 + distance)) < 0.01) {
          expect(
            sommetsEn(apres, latLon(s), 0)
              .map((r) => r.anneau)
              .sort(),
          ).toEqual([0, 1]);
        }
      }
    });
  }
});

describe('sommet commun avec une troisième parcelle', () => {
  const parcelles = {
    X: [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ] as XY[],
    Z: [
      [100, 0],
      [200, 0],
      [200, 100],
      [100, 100],
    ] as XY[],
  };

  it('le bord Nord de X recule : le nouveau coin est ajouté à la limite de Z', () => {
    const { etat } = preparer(parcelles);
    const apres = decalerLimite(etat, { anneau: 0, debut: 2 }, -1);
    expect(enMetres(apres, 0)).toEqual([
      [0, 0],
      [100, 0],
      [100, 99],
      [0, 99],
    ]);
    expect(enMetres(apres, 1)).toEqual([
      [100, 0],
      [200, 0],
      [200, 100],
      [100, 100],
      [100, 99],
    ]);
    expect(surfaceEtat(apres, 1)).toBeCloseTo(surfaceEtat(etat, 1), 6);
  });

  it('le bord Nord de X avance : X garde le coin commun avec Z', () => {
    const { etat } = preparer(parcelles);
    const apres = decalerLimite(etat, { anneau: 0, debut: 2 }, 1);
    expect(enMetres(apres, 0)).toEqual([
      [0, 0],
      [100, 0],
      [100, 100],
      [100, 101],
      [0, 101],
    ]);
    expect(enMetres(apres, 1)).toEqual(enMetres(etat, 1));
  });
});

describe('faire glisser un sommet', () => {
  const parcelles = {
    X: [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ] as XY[],
    Y: [
      [100, 0],
      [200, 0],
      [200, 100],
      [100, 100],
    ] as XY[],
  };

  it('+ = vers l’Est le long d’une limite Est-Ouest, et le sommet partagé bouge partout', () => {
    const { etat } = preparer(parcelles);
    // Sommet (100, 100) de X, le long de la limite Nord de X, parcourue d'Est en Ouest.
    expect(sensPositif(etat, { anneau: 0, debut: 2 })).toBe('Est');
    const apres = glisserSommet(etat, { anneau: 0, sommet: 2 }, { anneau: 0, debut: 2 }, 0.5);
    expect(enMetres(apres, 0)[2]).toEqual([100.5, 100]);
    expect(enMetres(apres, 1)[3]).toEqual([100.5, 100]);
  });

  it('+ = vers le Nord le long d’une limite Nord-Sud', () => {
    const { etat } = preparer(parcelles);
    expect(sensPositif(etat, { anneau: 0, debut: 1 })).toBe('Nord');
    const apres = glisserSommet(etat, { anneau: 0, sommet: 2 }, { anneau: 0, debut: 1 }, -0.3);
    expect(enMetres(apres, 0)[2]).toEqual([100, 99.7]);
  });
});

describe('export après modification', () => {
  it('écrit les points déplacés et ajoutés, puis se relit à l’identique', () => {
    const { td, etat } = preparer({
      X: [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 80],
      ],
      Y: [
        [100, 0],
        [200, 0],
        [200, 70],
        [100, 100],
      ],
    });
    const apres = decalerLimite(etat, { anneau: 0, debut: 1 }, 2);
    const texte = exporterEtat(td, apres);
    const relu = etatInitial(lireTaskData(texte));
    for (let i = 0; i < 2; i++) {
      expect(relu.anneaux[i]!.sommets.map(latLon)).toEqual(
        apres.anneaux[i]!.sommets.map((s) => latLon(s).map((v) => Number(v.toFixed(13)))),
      );
    }
    const diffs = comparer(td.texte, texte);
    // X : surface + 1 point ajouté ; Y : surface + 2 points déplacés (dont le premier, répété à la fin).
    expect(diffs.filter((d) => d.avant === null)).toHaveLength(1);
    expect(diffs.filter((d) => d.avant !== null && d.apres !== null)).toHaveLength(6);
    expect(diffs.filter((d) => d.apres === null)).toHaveLength(0);
    expect(texte.split('\n').every((l, i, t) => i === t.length - 1 || l.endsWith('\r'))).toBe(true);
  });
});

const REEL = 'donnees_locales/TASKDATA.XML';

describe.runIf(existsSync(REEL))('export réel : limite 130usag / 131usag', () => {
  // Lecture paresseuse : le corps du describe s'exécute même quand le fichier est absent.
  const charger = () => {
    const td = lireTaskData(readFileSync(REEL, 'utf8'));
    const etat = etatInitial(td);
    const ia = etat.anneaux.findIndex((a) => td.parcelles[a.parcelle]!.nom === '130usag');
    const ib = etat.anneaux.findIndex((a) => td.parcelles[a.parcelle]!.nom === '131usag');
    return { td, etat, ia, ib };
  };

  for (const distance of [0.5, -0.5]) {
    it(`décalage ${distance} m vers 131usag : surface totale inchangée`, () => {
      const { td, etat, ia, ib } = charger();
      // Dans 130usag, la limite partagée va du sommet 0 au sommet 1.
      const ref: RefLimite = { anneau: ia, debut: 0 };
      expect(limitesJumelles(etat, ref).map((j) => j.anneau)).toEqual([ib]);
      const apres = decalerLimite(etat, ref, distance);
      const total = (e: Etat) =>
        surfaceEtat(e, etat.anneaux[ia]!.parcelle) + surfaceEtat(e, etat.anneaux[ib]!.parcelle);
      // Écart dû aux arrondis de projection : quelques dizaines de cm² sur 37 ha.
      expect(total(apres)).toBeCloseTo(total(etat), 1);
      const variation =
        surfaceEtat(apres, etat.anneaux[ia]!.parcelle) -
        surfaceEtat(etat, etat.anneaux[ia]!.parcelle);
      expect(variation).toBeCloseTo(distance * 790.8, -1);

      const relu = etatInitial(lireTaskData(exporterEtat(td, apres)));
      expect(relu.anneaux[ia]!.sommets.length + relu.anneaux[ib]!.sommets.length).toBe(
        8 - 1 + 6 - 1 + 2,
      );
    });
  }
});

describe('côtés d’une limite (flèches sur la carte)', () => {
  it('« extérieur » est du côté où un décalage positif emmène la limite', () => {
    const { etat } = preparer({
      R: [
        [0, 0],
        [100, 0],
        [100, 50],
        [0, 50],
      ],
    });
    const ref: RefLimite = { anneau: 0, debut: 2 }; // bord Nord
    const c = cotesLimite(etat, ref);
    const [mx, my] = plan.versXY(c.milieu);
    expect([Math.round(mx), Math.round(my)]).toEqual([50, 50]);
    expect(plan.versXY(c.exterieur)[1]).toBeGreaterThan(my);
    expect(plan.versXY(c.interieur)[1]).toBeLessThan(my);
    const apres = decalerLimite(etat, ref, 1);
    expect(enMetres(apres, 0)[2]![1]).toBe(51);
  });
});

describe('retrouver la limite après un décalage (pour l’appliquer plusieurs fois)', () => {
  const schema = {
    X: [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 80],
    ] as XY[],
    Y: [
      [100, 0],
      [200, 0],
      [200, 70],
      [100, 100],
    ] as XY[],
  };
  for (const [nom, anneau, debut, distance] of [
    ['X perd du terrain', 0, 1, -1],
    ['X gagne (reçoit un sommet)', 0, 1, 1],
    ['depuis Y, Y gagne', 1, 3, 1],
  ] as const) {
    it(nom, () => {
      const { etat } = preparer(schema);
      let e = etat;
      let ref: RefLimite = { anneau, debut };
      for (let i = 1; i <= 3; i++) {
        const apres = decalerLimite(e, ref, distance);
        const r = retrouverLimite(e, apres, ref);
        expect(r).not.toBeNull();
        ref = r!;
        e = apres;
      }
      // Trois décalages de 1 m : la limite commune est à 3 m de sa position de départ.
      const pts = enMetres(e, ref.anneau);
      const a = pts[ref.debut]!;
      const b = pts[(ref.debut + 1) % pts.length]!;
      const xAttendu = anneau === 0 ? 100 + 3 * distance : 100 - 3 * distance;
      expect(a[0]).toBeCloseTo(xAttendu, 3);
      expect(b[0]).toBeCloseTo(xAttendu, 3);
    });
  }
});
