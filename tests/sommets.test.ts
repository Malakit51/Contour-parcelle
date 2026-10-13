import { describe, expect, it } from 'vitest';
import { etatInitial, latLon } from '../src/edition/etat';
import { exporterEtat, parcellesModifiees } from '../src/edition/export';
import {
  ajouterPoint,
  decalerSommet,
  ErreurEdition,
  glisserSommetLeLong,
  placerSommet,
  remplacerContour,
  supprimerSommet,
} from '../src/edition/operations';
import type { XY } from '../src/geometrie/plan';
import { comparer } from '../src/isoxml/comparaison';
import { lireTaskData } from '../src/isoxml/lecture';
import { enMetres, plan, preparer } from './outils';

const deuxCarres = {
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

describe('déplacer un sommet', () => {
  it('flèches : décalage Nord / Est dans toutes les parcelles qui partagent le sommet', () => {
    const { etat } = preparer(deuxCarres);
    const apres = decalerSommet(etat, { anneau: 0, sommet: 2 }, 0.5, -0.25);
    expect(enMetres(apres, 0)[2]).toEqual([100.5, 99.75]);
    expect(enMetres(apres, 1)[3]).toEqual([100.5, 99.75]);
  });

  it('au doigt : le sommet va exactement à la position touchée', () => {
    const { etat } = preparer(deuxCarres);
    const cible = plan.versLatLon([103, 97]);
    const apres = placerSommet(etat, { anneau: 1, sommet: 3 }, cible);
    expect(latLon(apres.anneaux[1]!.sommets[3]!)).toEqual(cible);
    expect(latLon(apres.anneaux[0]!.sommets[2]!)).toEqual(cible);
  });
});

describe('supprimer un sommet', () => {
  const pentagone = {
    P: [
      [0, 0],
      [100, 0],
      [100, 100],
      [50, 120],
      [0, 100],
    ] as XY[],
  };

  it('retire la ligne du point dans le fichier, et rien d’autre que la surface', () => {
    const { td, etat } = preparer(pentagone);
    const apres = supprimerSommet(etat, { anneau: 0, sommet: 3 });
    expect(enMetres(apres, 0)).toEqual(pentagone.P.filter((_, i) => i !== 3));
    expect(parcellesModifiees(apres)).toEqual([0]);
    const texte = exporterEtat(td, apres);
    const diffs = comparer(td.texte, texte);
    expect(diffs.filter((d) => d.apres === null)).toHaveLength(1);
    expect(diffs.filter((d) => d.avant !== null && d.apres !== null)).toHaveLength(1); // D
    expect(etatInitial(lireTaskData(texte)).anneaux[0]!.sommets).toHaveLength(4);
  });

  it('premier point : la ligne « start » reste, avec les coordonnées du point suivant', () => {
    const { td, etat } = preparer(pentagone);
    const apres = supprimerSommet(etat, { anneau: 0, sommet: 0 });
    expect(enMetres(apres, 0)).toEqual(pentagone.P.slice(1));
    const texte = exporterEtat(td, apres);
    const relu = lireTaskData(texte).parcelles[0]!.anneaux[0]!.points;
    expect(relu).toHaveLength(5); // 4 sommets + répétition du premier
    expect(texte).toMatch(/<PNT A="2" B="start" C="[\d.]+" D="[\d.]+"\/>/);
    expect([relu[0]!.lat, relu[0]!.lon]).toEqual([relu[4]!.lat, relu[4]!.lon]);
    expect(enMetres(etatInitial(lireTaskData(texte)), 0)).toEqual(pentagone.P.slice(1));
  });

  it('refuse un sommet commun avec une autre parcelle', () => {
    const { etat } = preparer(deuxCarres);
    expect(() => supprimerSommet(etat, { anneau: 0, sommet: 2 })).toThrow(ErreurEdition);
  });

  it('refuse de descendre sous 3 points', () => {
    const { etat } = preparer({
      T: [
        [0, 0],
        [10, 0],
        [0, 10],
      ],
    });
    expect(() => supprimerSommet(etat, { anneau: 0, sommet: 1 })).toThrow(ErreurEdition);
  });
});

describe('faire glisser un point le long d’un bord', () => {
  it('vers l’autre extrémité ou dans le prolongement, distance en valeur absolue', () => {
    const { etat } = preparer(deuxCarres);
    const ref = { anneau: 0, sommet: 2 }; // (100, 100), commun avec Y
    const limiteNord = { anneau: 0, debut: 2 }; // de (100, 100) vers (0, 100)
    const vers = glisserSommetLeLong(etat, ref, limiteNord, -0.5, true);
    expect(enMetres(vers, 0)[2]).toEqual([99.5, 100]);
    expect(enMetres(vers, 1)[3]).toEqual([99.5, 100]);
    const oppose = glisserSommetLeLong(etat, ref, limiteNord, 0.5, false);
    expect(enMetres(oppose, 0)[2]).toEqual([100.5, 100]);
    expect(() => glisserSommetLeLong(etat, ref, limiteNord, 150, true)).toThrow(ErreurEdition);
  });
});

describe('ajouter un point', () => {
  it('sur une limite commune : ajouté chez les deux voisins, puis déplaçable', () => {
    const { td, etat } = preparer(deuxCarres);
    const limiteCommune = { anneau: 0, debut: 1 }; // (100, 0) → (100, 100)
    const r = ajouterPoint(etat, limiteCommune, plan.versLatLon([100.4, 30]));
    expect(enMetres(r.etat, 0)).toHaveLength(5);
    expect(enMetres(r.etat, 0)[2]).toEqual([100, 30]);
    expect(enMetres(r.etat, 1)).toContainEqual([100, 30]);
    expect(r.sommet).toEqual({ anneau: 0, sommet: 2 });
    const deplace = decalerSommet(r.etat, r.sommet, 1, 0);
    expect(enMetres(deplace, 1)).toContainEqual([101, 30]);
    const relu = etatInitial(lireTaskData(exporterEtat(td, deplace)));
    expect(enMetres(relu, 0)).toEqual(enMetres(deplace, 0));
  });

  it('refuse un toucher sur un sommet', () => {
    const { etat } = preparer(deuxCarres);
    expect(() => ajouterPoint(etat, { anneau: 0, debut: 1 }, plan.versLatLon([100, 0]))).toThrow(
      ErreurEdition,
    );
  });
});

describe('remplacer un contour', () => {
  it('garde la ligne « start », retire les anciens points, se relit à l’identique', () => {
    const { td, etat } = preparer(deuxCarres);
    const nouveau = (
      [
        [-5, -5],
        [50, -8],
        [95, -5],
        [95, 95],
        [-5, 95],
      ] as XY[]
    ).map((p) => plan.versLatLon(p));
    const apres = remplacerContour(etat, 0, nouveau);
    const texte = exporterEtat(td, apres);
    expect(texte).toMatch(/<PNT A="2" B="start" C="[\d.]+" D="[\d.]+"\/>/);
    const relu = etatInitial(lireTaskData(texte));
    expect(enMetres(relu, 0)).toEqual(enMetres(apres, 0));
    expect(enMetres(relu, 1)).toEqual(enMetres(etat, 1));
  });
});
