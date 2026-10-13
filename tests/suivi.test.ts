import { describe, expect, it } from 'vitest';
import {
  changerFiche,
  charger,
  cleParcelle,
  csvJournal,
  csvSuivi,
  enregistrer,
  fiche,
  suiviVide,
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
