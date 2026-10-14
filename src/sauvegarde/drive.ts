// Sauvegarde en ligne dans Google Drive.
//
// Un seul fichier, « contour-parcelle-sauvegarde.json », dans le Drive de l'utilisateur. L'accès
// demandé à Google est le plus restreint possible (« drive.file ») : l'éditeur ne voit que les
// fichiers qu'il a lui-même créés, rien d'autre du Drive. Connexion par Google Identity Services ;
// le jeton dure environ une heure, après quoi il faut se reconnecter d'un appui.

export const NOM_FICHIER_DRIVE = 'contour-parcelle-sauvegarde.json';
const PORTEE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3/files';
const ENVOI = 'https://www.googleapis.com/upload/drive/v3/files';

export class ErreurDrive extends Error {
  override name = 'ErreurDrive';
}

/** La sauvegarde en ligne a changé depuis la dernière fois que cet appareil l'a lue ou écrite. */
export class ConflitDrive extends ErreurDrive {
  override name = 'ConflitDrive';
  constructor(readonly fichier: FichierDrive) {
    super('La sauvegarde en ligne a été modifiée depuis un autre appareil.');
  }
}

// Types minimaux de Google Identity Services (chargé à la demande depuis accounts.google.com).
interface ReponseJeton {
  access_token?: string;
  expires_in?: number;
  error?: string;
}
interface ClientJeton {
  requestAccessToken(options?: { prompt?: string }): void;
}
interface Gis {
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        login_hint?: string;
        callback: (r: ReponseJeton) => void;
        error_callback?: (e: { type: string }) => void;
      }): ClientJeton;
    };
  };
}

function chargerGis(): Promise<Gis> {
  const deja = (window as unknown as { google?: Gis }).google;
  if (deja?.accounts?.oauth2) return Promise.resolve(deja);
  return new Promise((resoudre, rejeter) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resoudre((window as unknown as { google: Gis }).google);
    script.onerror = () => rejeter(new ErreurDrive('Impossible de joindre Google (réseau ?).'));
    document.head.append(script);
  });
}

export interface FichierDrive {
  id: string;
  /** Date de dernière modification dans Drive (ISO). */
  modifie: string;
}

export class Drive {
  private jeton: string | null = null;
  private expire = 0;
  private client: ClientJeton | null = null;

  constructor(
    private readonly idClient: string,
    private readonly requete: typeof fetch = (...a) => fetch(...a),
  ) {}

  configure(): boolean {
    return this.idClient.trim() !== '';
  }

  connecte(): boolean {
    return this.jeton !== null && Date.now() < this.expire - 60_000;
  }

  /**
   * Ouvre la fenêtre de connexion Google (à appeler depuis un appui sur un bouton). Avec `compte`
   * (adresse déjà autorisée), Google ne redemande ni le compte ni l'autorisation : la fenêtre se
   * referme d'elle-même.
   */
  async connecter(compte?: string): Promise<void> {
    if (!this.configure()) throw new ErreurDrive('Sauvegarde Google Drive pas encore configurée.');
    const gis = await chargerGis();
    await new Promise<void>((resoudre, rejeter) => {
      this.client = gis.accounts.oauth2.initTokenClient({
        client_id: this.idClient,
        scope: PORTEE,
        ...(compte ? { login_hint: compte } : {}),
        callback: (r) => {
          if (!r.access_token) {
            rejeter(new ErreurDrive(`Connexion refusée (${r.error ?? 'inconnue'}).`));
            return;
          }
          this.jeton = r.access_token;
          this.expire = Date.now() + (r.expires_in ?? 3600) * 1000;
          resoudre();
        },
        error_callback: (e) =>
          rejeter(
            new ErreurDrive(
              e.type === 'popup_closed'
                ? 'Connexion annulée.'
                : `Connexion impossible (${e.type}).`,
            ),
          ),
      });
      this.client.requestAccessToken({ prompt: '' });
    });
  }

  deconnecter(): void {
    this.jeton = null;
    this.expire = 0;
  }

  private async appeler(url: string, init: RequestInit = {}): Promise<Response> {
    if (!this.connecte()) throw new ErreurDrive('Connexion à Google expirée : reconnecte-toi.');
    const r = await this.requete(url, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${this.jeton}` },
    });
    if (r.status === 401) {
      this.deconnecter();
      throw new ErreurDrive('Connexion à Google expirée : reconnecte-toi.');
    }
    if (!r.ok) throw new ErreurDrive(`Google Drive a répondu ${r.status}.`);
    return r;
  }

  /** Adresse du compte Google connecté (pour le reconnecter ensuite sans le redemander). */
  async compte(): Promise<string | null> {
    const r = await this.appeler(
      `https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)`,
    );
    return ((await r.json()) as { user?: { emailAddress?: string } }).user?.emailAddress ?? null;
  }

  /** Le fichier de sauvegarde, s'il existe (le plus récent s'il y en a plusieurs). */
  async trouver(): Promise<FichierDrive | null> {
    const q = encodeURIComponent(`name='${NOM_FICHIER_DRIVE}' and trashed=false`);
    const r = await this.appeler(
      `${API}?q=${q}&orderBy=modifiedTime desc&fields=files(id,modifiedTime)&pageSize=1`,
    );
    const f = ((await r.json()) as { files?: { id: string; modifiedTime: string }[] }).files?.[0];
    return f ? { id: f.id, modifie: f.modifiedTime } : null;
  }

  async lire(): Promise<{ contenu: unknown; fichier: FichierDrive } | null> {
    const fichier = await this.trouver();
    if (!fichier) return null;
    const r = await this.appeler(`${API}/${fichier.id}?alt=media`);
    return { contenu: await r.json(), fichier };
  }

  /**
   * Crée ou remplace le fichier de sauvegarde. Avec `versionVue` (date de modification du fichier
   * en ligne lors de la dernière lecture ou écriture par cet appareil, null s'il n'en a jamais vu),
   * refuse d'écraser un fichier modifié entre-temps par un autre appareil (ConflitDrive).
   */
  async ecrire(contenu: unknown, versionVue?: string | null): Promise<FichierDrive> {
    const existant = await this.trouver();
    if (versionVue !== undefined && existant && existant.modifie !== versionVue) {
      throw new ConflitDrive(existant);
    }
    const limite = 'contour-parcelle-' + Math.random().toString(36).slice(2);
    const corps =
      `--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(existant ? {} : { name: NOM_FICHIER_DRIVE, mimeType: 'application/json' }) +
      `\r\n--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(contenu) +
      `\r\n--${limite}--`;
    const r = await this.appeler(
      existant
        ? `${ENVOI}/${existant.id}?uploadType=multipart&fields=id,modifiedTime`
        : `${ENVOI}?uploadType=multipart&fields=id,modifiedTime`,
      {
        method: existant ? 'PATCH' : 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${limite}` },
        body: corps,
      },
    );
    const f = (await r.json()) as { id: string; modifiedTime: string };
    return { id: f.id, modifie: f.modifiedTime };
  }

  /** Pour les tests : jeton fourni directement. */
  utiliserJeton(jeton: string, dureeS = 3600): void {
    this.jeton = jeton;
    this.expire = Date.now() + dureeS * 1000;
  }
}
