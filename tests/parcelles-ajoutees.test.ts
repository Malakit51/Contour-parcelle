import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { controler } from '../src/edition/controles';
import { estSupprimee, etatInitial, latLon, surfaceEtat } from '../src/edition/etat';
import { exporterEtat, nouvelleSurface, verifierRelecture } from '../src/edition/export';
import { ErreurEdition, supprimerParcelle } from '../src/edition/operations';
import { creerParcelle, idSuivant, rapportSurface } from '../src/edition/parcelles-ajoutees';
import { ajouterZoneExclue } from '../src/edition/zones-exclues';
import { planLocal, type LatLon, type XY } from '../src/geometrie/plan';
import { comparer } from '../src/isoxml/comparaison';
import { lireTaskData } from '../src/isoxml/lecture';
import { enregistrerSession, relireSession } from '../src/sauvegarde/session';

const texte = readFileSync('tests/fixtures/console-anonyme.xml', 'utf8');
const lire = () => lireTaskData(texte);

/** Rectangle de `l` × `h` m, à 500 m au nord de la parcelle la plus au nord (loin de tout). */
function rectangleLoin(l = 200, h = 100, decalage: XY = [0, 0]): LatLon[] {
  const td = lire();
  const tous = etatInitial(td).anneaux.flatMap((a) => a.sommets.map(latLon));
  const nord = tous.reduce((m, p) => (p[0] > m[0] ? p : m));
  const plan = planLocal(nord);
  return (
    [
      [0, 500],
      [l, 500],
      [l, 500 + h],
      [0, 500 + h],
    ] as XY[]
  ).map(([x, y]) => plan.versLatLon([x + decalage[0], y + decalage[1]]));
}

