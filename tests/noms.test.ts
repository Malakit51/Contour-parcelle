import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { etatInitial } from '../src/edition/etat';
import { exporterEtat, verifierRelecture } from '../src/edition/export';
import { appliquerNoms, renommer } from '../src/edition/noms';
import { comparer } from '../src/isoxml/comparaison';
import { lireTaskData } from '../src/isoxml/lecture';
import { enregistrerSession, relireSession } from '../src/sauvegarde/session';

const texte = readFileSync('tests/fixtures/console-anonyme.xml', 'utf8');

describe('renommer une parcelle', () => {
  it('le nom change dans le PFD (C) et le contour (PLN B), rien d’autre', () => {
    const td = lireTaskData(texte);
    const p = td.parcelles.findIndex((x) => x.nom === '13 Jard');
    const etat0 = etatInitial(td);
    const avant = exporterEtat(td, etat0);
    const etat = renommer(td, etat0, p, '  13  Jardin & Co ');
    expect(etat.noms).toEqual([{ parcelle: p, nom: '13 Jardin & Co' }]);
    appliquerNoms(td, etat);
    expect(td.parcelles[p]!.nom).toBe('13 Jardin & Co');
    const sortie = exporterEtat(td, etat);
    expect(verifierRelecture(td, etat, sortie)).toEqual([]);
    expect(lireTaskData(sortie).parcelles[p]!.nom).toBe('13 Jardin & Co');
    const diffs = comparer(avant, sortie).filter((d) => d.avant !== null && d.apres !== null);
    expect(diffs.map((d) => d.apres!.replace(/\r?\n$/, ''))).toEqual([
      expect.stringMatching(/^<PFD [^>]*C="13 Jardin &amp; Co"/),
      '<PLN A="1" B="13 Jardin &amp; Co">',
    ]);
    // Session, puis retour au nom d'origine : plus de renommage.
    const relue = relireSession(
      JSON.parse(JSON.stringify(enregistrerSession(td, 'TASKDATA.XML', etat, 'essai'))),
    );
    expect(relue.etat.noms).toEqual(etat.noms);
    expect(renommer(td, etat, p, '13 Jard').noms).toBeUndefined();
    appliquerNoms(td, etat0);
    expect(td.parcelles[p]!.nom).toBe('13 Jard');
  });

  it('refuse un nom vide ou déjà pris', () => {
    const td = lireTaskData(texte);
    const etat = etatInitial(td);
    expect(() => renommer(td, etat, 0, ' ')).toThrow(/vide/);
    expect(() => renommer(td, etat, 0, '14 JARD')).toThrow(/déjà/);
  });
});
