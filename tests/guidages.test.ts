import { describe, expect, it } from 'vitest';
import type { Guidage } from '../src/edition/etat';
import {
  aControler,
  ajouterGuidages,
  duJeu,
  jeuDe,
  jeux,
  ligneSurBord,
  lignesDeParcelle,
  numeroSuivant,
  retirerGuidages,
} from '../src/edition/guidages';
import { pointDansPolygone, type XY } from '../src/geometrie/plan';
import { plan, preparer } from './outils';

const carre: XY[] = [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100],
];
const reglages = { distance: 2, interieur: true, seuil: 30, base: 'Semoir 4 m' };
const enXY = (g: Guidage) =>
  g.points.map((p) => plan.versXY(p).map((v) => Math.round(v * 100) / 100 + 0));

describe('lignes de guidage d’une parcelle', () => {
  it('carré : 4 coins, 4 droites AB à 2 m à l’intérieur, numérotées', () => {
    const { etat } = preparer({ X: carre });
    const r = lignesDeParcelle(etat, 0, reglages)!;
    expect(r.coins).toHaveLength(4);
    expect(r.ignores).toBe(0);
    expect(r.lignes.map((g) => [g.type, g.nom])).toEqual([
      ['ab', 'Semoir 4 m 1'],
      ['ab', 'Semoir 4 m 2'],
      ['ab', 'Semoir 4 m 3'],
      ['ab', 'Semoir 4 m 4'],
    ]);
    expect(enXY(r.lignes[0]!)).toEqual([
      [0, 2],
      [100, 2],
    ]);
    expect(aControler(r)).toBe(false);
    // Vers l'extérieur : de l'autre côté.
    const ext = lignesDeParcelle(etat, 0, { ...reglages, interieur: false })!;
    expect(enXY(ext.lignes[0]!)).toEqual([
      [0, -2],
      [100, -2],
    ]);
  });

  it('un petit décrochement : côté sans ligne, parcelle à contrôler', () => {
    const { etat } = preparer({
      X: [
        [0, 0],
        [100, 0],
        [100, 50],
        [90, 50],
        [90, 100],
        [0, 100],
      ],
    });
    const r = lignesDeParcelle(etat, 0, reglages)!;
    expect(r.ignores).toBe(1);
    expect(aControler(r)).toBe(true);
  });

  it('ligne sur un bord : intérieur bien choisi, numéro à la suite du jeu', () => {
    const { etat } = preparer({ X: carre });
    const premiere = ligneSurBord(
      etat,
      { anneau: 0, debut: 0, fin: 1, aRebours: false },
      'ab',
      reglages,
    );
    expect(premiere.nom).toBe('Semoir 4 m 1');
    expect(enXY(premiere)).toEqual([
      [0, 2],
      [100, 2],
    ]);
    const e = ajouterGuidages(etat, [premiere], null);
    expect(numeroSuivant(e, 0, 'Semoir 4 m')).toBe(2);
    expect(numeroSuivant(e, 0, 'Pulvé')).toBe(1);
  });

  it('regénérer un jeu remplace ses lignes, sans toucher aux autres jeux', () => {
    const { etat } = preparer({ X: carre });
    const semoir = lignesDeParcelle(etat, 0, reglages)!.lignes;
    const pulve = lignesDeParcelle(etat, 0, { ...reglages, base: 'Pulvé 24 m' })!.lignes;
    let e = ajouterGuidages(etat, semoir, 'Semoir 4 m');
    e = ajouterGuidages(e, pulve, 'Pulvé 24 m');
    e = ajouterGuidages(e, semoir, 'Semoir 4 m');
    expect(e.guidages).toHaveLength(8);
    expect(duJeu(e.guidages![0]!, 'Pulvé 24 m')).toBe(true);
    expect(duJeu({ ...semoir[0]!, nom: 'Semoir 4 m bis' }, 'Semoir 4 m')).toBe(false);
  });

  it('tout supprimer : sur une parcelle ou sur toutes', () => {
    const { etat } = preparer({ X: carre });
    const lignes = lignesDeParcelle(etat, 0, reglages)!.lignes;
    const autre = lignes.map((g) => ({ ...g, parcelle: 1 }));
    const e = ajouterGuidages(etat, [...lignes, ...autre], null);
    expect(retirerGuidages(e, 0).guidages).toEqual(autre);
    expect(retirerGuidages(e, null).guidages).toEqual([]);
    // Rien à retirer : même état (rien au journal).
    expect(retirerGuidages(etat, null)).toBe(etat);
    expect(retirerGuidages(e, 5)).toBe(e);
  });
});

describe('point dans un polygone', () => {
  it('dedans, dehors', () => {
    expect(pointDansPolygone([50, 50], carre)).toBe(true);
    expect(pointDansPolygone([150, 50], carre)).toBe(false);
  });
});

describe('jeux de lignes', () => {
  it('le nom du jeu est le nom sans son numéro', () => {
    expect(jeuDe('Semoir 4 m 3')).toBe('Semoir 4 m');
    expect(jeuDe('Pulvé 38 m 12')).toBe('Pulvé 38 m');
    expect(jeuDe('A=B 2026.10.13_11:36_4')).toBe('A=B 2026.10.13_11:36_4');
    const { etat } = preparer({ X: carre });
    const semoir = lignesDeParcelle(etat, 0, reglages)!.lignes;
    const pulve = lignesDeParcelle(etat, 0, { ...reglages, base: 'Pulvé 38 m' })!.lignes;
    expect(jeux([...semoir, ...pulve, ...semoir])).toEqual(['Semoir 4 m', 'Pulvé 38 m']);
  });
});
