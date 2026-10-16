import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { controler } from '../src/edition/controles';
import { etatInitial, latLon, surfaceEtat, type Etat } from '../src/edition/etat';
import { exporterEtat, parcellesModifiees, verifierRelecture } from '../src/edition/export';
import { ErreurEdition, supprimerZone } from '../src/edition/operations';
import { ajouterZoneExclue } from '../src/edition/zones-exclues';
import { comparer } from '../src/isoxml/comparaison';
import { lireTaskData } from '../src/isoxml/lecture';
import { planLocal, pointDansPolygone, type LatLon, type XY } from '../src/geometrie/plan';
import { enregistrerSession, relireSession } from '../src/sauvegarde/session';
import { preparer, plan as planTest } from './outils';

const texte = readFileSync('tests/fixtures/console-anonyme.xml', 'utf8');
const td = lireTaskData(texte);
const indice = (nom: string) => td.parcelles.findIndex((p) => p.nom === nom);

/** Carré de `cote` m centré sur un point intérieur du contour de la parcelle. */
function carreDans(etat: Etat, p: number, cote = 10, decalage: XY = [0, 0]): LatLon[] {
  const ext = etat.anneaux.find((a) => a.parcelle === p && a.type === 1)!;
  const plan = planLocal(latLon(ext.sommets[0]!));
  const pts = ext.sommets.map((s) => plan.versXY(latLon(s)));
  // Centre : moyenne des sommets, ramenée dans le contour si besoin.
  let c: XY = [
    pts.reduce((s, q) => s + q[0], 0) / pts.length,
    pts.reduce((s, q) => s + q[1], 0) / pts.length,
  ];
  if (!pointDansPolygone(c, pts)) c = pts[0]!;
  c = [c[0] + decalage[0], c[1] + decalage[1]];
  const h = cote / 2;
  return (
    [
      [-h, -h],
      [h, -h],
      [h, h],
      [-h, h],
    ] as XY[]
  ).map(([x, y]) => plan.versLatLon([c[0] + x, c[1] + y]));
}

