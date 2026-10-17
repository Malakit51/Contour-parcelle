import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { etatInitial, latLon } from '../src/edition/etat';
import { exporterEtat, nouvelleSurface } from '../src/edition/export';
import { ajouterGuidages, lignesDeParcelle } from '../src/edition/guidages';
import { renommer } from '../src/edition/noms';
import { decalerLimite, supprimerParcelle, supprimerZone } from '../src/edition/operations';
import { creerParcelle } from '../src/edition/parcelles-ajoutees';
import { repartirDe } from '../src/edition/repartir';
import { planLocal, type XY } from '../src/geometrie/plan';
import { lireTaskData } from '../src/isoxml/lecture';

const texte = readFileSync('tests/fixtures/console-anonyme.xml', 'utf8');

describe('repartir du fichier exporté', () => {
  it('réexporter sans rien changer redonne le même fichier, lignes de guidage comprises', () => {
    const td = lireTaskData(texte);
    const n = (nom: string) => td.parcelles.findIndex((p) => p.nom === nom);
    let e = etatInitial(td);
    e = decalerLimite(
      e,
      { anneau: e.anneaux.findIndex((a) => a.parcelle === n('130usag')), debut: 1 },
      2,
    );
    const zone = e.anneaux.findIndex((a) => a.parcelle === n('13 Jard') && a.type === 2);
    e = supprimerZone(e, zone);
    e = supprimerParcelle(e, n('10 Vign'));
    e = renommer(td, e, n('110 Tom'), '110 Thomas');
    const r = { distance: 3, interieur: true, seuil: 30, base: 'Semoir 4 m' };
    e = ajouterGuidages(e, lignesDeParcelle(e, n('140 Blanc'), r)!.lignes, 'Semoir 4 m');
    e = ajouterGuidages(e, lignesDeParcelle(e, n('10 Vign'), r)?.lignes ?? [], null);
    const nord = e.anneaux
      .flatMap((a) => a.sommets.map(latLon))
      .reduce((m, p) => (p[0] > m[0] ? p : m));
    const plan = planLocal(nord);
    const rect = (
      [
        [0, 500],
        [200, 500],
        [200, 600],
        [0, 600],
      ] as XY[]
    ).map((p) => plan.versLatLon(p));
    const cree = creerParcelle(td, e, 'Nouvelle', rect, 'b'.repeat(32));
    e = ajouterGuidages(cree.etat, lignesDeParcelle(cree.etat, cree.parcelle, r)!.lignes, null);

    const exporte = exporterEtat(td, e);
    const { td: td2, etat: e2 } = repartirDe(td, e, exporte);
    // Le nouveau départ : 30 parcelles (une retirée, une créée), plus de zone exclue, noms à jour.
    expect(td2.parcelles).toHaveLength(30);
    expect(td2.parcelles.some((p) => p.nom === '10 Vign')).toBe(false);
    expect(td2.parcelles.find((p) => p.nom === 'Nouvelle')?.ajoutee).toBeFalsy();
    expect(td2.parcelles.some((p) => p.nom === '110 Thomas')).toBe(true);
    expect(e2.anneaux.some((a) => a.type === 2)).toBe(false);
    // Lignes de guidage gardées (sauf celles de la parcelle retirée), sur la bonne parcelle.
    expect(e2.guidages?.length).toBe(e.guidages!.filter((g) => g.parcelle !== n('10 Vign')).length);
    for (const g of e2.guidages!)
      expect(['140 Blanc', 'Nouvelle']).toContain(td2.parcelles[g.parcelle]!.nom);
    // Rien de changé par rapport à ce départ : le fichier ressort octet pour octet.
    expect(exporterEtat(td2, e2)).toBe(exporte);
    // Surfaces : celles écrites dans le fichier exporté.
    const p = td2.parcelles.findIndex((x) => x.nom === '130usag');
    expect(nouvelleSurface(td2, e2, p)).toBe(Number(td2.parcelles[p]!.surface!.texte));
  });
});
