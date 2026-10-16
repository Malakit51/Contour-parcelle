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