describe('créer une zone exclue', () => {
  it('export de la console : un LSG A="2" de plus, au format du fichier, relu point pour point', () => {
    const etat0 = etatInitial(td);
    const p = indice('14 Jard');
    const etat = ajouterZoneExclue(etat0, p, carreDans(etat0, p));
    expect(parcellesModifiees(etat)).toEqual([p]);
    expect(surfaceEtat(etat0, p) - surfaceEtat(etat, p)).toBeCloseTo(100, 0);
    const sortie = exporterEtat(td, etat);
    expect(verifierRelecture(td, etat, sortie)).toEqual([]);
    expect(controler(td, etat, [p])).toEqual([]);
    const relu = lireTaskData(sortie).parcelles[p]!;
    expect(relu.anneaux.map((a) => a.type)).toEqual([1, 2]);
    // Les lignes ajoutées, juste après le contour extérieur, avant </PLN> : <LSG A="2">, 4 points
    // et le premier répété, </LSG>, au format du fichier.
    const debut = sortie.indexOf('<LSG A="2">', sortie.indexOf('C="14 Jard"'));
    const lignes = sortie.slice(debut).split('\r\n').slice(0, 8);
    expect(lignes[0]).toBe('<LSG A="2">');
    expect(lignes[1]).toMatch(/^<PNT A="2" B="start" C="-?\d+\.\d{13}" D="-?\d+\.\d{13}"\/>$/);
    expect(lignes[2]).toMatch(/^<PNT A="2" C="-?\d+\.\d{13}" D="-?\d+\.\d{13}"\/>$/);
    expect(lignes[5]).toBe(lignes[1]!.replace('B="start"', 'B="end"'));
    expect(lignes[6]).toBe('</LSG>');
    expect(lignes[7]).toBe('</PLN>');
    expect(sortie.slice(debut - 8, debut)).toBe('</LSG>\r\n');
    const diffs = comparer(texte, sortie);
    expect(diffs.filter((d) => d.avant === null)).toHaveLength(7);
    // Seule autre ligne modifiée : la surface D de 14 Jard.
    const modifiees = diffs.filter((d) => d.avant !== null && d.apres !== null);
    expect(modifiees).toHaveLength(1);
    expect(modifiees[0]!.avant).toMatch(/^<PFD [^>]*C="14 Jard"/);
  });

  it('13 Jard : nouvelle zone avec ou sans l’ancienne, tournée comme celle du fichier', () => {
    const etat0 = etatInitial(td);
    const p = indice('13 Jard');
    const ancienne = etat0.anneaux.findIndex((a) => a.parcelle === p && a.type === 2);
    const zone = carreDans(etat0, p, 8, [30, 30]);
    const avec = ajouterZoneExclue(etat0, p, zone);
    expect(verifierRelecture(td, avec, exporterEtat(td, avec))).toEqual([]);
    // L'ancienne retirée, la nouvelle à sa place : le fichier se relit sans souci.
    const remplacee = ajouterZoneExclue(supprimerZone(etat0, ancienne), p, zone);
    const sortie = exporterEtat(td, remplacee);
    expect(verifierRelecture(td, remplacee, sortie)).toEqual([]);
    expect(lireTaskData(sortie).parcelles[p]!.anneaux.map((a) => a.type)).toEqual([1, 2]);
    // Même sens de rotation que la zone du fichier (contraire du contour).
    const sens = (e: Etat, i: number) => {
      const pl = planLocal(latLon(e.anneaux[i]!.sommets[0]!));
      const q = e.anneaux[i]!.sommets.map((s) => pl.versXY(latLon(s)));
      let a = 0;
      for (let k = 0; k < q.length; k++) {
        const u = q[k]!;
        const v = q[(k + 1) % q.length]!;
        a += u[0] * v[1] - v[0] * u[1];
      }
      return Math.sign(a);
    };
    expect(sens(avec, avec.anneaux.length - 1)).toBe(sens(etat0, ancienne));
  });

  it('supprimer une zone créée la retire simplement ; la session la garde', () => {
    const etat0 = etatInitial(td);
    const p = indice('14 Jard');
    const etat = ajouterZoneExclue(etat0, p, carreDans(etat0, p));
    const relue = relireSession(
      JSON.parse(JSON.stringify(enregistrerSession(td, 'TASKDATA.XML', etat, 'essai'))),
    );
    expect(relue.etat.anneaux.at(-1)).toMatchObject({ parcelle: p, anneau: -1, type: 2 });
    expect(verifierRelecture(relue.td, relue.etat, exporterEtat(relue.td, relue.etat))).toEqual([]);
    expect(supprimerZone(etat, etat.anneaux.length - 1)).toEqual(etat0);
  });

  it('refuse une zone qui sort de la parcelle, se recoupe ou touche une autre zone', () => {
    const { etat } = preparer({
      A: [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
      ],
    });
    const ll = (pts: XY[]) => pts.map((q) => planTest.versLatLon(q));
    const zone = ll([
      [10, 10],
      [30, 10],
      [30, 30],
      [10, 30],
    ]);
    const e = ajouterZoneExclue(etat, 0, zone);
    expect(surfaceEtat(etat, 0) - surfaceEtat(e, 0)).toBeCloseTo(400, 0);
    expect(() =>
      ajouterZoneExclue(
        etat,
        0,
        ll([
          [90, 90],
          [110, 90],
          [110, 110],
        ]),
      ),
    ).toThrow(/dans la parcelle/);
    expect(() =>
      ajouterZoneExclue(
        etat,
        0,
        ll([
          [10, 10],
          [30, 30],
          [30, 10],
          [10, 30],
        ]),
      ),
    ).toThrow(/recoupe/);
    expect(() =>
      ajouterZoneExclue(
        e,
        0,
        ll([
          [20, 20],
          [40, 20],
          [40, 40],
          [20, 40],
        ]),
      ),
    ).toThrow(/autre zone/);
    expect(() =>
      ajouterZoneExclue(
        e,
        0,
        ll([
          [15, 15],
          [20, 15],
          [20, 20],
        ]),
      ),
    ).toThrow(ErreurEdition);
  });
});
