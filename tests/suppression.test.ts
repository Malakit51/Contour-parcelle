import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { controler } from '../src/edition/controles';
import { etatInitial, sommetsEn, latLon } from '../src/edition/etat';
import { exporterEtat, parcellesModifiees, verifierRelecture } from '../src/edition/export';
import { remettreParcelle, supprimerParcelle } from '../src/edition/operations';
import { blocsDeParcelle } from '../src/isoxml/ecriture';
import { lireTaskData } from '../src/isoxml/lecture';
import { enregistrerSession, relireSession } from '../src/sauvegarde/session';

const texte = readFileSync('tests/fixtures/console-anonyme.xml', 'utf8');
const td = lireTaskData(texte);
const indice = (nom: string) => td.parcelles.findIndex((p) => p.nom === nom);

describe('supprimer une parcelle', () => {
  it('le bloc de la parcelle et ses tâches sont repérés', () => {
    const p = td.parcelles[indice('13 Jard')]!;
    const { pfd, taches } = blocsDeParcelle(texte, p.id);
    expect(texte.slice(pfd!.debut, pfd!.fin)).toMatch(/^<PFD A="PFD\d+"[\s\S]*<\/PFD>\r\n$/);
    expect(taches.length).toBeGreaterThan(0);
    for (const t of taches) {
      expect(texte.slice(t.plage.debut, t.plage.fin)).toMatch(
        new RegExp(`^<TSK [^>]*E="${p.id}"[\\s\\S]*</TSK>\\r\\n$`),
      );
    }
  });

  it('export : la parcelle et ses tâches disparaissent, tout le reste est identique', () => {
    const p = indice('13 Jard');
    const id = td.parcelles[p]!.id;
    const etat = supprimerParcelle(etatInitial(td), p);
    expect(parcellesModifiees(etat)).toEqual([]);
    const sortie = exporterEtat(td, etat);
    expect(sortie).not.toContain(`<PFD A="${id}"`);
    expect(sortie).not.toMatch(new RegExp(`<TSK [^>]*E="${id}"`));
    // Le reste du fichier : l'original sans les blocs retirés ni les lignes AB de la console.
    const { pfd, taches } = blocsDeParcelle(texte, id);
    const retraits = [pfd!, ...taches.map((t) => t.plage), ...td.segmentsIgnores].sort(
      (a, b) => a.debut - b.debut,
    );
    let attendu = '';
    let curseur = 0;
    for (const r of retraits) {
      if (r.debut < curseur) continue; // ligne AB comprise dans la parcelle retirée
      attendu += texte.slice(curseur, r.debut);
      curseur = r.fin;
    }
    attendu += texte.slice(curseur);
    expect(sortie).toBe(attendu);
    expect(verifierRelecture(td, etat, sortie)).toEqual([]);
    expect(lireTaskData(sortie).parcelles).toHaveLength(29);
  });

  it('les voisins ne voient plus la parcelle retirée (sommets communs, contrôles)', () => {
    const a = indice('130usag');
    const b = indice('131usag');
    const etat = supprimerParcelle(etatInitial(td), b);
    const ring = etat.anneaux.find((x) => x.parcelle === a)!;
    const communs = ring.sommets.filter((s) =>
      sommetsEn(etat, latLon(s)).some((r) => etat.anneaux[r.anneau]!.parcelle === b),
    );
    expect(communs).toEqual([]);
    // Pas d'alerte « limite commune perdue » à cause de la parcelle retirée.
    expect(controler(td, etat, [a])).toEqual([]);
  });

  it('ses lignes de guidage partent avec elle ; on peut la remettre', () => {
    const p = indice('140 Blanc');
    const avec = {
      ...etatInitial(td),
      guidages: [{ parcelle: p, type: 'ab' as const, nom: 'X 1', points: [] }],
    };
    const sans = supprimerParcelle(avec, p);
    expect(sans.guidages).toEqual([]);
    expect(remettreParcelle(sans, p).supprimees).toBeUndefined();
  });

  it('la session enregistrée garde les parcelles retirées', () => {
    const p = indice('10 Vign');
    const etat = supprimerParcelle(etatInitial(td), p);
    const relue = relireSession(
      JSON.parse(JSON.stringify(enregistrerSession(td, 'TASKDATA.XML', etat, 'essai'))),
    );
    expect(relue.etat.supprimees).toEqual([p]);
  });
});

