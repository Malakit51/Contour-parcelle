import { describe, expect, it } from 'vitest';
import { etatInitial } from '../src/edition/etat';
import { exporterEtat, verifierRelecture } from '../src/edition/export';
import { ajouterPoint, decalerSommet, supprimerSommet } from '../src/edition/operations';
import { lireTaskData } from '../src/isoxml/lecture';
import { fichier, plan, preparer } from './outils';

const carre: [number, number][] = [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100],
];

describe('relecture du fichier produit', () => {
  it('ne signale rien pour des modifications normales', () => {
    const { td, etat } = preparer({ X: carre });
    const e = decalerSommet(etat, { anneau: 0, sommet: 0 }, 1, 1);
    expect(verifierRelecture(td, e, exporterEtat(td, e))).toEqual([]);
  });

  it('anneau non fermé : déplacer le premier point ne touche pas au dernier', () => {
    // Fichier dont l'anneau n'est pas refermé (pas de répétition du premier point à la fin).
    const texte = fichier({ X: carre }).replace(/\r\n<PNT A="2" B="end"[^\r\n]*/, '');
    const td = lireTaskData(texte);
    const e = decalerSommet(etatInitial(td), { anneau: 0, sommet: 0 }, 1, 1);
    const sortie = exporterEtat(td, e);
    expect(verifierRelecture(td, e, sortie)).toEqual([]);
  });

  it('plusieurs balises sur une ligne : ajouter ou supprimer un point garde un XML valide', () => {
    const texte = fichier({ X: carre }).replace('<LSG A="1">\r\n', '<LSG A="1">');
    const td = lireTaskData(texte);
    const etat = etatInitial(td);
    const ajout = ajouterPoint(etat, { anneau: 0, debut: 0 }, plan.versLatLon([50, 0])).etat;
    expect(verifierRelecture(td, ajout, exporterEtat(td, ajout))).toEqual([]);
    const suppression = supprimerSommet(etat, { anneau: 0, sommet: 1 });
    expect(verifierRelecture(td, suppression, exporterEtat(td, suppression))).toEqual([]);
  });
});

describe('lecture', () => {
  it('un « > » dans un nom ne coupe pas la balise', () => {
    const texte = fichier({ X: carre }).replace('C="X"', 'C="Pré > 5 ha"');
    const td = lireTaskData(texte);
    expect(td.parcelles[0]!.nom).toBe('Pré > 5 ha');
    expect(td.parcelles[0]!.surface?.texte).toBe('10000');
    expect(exporterEtat(td, etatInitial(td))).toBe(texte);
  });
});