describe('créer une parcelle', () => {
  it('export : un PFD de plus après les autres, au format de la console, relu point pour point', () => {
    const td = lire();
    const etat0 = etatInitial(td);
    const avant = exporterEtat(td, etat0);
    expect(idSuivant(td)).toBe('PFD31');
    const { etat, parcelle } = creerParcelle(
      td,
      etat0,
      'Nouvelle 1',
      rectangleLoin(),
      'a'.repeat(32),
    );
    expect(parcelle).toBe(30);
    expect(td.parcelles[30]).toMatchObject({ id: 'PFD31', nom: 'Nouvelle 1', ajoutee: true });
    expect(surfaceEtat(etat, 30)).toBeCloseTo(20000, -1);
    const sortie = exporterEtat(td, etat);
    expect(verifierRelecture(td, etat, sortie)).toEqual([]);
    expect(controler(td, etat, [30])).toEqual([]);
    const relu = lireTaskData(sortie);
    expect(relu.parcelles).toHaveLength(31);
    expect(relu.parcelles[30]).toMatchObject({
      id: 'PFD31',
      nom: 'Nouvelle 1',
      guid: 'a'.repeat(32),
    });
    // Seules différences avec l'export sans parcelle : les lignes du nouveau PFD, d'un bloc.
    const diffs = comparer(avant, sortie);
    expect(diffs.every((d) => d.avant === null)).toBe(true);
    const lignes = diffs.map((d) => d.apres!.replace(/\r?\n$/, ''));
    expect(lignes[0]).toMatch(
      /^<PFD A="PFD31" B="a{32}" C="Nouvelle 1" D="\d+" E="CTR1" F="FRM1">$/,
    );
    const d = Number(/D="(\d+)"/.exec(lignes[0]!)![1]);
    expect(d).toBe(Math.round(surfaceEtat(etat, 30) * rapportSurface(td)));
    expect(d).toBe(Math.round(nouvelleSurface(td, etat, 30)!));
    expect(lignes.slice(1, 3)).toEqual(['<PLN A="1" B="Nouvelle 1">', '<LSG A="1">']);
    expect(lignes[3]).toMatch(/^<PNT A="2" B="start" C="-?\d+\.\d{13}" D="-?\d+\.\d{13}"\/>$/);
    expect(lignes.slice(-3)).toEqual(['</LSG>', '</PLN>', '</PFD>']);
    expect(lignes).toHaveLength(3 + 5 + 3);
    // Le bloc est juste après le dernier PFD du fichier.
    const i = sortie.indexOf('<PFD A="PFD31"');
    expect(sortie.slice(i - 8, i)).toBe('</PFD>\r\n');
    expect(sortie.indexOf('<PFD A="PFD30"')).toBeLessThan(i);
  });

  it('même sens de rotation que les parcelles de la console ; zone exclue et ligne de guidage écrites dedans', () => {
    const td = lire();
    const { etat: e1, parcelle } = creerParcelle(
      td,
      etatInitial(td),
      'N',
      rectangleLoin().reverse(),
    );
    const sens = (pts: LatLon[]) => {
      const pl = planLocal(pts[0]!);
      const q = pts.map((p) => pl.versXY(p));
      return Math.sign(
        q.reduce(
          (s, u, k) => s + u[0] * q[(k + 1) % q.length]![1] - q[(k + 1) % q.length]![0] * u[1],
          0,
        ),
      );
    };
    const premier = etatInitial(td).anneaux[0]!.sommets.map(latLon);
    expect(sens(e1.anneaux.at(-1)!.sommets.map(latLon))).toBe(sens(premier));
    const ext = e1.anneaux.at(-1)!.sommets.map(latLon);
    const pl = planLocal(ext[0]!);
    const c = ext
      .map((p) => pl.versXY(p))
      .reduce((s, q) => [s[0] + q[0] / 4, s[1] + q[1] / 4], [0, 0]);
    const trou = (
      [
        [-5, -5],
        [5, -5],
        [5, 5],
        [-5, 5],
      ] as XY[]
    ).map(([x, y]) => pl.versLatLon([c[0] + x, c[1] + y]));
    const e2 = {
      ...ajouterZoneExclue(e1, parcelle, trou),
      guidages: [{ parcelle, type: 'ab' as const, nom: 'Semoir 1', points: [ext[0]!, ext[1]!] }],
    };
    const sortie = exporterEtat(td, e2);
    expect(verifierRelecture(td, e2, sortie)).toEqual([]);
    const relue = lireTaskData(sortie).parcelles[30]!;
    expect(relue.anneaux.map((a) => a.type)).toEqual([1, 2]);
    const bloc = sortie.slice(sortie.indexOf('<PFD A="PFD31"'));
    expect(bloc.indexOf('<LSG A="5" B="Semoir 1">')).toBeLessThan(bloc.indexOf('<PLN'));
  });

  it('refuse un chevauchement, un nom déjà pris, un contour qui se recoupe', () => {
    const td = lire();
    const etat = etatInitial(td);
    const p13 = etat.anneaux.find((a) => td.parcelles[a.parcelle]!.nom === '13 Jard')!;
    const pl = planLocal(latLon(p13.sommets[0]!));
    const autour = (
      [
        [-30, -30],
        [30, -30],
        [30, 30],
        [-30, 30],
      ] as XY[]
    ).map((q) => pl.versLatLon(q));
    expect(() => creerParcelle(td, etat, 'X', autour)).toThrow(/chevauche/);
    expect(() => creerParcelle(td, etat, '13 jard', rectangleLoin())).toThrow(/déjà/);
    const [a, b, c, d] = rectangleLoin();
    expect(() => creerParcelle(td, etat, 'X', [a!, c!, b!, d!])).toThrow(/recoupe/);
    expect(() => creerParcelle(td, etat, '', rectangleLoin())).toThrow(ErreurEdition);
    expect(td.parcelles).toHaveLength(30);
  });

  it('annuler ou supprimer : le fichier redevient celui d’origine ; la session la garde', () => {
    const td = lire();
    const etat0 = etatInitial(td);
    const avant = exporterEtat(td, etat0);
    const { etat, parcelle } = creerParcelle(td, etat0, 'Nouvelle', rectangleLoin());
    // « Annuler » revient à etat0 : la parcelle reste dans td, mais ne compte plus.
    expect(estSupprimee(etat0, parcelle)).toBe(true);
    expect(exporterEtat(td, etat0)).toBe(avant);
    expect(exporterEtat(td, supprimerParcelle(etat, parcelle))).toBe(avant);
    // Une deuxième parcelle prend l'indice et l'identifiant suivants.
    const { etat: e2, parcelle: p2 } = creerParcelle(
      td,
      etat,
      'Autre',
      rectangleLoin(100, 50, [400, 0]),
    );
    expect([p2, td.parcelles[p2]!.id]).toEqual([31, 'PFD32']);
    const relue = relireSession(
      JSON.parse(JSON.stringify(enregistrerSession(td, 'TASKDATA.XML', e2, 'essai'))),
    );
    expect(relue.td.parcelles.map((p) => p.nom).slice(30)).toEqual(['Nouvelle', 'Autre']);
    expect(exporterEtat(relue.td, relue.etat)).toBe(exporterEtat(td, e2));
    expect(verifierRelecture(relue.td, relue.etat, exporterEtat(relue.td, relue.etat))).toEqual([]);
  });
});

describe('nouvelle parcelle en U autour d’une autre', () => {
  it('pas de chevauchement : acceptée (le centre tombe dans la voisine, ses sommets non)', async () => {
    const { preparer } = await import('./outils');
    const { td, etat } = preparer({
      C: [
        [40, 40],
        [60, 40],
        [60, 100],
        [40, 100],
      ],
    });
    const { plan } = await import('./outils');
    const u = (
      [
        [0, 0],
        [100, 0],
        [100, 100],
        [60, 100],
        [60, 40],
        [40, 40],
        [40, 100],
        [0, 100],
      ] as XY[]
    ).map((q) => plan.versLatLon(q));
    expect(() => creerParcelle(td, etat, 'U', u)).not.toThrow();
  });
});
