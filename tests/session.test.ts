import { describe, expect, it } from 'vitest';
import { latLon } from '../src/edition/etat';
import { exporterEtat } from '../src/edition/export';
import { decalerLimite, supprimerSommet } from '../src/edition/operations';
import {
  enregistrerSession,
  ErreurSession,
  garderSurAppareil,
  lireSurAppareil,
  relireSession,
} from '../src/sauvegarde/session';
import { changerFiche, suiviVide } from '../src/suivi/suivi';
import { preparer } from './outils';

const parcelles = {
  X: [
    [0, 0],
    [100, 0],
    [100, 100],
    [50, 120],
    [0, 80],
  ],
  Y: [
    [100, 0],
    [200, 0],
    [200, 70],
    [100, 100],
  ],
} as Record<string, [number, number][]>;

describe('session enregistrée', () => {
  it('se relit à l’identique, avec points déplacés, ajoutés et supprimés', () => {
    const { td, etat } = preparer(parcelles);
    let e = decalerLimite(etat, { anneau: 0, debut: 1 }, 2); // X reçoit un sommet
    e = supprimerSommet(e, { anneau: 0, sommet: 4 });
    const suivi = changerFiche(suiviVide(), td.parcelles[0]!, { etat: 'verifie' });
    const s = enregistrerSession(td, 'TASKDATA.XML', e, 'tablette', suivi);
    const relu = relireSession(JSON.parse(JSON.stringify(s)));
    expect(relu.nom).toBe('TASKDATA.XML');
    expect(relu.session.appareil).toBe('tablette');
    expect(relu.session.suivi).toEqual(suivi);
    expect(relu.etat.anneaux.map((a) => a.sommets.map(latLon))).toEqual(
      e.anneaux.map((a) => a.sommets.map(latLon)),
    );
    expect(relu.etat.anneaux.map((a) => a.sommets.map((x) => x.origine === null))).toEqual(
      e.anneaux.map((a) => a.sommets.map((x) => x.origine === null)),
    );
    // L'export depuis la session relue est identique à l'export d'avant l'enregistrement.
    expect(exporterEtat(relu.td, relu.etat)).toBe(exporterEtat(td, e));
  });

  it('garde les retraits déjà exportés, sans changer le fichier produit', () => {
    const { td, etat } = preparer(parcelles);
    const e = { ...etat, supprimees: [1], exportes: { parcelles: [1], zones: [] } };
    const relu = relireSession(JSON.parse(JSON.stringify(enregistrerSession(td, 'T', e, 'x'))));
    expect(relu.etat.exportes).toEqual({ parcelles: [1], zones: [] });
    expect(exporterEtat(td, e)).toBe(exporterEtat(td, { ...etat, supprimees: [1] }));
  });

  it('se garde dans le stockage du téléphone', () => {
    const { td, etat } = preparer(parcelles);
    const memoire = new Map<string, string>();
    const stockage = {
      getItem: (k: string) => memoire.get(k) ?? null,
      setItem: (k: string, v: string) => void memoire.set(k, v),
    };
    expect(lireSurAppareil(stockage)).toBeNull();
    expect(garderSurAppareil(stockage, enregistrerSession(td, 'a.xml', etat, 'téléphone'))).toBe(
      true,
    );
    expect(relireSession(lireSurAppareil(stockage)).nom).toBe('a.xml');
  });

  it('refuse une sauvegarde abîmée', () => {
    expect(() => relireSession({ version: 2 })).toThrow(ErreurSession);
    expect(() => relireSession(null)).toThrow(ErreurSession);
  });
});
