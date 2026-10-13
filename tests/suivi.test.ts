import { describe, expect, it } from 'vitest';
import {
  changerFiche,
  charger,
  cleParcelle,
  comparerVersions,
  csvJournal,
  csvSuivi,
  enregistrer,
  fiche,
  fusionner,
  suiviVide,
  versionSuivante,
} from '../src/suivi/suivi';
import { preparer } from './outils';

const { td } = preparer({
  'Le Bois': [
    [0, 0],
    [10, 0],
    [0, 10],
  ],
  '12 Jard/1': [
    [20, 0],
    [30, 0],
    [20, 10],
  ],
});
const [bois, jard] = td.parcelles;

describe('suivi des contours', () => {
  it('par défaut, un contour est « à confirmer »', () => {
    expect(fiche(suiviVide(), bois!).etat).toBe('a-confirmer');
  });

  it('changer l’état ou la remarque met la date à jour', () => {
    const jour = new Date(2026, 9, 13, 15, 30);
    const s = changerFiche(suiviVide(), bois!, { etat: 'verifie' }, jour);
    const s2 = changerFiche(s, bois!, { remarque: 'bord du bois ; à revoir' }, jour);
    expect(fiche(s2, bois!)).toEqual({
      nom: 'Le Bois',
      etat: 'verifie',
      date: '2026-10-13',
      remarque: 'bord du bois ; à revoir',
    });
    expect(fiche(s2, jard!).etat).toBe('a-confirmer');
  });

  it('repère une parcelle par son nom quand le fichier n’a pas de GUID', () => {
    expect(cleParcelle(bois!)).toBe('nom:Le Bois');
  });

  it('se conserve dans le stockage du téléphone, et survit à un contenu abîmé', () => {
    const memoire = new Map<string, string>();
    const stockage = {
      getItem: (k: string) => memoire.get(k) ?? null,
      setItem: (k: string, v: string) => void memoire.set(k, v),
    };
    const s = changerFiche(suiviVide(), jard!, { etat: 'a-refaire' });
    expect(enregistrer(stockage, s)).toBe(true);
    expect(charger(stockage)).toEqual(s);
    memoire.set('contour-parcelle/suivi', '{abîmé');
    expect(charger(stockage)).toEqual(suiviVide());
    expect(charger(null)).toEqual(suiviVide());
  });

  it('CSV lisible par un tableur français', () => {
    const jour = new Date(2026, 9, 13, 15, 30);
    let s = changerFiche(suiviVide(), bois!, { etat: 'verifie', remarque: 'bord ; "net"' }, jour);
    s = {
      ...s,
      journal: [
        {
          quand: jour.toISOString(),
          cle: cleParcelle(bois!),
          parcelle: 'Le Bois',
          action: 'Limite Sud décalée de +0,5 m',
          surfaceAvant: 10000,
          surfaceApres: 10049.6,
        },
      ],
    };
    expect(csvSuivi(s, td.parcelles)).toBe(
      '﻿Parcelle;État;Date;Remarque\r\n' +
        '12 Jard/1;À confirmer;;\r\n' +
        'Le Bois;Vérifié;2026-10-13;"bord ; ""net"""\r\n',
    );
    expect(csvJournal(s)).toBe(
      '﻿Date;Heure;Parcelle;Action;Surface avant (m²);Surface après (m²)\r\n' +
        '2026-10-13;15:30;Le Bois;Limite Sud décalée de +0,5 m;10000;10050\r\n',
    );
  });
});

describe('fusion de deux appareils', () => {
  it('garde la fiche la plus récente et additionne les journaux sans doublons', () => {
    const lundi = new Date(2026, 9, 12);
    const mardi = new Date(2026, 9, 13);
    const ligne = (quand: string, action: string) => ({
      quand,
      cle: cleParcelle(bois!),
      parcelle: 'Le Bois',
      action,
      surfaceAvant: null,
      surfaceApres: null,
    });
    const telephone = {
      ...changerFiche(suiviVide(), bois!, { etat: 'a-refaire' }, lundi),
      journal: [ligne('2026-10-12T08:00:00.000Z', 'A'), ligne('2026-10-13T08:00:00.000Z', 'C')],
    };
    const tablette = {
      ...changerFiche(
        changerFiche(suiviVide(), bois!, { etat: 'verifie' }, mardi),
        jard!,
        { etat: 'a-refaire' },
        lundi,
      ),
      journal: [ligne('2026-10-12T08:00:00.000Z', 'A'), ligne('2026-10-12T09:00:00.000Z', 'B')],
    };
    const f = fusionner(telephone, tablette);
    expect(fiche(f, bois!).etat).toBe('verifie');
    expect(fiche(f, jard!).etat).toBe('a-refaire');
    expect(f.journal.map((e) => e.action)).toEqual(['A', 'B', 'C']);
    expect(fusionner(tablette, telephone).fiches).toEqual(f.fiches);
  });
});

describe('numéro de version des exports', () => {
  it('continue la notation : 0.11 → 0.12, 0.9 → 0.10', () => {
    expect(versionSuivante('0.11')).toBe('0.12');
    expect(versionSuivante('0.9')).toBe('0.10');
    expect(versionSuivante('3')).toBe('4');
    expect(versionSuivante('v')).toBe('v.1');
  });

  it('la fusion de deux appareils garde la version la plus récente', () => {
    expect(comparerVersions('0.10', '0.9')).toBeGreaterThan(0);
    const a = { ...suiviVide(), derniereVersion: '0.10' };
    const b = { ...suiviVide(), derniereVersion: '0.9' };
    expect(fusionner(a, b).derniereVersion).toBe('0.10');
    expect(fusionner(b, a).derniereVersion).toBe('0.10');
    expect(fusionner(suiviVide(), suiviVide()).derniereVersion).toBeUndefined();
  });
});
