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
  importerCsv,
  csvNotes,
  enregistrerNote,
  notesDe,
  supprimerNote,
  typesDeNotes,
  type Note,
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

describe('restaurer le suivi depuis un CSV', () => {
  const jour = new Date(2026, 9, 13, 15, 30);
  let complet = changerFiche(
    suiviVide(),
    bois!,
    { etat: 'verifie', remarque: 'bord ; "net"' },
    jour,
  );
  complet = changerFiche(complet, jard!, { etat: 'a-refaire' }, jour);
  complet = {
    ...complet,
    journal: [
      {
        quand: jour.toISOString(),
        cle: cleParcelle(bois!),
        parcelle: 'Le Bois',
        action: 'Limite Sud décalée de +0,5 m',
        surfaceAvant: 10000,
        surfaceApres: 10049.6,
      },
      {
        quand: new Date(2026, 9, 13, 16, 0).toISOString(),
        cle: 'export',
        parcelle: '—',
        action: 'Exporté (version 0.12)',
        surfaceAvant: null,
        surfaceApres: null,
      },
    ],
  };

  it('aller-retour : le suivi exporté puis réimporté sur un appareil vide redonne les fiches', () => {
    const r = importerCsv(suiviVide(), csvSuivi(complet, td.parcelles), td.parcelles);
    expect(r.bilan).toEqual({ type: 'suivi', ajouts: 2, dejaLa: 0, inconnues: [] });
    expect(r.suivi.fiches).toEqual(complet.fiches);
    // Une deuxième fois : rien de nouveau.
    const r2 = importerCsv(r.suivi, csvSuivi(complet, td.parcelles), td.parcelles);
    expect(r2.bilan.ajouts).toBe(0);
  });

  it('une fiche plus récente sur l’appareil n’est pas écrasée', () => {
    const recent = changerFiche(suiviVide(), bois!, { etat: 'a-confirmer' }, new Date(2026, 9, 15));
    const r = importerCsv(recent, csvSuivi(complet, td.parcelles), td.parcelles);
    expect(fiche(r.suivi, bois!).etat).toBe('a-confirmer');
    expect(fiche(r.suivi, jard!).etat).toBe('a-refaire');
    expect(r.bilan).toMatchObject({ ajouts: 1, dejaLa: 1 });
  });

  it('CSV retouché dans un tableur (dates JJ/MM/AAAA, sans accents) et nom inconnu', () => {
    const texte =
      'Parcelle;Etat;Date;Remarque\r\nLe Bois;verifie;13/10/2026;ok\r\nInconnue;Vérifié;;\r\n';
    const r = importerCsv(suiviVide(), texte, td.parcelles);
    expect(fiche(r.suivi, bois!)).toMatchObject({
      etat: 'verifie',
      date: '2026-10-13',
      remarque: 'ok',
    });
    expect(r.bilan.inconnues).toEqual(['Inconnue']);
  });

  it('journal : réimporté sur un appareil vide, puis sans doublon', () => {
    const r = importerCsv(suiviVide(), csvJournal(complet), td.parcelles);
    expect(r.bilan).toEqual({ type: 'journal', ajouts: 2, dejaLa: 0, inconnues: [] });
    expect(r.suivi.journal.map((e) => [e.cle, e.action, e.surfaceApres])).toEqual([
      [cleParcelle(bois!), 'Limite Sud décalée de +0,5 m', 10050],
      ['export', 'Exporté (version 0.12)', null],
    ]);
    expect(r.suivi.journal[0]!.quand).toBe(complet.journal[0]!.quand);
    // Sur l'appareil qui a encore son journal : rien n'est ajouté.
    expect(importerCsv(complet, csvJournal(complet), td.parcelles).bilan.dejaLa).toBe(2);
  });

  it('refuse un autre fichier', () => {
    expect(() => importerCsv(suiviVide(), 'a;b\r\n1;2\r\n', td.parcelles)).toThrow(/ni un CSV/);
  });
});

describe('notes sur les parcelles', () => {
  const note = (
    id: string,
    type: string,
    texte: string,
    quand: string,
    position: [number, number] | null = null,
  ): Note => ({
    id,
    cle: cleParcelle(bois!),
    parcelle: 'Le Bois',
    type,
    texte,
    creee: quand,
    modifiee: quand,
    position,
  });
  const n1 = note(
    'a',
    'Vulpin',
    'foyer ; près du bois',
    '2026-10-15T08:00:00.000Z',
    [45.0001234, 2.0005678],
  );
  const n2 = note('b', 'Chardons', '', '2026-10-16T08:00:00.000Z');

  it('ajout, modification, suppression ; types proposés par fréquence', () => {
    let s = enregistrerNote(enregistrerNote(suiviVide(), n1), n2);
    s = enregistrerNote(s, note('c', 'Vulpin', 'autre foyer', '2026-10-16T09:00:00.000Z'));
    expect(notesDe(s, bois!).map((n) => n.id)).toEqual(['c', 'b', 'a']);
    expect(notesDe(s, jard!)).toEqual([]);
    expect(typesDeNotes(s)).toEqual(['Vulpin', 'Chardons']);
    s = enregistrerNote(s, { ...n2, texte: 'en bordure', modifiee: '2026-10-16T10:00:00.000Z' });
    expect(notesDe(s, bois!).find((n) => n.id === 'b')!.texte).toBe('en bordure');
    s = supprimerNote(s, 'c', new Date('2026-10-16T11:00:00.000Z'));
    expect(notesDe(s, bois!).map((n) => n.id)).toEqual(['b', 'a']);
  });

  it('fusion entre appareils : la dernière modification l’emporte, une suppression ne revient pas', () => {
    const a = enregistrerNote(enregistrerNote(suiviVide(), n1), n2);
    const b = supprimerNote(a, 'a', new Date('2026-10-16T12:00:00.000Z'));
    expect(notesDe(fusionner(a, b), bois!).map((n) => n.id)).toEqual(['b']);
    expect(notesDe(fusionner(b, a), bois!).map((n) => n.id)).toEqual(['b']);
  });

  it('CSV des notes : export puis reprise sans doublon', () => {
    const s = enregistrerNote(enregistrerNote(suiviVide(), n1), { ...n2, obstacle: true });
    const csv = csvNotes(s);
    expect(csv).toContain('Parcelle;Type;Note;Date;Latitude;Longitude;Obstacle\r\n');
    expect(csv).toContain(
      'Le Bois;Vulpin;"foyer ; près du bois";2026-10-15;45.0001234;2.0005678;\r\n',
    );
    expect(csv).toContain('Le Bois;Chardons;;2026-10-16;;;oui\r\n');
    const r = importerCsv(suiviVide(), csv, td.parcelles);
    expect(r.bilan).toEqual({ type: 'notes', ajouts: 2, dejaLa: 0, inconnues: [] });
    const reprises = notesDe(r.suivi, bois!);
    expect(reprises.map((n) => [n.type, n.texte, n.position, !!n.obstacle])).toEqual([
      ['Chardons', '', null, true],
      ['Vulpin', 'foyer ; près du bois', [45.0001234, 2.0005678], false],
    ]);
    expect(importerCsv(s, csv, td.parcelles).bilan).toMatchObject({ ajouts: 0, dejaLa: 2 });
  });
});