describe('retirer une zone exclue', () => {
  it('13 Jard : le LSG A="2" disparaît, la surface reprend la zone, le reste est identique', async () => {
    const { supprimerZone, remettreZone } = await import('../src/edition/operations');
    const { surfaceEtat } = await import('../src/edition/etat');
    const { comparer } = await import('../src/isoxml/comparaison');
    const etat0 = etatInitial(td);
    const p = indice('13 Jard');
    const z = etat0.anneaux.findIndex((a) => a.parcelle === p && a.type === 2);
    expect(z).toBeGreaterThanOrEqual(0);
    const etat = supprimerZone(etat0, z);
    expect(parcellesModifiees(etat)).toEqual([p]);
    const trou = surfaceEtat(etat, p) - surfaceEtat(etat0, p);
    expect(trou).toBeGreaterThan(0);
    const sortie = exporterEtat(td, etat);
    expect(verifierRelecture(td, etat, sortie)).toEqual([]);
    const relu = lireTaskData(sortie).parcelles[p]!;
    expect(relu.anneaux.map((a) => a.type)).toEqual([1]);
    // Différences : la surface D, les lignes du LSG retiré, et les lignes AB de la console.
    const plage = td.parcelles[p]!.anneaux.find((a) => a.type === 2)!.plage!;
    const lignesZone = texte.slice(plage.debut, plage.fin).split('\r\n').length - 1;
    const diffs = comparer(texte, sortie);
    const modifiees = diffs.filter((d) => d.avant !== null && d.apres !== null);
    expect(modifiees).toHaveLength(1);
    expect(modifiees[0]!.avant).toMatch(/^<PFD [^>]*C="13 Jard"/);
    expect(diffs.filter((d) => d.apres === null)).toHaveLength(
      lignesZone +
        td.segmentsIgnores.reduce(
          (n, s) => n + texte.slice(s.debut, s.fin).split('\r\n').length - 1,
          0,
        ),
    );
    // Les points de la zone ne sont plus des sommets ; remettre la zone rend l'état d'origine.
    expect(controler(td, etat, [p])).toEqual([]);
    expect(remettreZone(etat, z)).toEqual(etat0);
    expect(() =>
      supprimerZone(
        etat0,
        etat0.anneaux.findIndex((a) => a.type === 1),
      ),
    ).toThrow();
  });
});

describe('parcelle qui contient un point', () => {
  it('retrouve la parcelle d’un endroit, ignore une parcelle retirée', async () => {
    const { parcelleContenant } = await import('../src/edition/etat');
    const etat = etatInitial(td);
    const p = indice('14 Jard');
    const ring = etat.anneaux.find((a) => a.parcelle === p && a.type === 1)!;
    // Milieu de deux sommets opposés : dans la parcelle (14 Jard est d'un seul tenant, convexe ici).
    const n = ring.sommets.length;
    const a = ring.sommets[0]!;
    const b = ring.sommets[Math.floor(n / 2)]!;
    const milieu: [number, number] = [(a.lat + b.lat) / 2, (a.lon + b.lon) / 2];
    expect(parcelleContenant(etat, milieu)).toBe(p);
    expect(parcelleContenant(supprimerParcelle(etat, p), milieu)).toBeNull();
    expect(parcelleContenant(etat, [0, 0])).toBeNull();
  });
});

describe('retirer les travaux de la console', () => {
  it('les 30 pulvérisations prévues partent, les 2 chantiers enregistrés restent ; ou tout part', async () => {
    const { tachesDuFichier } = await import('../src/isoxml/ecriture');
    const toutes = tachesDuFichier(texte);
    expect(toutes).toHaveLength(32);
    expect(toutes.filter((t) => t.statut === '1')).toHaveLength(30);
    const etat0 = etatInitial(td);
    const avant = exporterEtat(td, etat0);
    const prevues = exporterEtat(td, { ...etat0, taches: 'prevues' });
    expect(verifierRelecture(td, { ...etat0, taches: 'prevues' }, prevues)).toEqual([]);
    expect(tachesDuFichier(prevues).map((t) => t.statut)).toEqual(['4', '3']);
    // Le reste du fichier ne change pas : seules des lignes de tâches disparaissent.
    const { comparer } = await import('../src/isoxml/comparaison');
    const diffs = comparer(avant, prevues);
    expect(diffs.every((d) => d.apres === null)).toBe(true);
    expect(diffs.length).toBe(
      toutes
        .filter((t) => t.statut === '1')
        .reduce((n, t) => n + texte.slice(t.plage.debut, t.plage.fin).split('\r\n').length - 1, 0),
    );
    expect(tachesDuFichier(exporterEtat(td, { ...etat0, taches: 'toutes' }))).toEqual([]);
    // Avec une parcelle supprimée (sa tâche est aussi dans les travaux retirés) : pas de conflit.
    const etat = { ...supprimerParcelle(etat0, indice('13 Jard')), taches: 'prevues' as const };
    const sortie = exporterEtat(td, etat);
    expect(verifierRelecture(td, etat, sortie)).toEqual([]);
    expect(tachesDuFichier(sortie)).toHaveLength(2);
    const relue = relireSession(
      JSON.parse(JSON.stringify(enregistrerSession(td, 'TASKDATA.XML', etat, 'essai'))),
    );
    expect(relue.etat.taches).toBe('prevues');
  });
});
