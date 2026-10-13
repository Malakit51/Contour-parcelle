import { describe, expect, it } from 'vitest';
import { Drive, ErreurDrive, NOM_FICHIER_DRIVE } from '../src/sauvegarde/drive';

/** Faux Google Drive en mémoire, qui répond comme l'API v3 pour ce que l'éditeur utilise. */
function fauxDrive() {
  const fichiers = new Map<string, { nom: string; contenu: string; modifie: string }>();
  let n = 0;
  const appels: string[] = [];
  const requete = async (url: string | URL | Request, init: RequestInit = {}) => {
    const u = new URL(String(url));
    const methode = init.method ?? 'GET';
    appels.push(`${methode} ${u.pathname}`);
    const auth = (init.headers as Record<string, string>)?.Authorization;
    if (auth !== 'Bearer jeton') return new Response('', { status: 401 });
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
    const horodatage = () => new Date(Date.UTC(2026, 9, 13, 12, 0, n++)).toISOString();
    if (u.pathname === '/drive/v3/files' && methode === 'GET') {
      const nom = /name='([^']+)'/.exec(u.searchParams.get('q') ?? '')?.[1];
      const trouves = [...fichiers.entries()]
        .filter(([, f]) => f.nom === nom)
        .map(([id, f]) => ({ id, modifiedTime: f.modifie }));
      return json({ files: trouves });
    }
    if (u.pathname === '/drive/v3/about') {
      return json({ user: { emailAddress: 'essai@exemple.fr' } });
    }
    const media = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
    if (media && u.searchParams.get('alt') === 'media') {
      return new Response(fichiers.get(media[1]!)!.contenu, { status: 200 });
    }
    if (u.pathname.startsWith('/upload/drive/v3/files')) {
      const parties = String(init.body).split(/\r\n--[^\r\n]+/);
      const meta = JSON.parse(parties[0]!.split('\r\n\r\n')[1]!) as { name?: string };
      const contenu = parties[1]!.split('\r\n\r\n')[1]!;
      const id = methode === 'POST' ? `f${n}` : u.pathname.split('/').pop()!;
      const ancien = fichiers.get(id);
      fichiers.set(id, { nom: meta.name ?? ancien!.nom, contenu, modifie: horodatage() });
      return json({ id, modifiedTime: fichiers.get(id)!.modifie });
    }
    return new Response('', { status: 404 });
  };
  return { requete: requete as typeof fetch, fichiers, appels };
}

describe('sauvegarde Google Drive', () => {
  it('crée le fichier une fois, puis le remplace ; le relit à l’identique', async () => {
    const faux = fauxDrive();
    const drive = new Drive('client-test', faux.requete);
    drive.utiliserJeton('jeton');
    expect(await drive.lire()).toBeNull();
    const premier = await drive.ecrire({ a: 1 });
    const second = await drive.ecrire({ a: 2, texte: 'é ; "x"' });
    expect(second.id).toBe(premier.id);
    expect(faux.fichiers.size).toBe(1);
    expect([...faux.fichiers.values()][0]!.nom).toBe(NOM_FICHIER_DRIVE);
    const lu = await drive.lire();
    expect(lu?.contenu).toEqual({ a: 2, texte: 'é ; "x"' });
    expect(faux.appels.filter((a) => a.startsWith('POST'))).toHaveLength(1);
    expect(faux.appels.filter((a) => a.startsWith('PATCH'))).toHaveLength(1);
  });

  it('signale une connexion absente, expirée ou refusée', async () => {
    const faux = fauxDrive();
    const drive = new Drive('client-test', faux.requete);
    await expect(drive.lire()).rejects.toThrow(ErreurDrive);
    drive.utiliserJeton('autre-jeton');
    await expect(drive.lire()).rejects.toThrow(/expirée/);
    expect(drive.connecte()).toBe(false);
    expect(new Drive('').configure()).toBe(false);
  });

  it('donne l’adresse du compte connecté', async () => {
    const drive = new Drive('client-test', fauxDrive().requete);
    drive.utiliserJeton('jeton');
    expect(await drive.compte()).toBe('essai@exemple.fr');
  });
});
