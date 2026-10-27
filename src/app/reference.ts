// Ancien TASKDATA ou shapefile affiché en référence, et remplacement d’un contour.

import {
  anneauIgnore,
  distanceM,
  etatInitial,
  latLon,
  sommetsEn,
  type Etat,
} from '../edition/etat';
import { nouvelleSurface } from '../edition/export';
import { type BilanReprise, reprendreBord } from '../edition/reprise-bord';
import { remplacerContour } from '../edition/operations';
import { type LatLon, planLocal, pointDansPolygone, type XY } from '../geometrie/plan';
import { lireTaskData } from '../isoxml/lecture';
import { decoder } from '../isoxml/octets';
import { el } from '../ui/dom';
import { dezipper } from '../formats/dezip';
import { type FichiersShapefile, lireShapefile } from '../formats/lecture-shapefile';
import { RAYON_TOUCHER_PX, type Session, ui } from './etat';
import { afficher } from './mise-en-page';
import { arreterOutilsCarte, effacerSelection, modifier } from './travail';
import { nomParcelle } from './vue';

/** Shapefile choisi : un .zip, ou le .shp avec ses fichiers voisins (.dbf, .prj, .cpg). */
async function fichiersShapefile(fichiers: File[]): Promise<FichiersShapefile> {
  const contenus = new Map<string, Uint8Array>();
  for (const f of fichiers) {
    const octets = new Uint8Array(await f.arrayBuffer());
    if (/\.zip$/i.test(f.name))
      for (const [nom, o] of await dezipper(octets)) contenus.set(nom.split('/').pop()!, o);
    else contenus.set(f.name, octets);
  }
  const shp = [...contenus.keys()].find((n) => /\.shp$/i.test(n));
  if (!shp) throw new Error('aucun fichier .shp');
  const base = shp.slice(0, -4);
  const voisin = (ext: string) =>
    [...contenus.entries()].find(([n]) => n.toLowerCase() === `${base}.${ext}`.toLowerCase())?.[1];
  const texte = (o?: Uint8Array) => (o ? new TextDecoder().decode(o) : undefined);
  return {
    shp: contenus.get(shp)!,
    dbf: voisin('dbf'),
    prj: texte(voisin('prj')),
    cpg: texte(voisin('cpg')),
  };
}

/** Affiche en référence un ancien TASKDATA.XML ou un shapefile (.zip, ou .shp et ses voisins). */
export async function chargerReference(fichiers: File[]): Promise<void> {
  try {
    const shapefile = fichiers.some((f) => /\.(zip|shp|dbf)$/i.test(f.name));
    if (shapefile) {
      const lus = lireShapefile(await fichiersShapefile(fichiers));
      if (lus.length === 0) throw new Error('aucun polygone dans ce shapefile');
      const nom = fichiers.find((f) => /\.(zip|shp)$/i.test(f.name))?.name ?? fichiers[0]!.name;
      ui.reference = {
        nom,
        anneaux: lus.flatMap((l) => [l.contour, ...l.trous]),
        parcelles: lus.map((l) => ({ nom: l.nom, guid: l.guid, contour: l.contour })),
      };
      ui.message = {
        texte: `${nom} affiché en référence : ${lus.length} contour(s).`,
        erreur: false,
      };
    } else {
      const f = fichiers[0]!;
      const td = lireTaskData(decoder(new Uint8Array(await f.arrayBuffer())));
      const e = etatInitial(td);
      ui.reference = {
        nom: f.name,
        anneaux: e.anneaux.map((a) => a.sommets.map(latLon)),
        parcelles: td.parcelles.flatMap((p, i) => {
          const ext = e.anneaux.find((a) => a.parcelle === i && a.type === 1);
          return ext ? [{ nom: p.nom, guid: p.guid, contour: ext.sommets.map(latLon) }] : [];
        }),
      };
      ui.message = { texte: `${f.name} affiché en référence.`, erreur: false };
    }
  } catch (e) {
    ui.message = { texte: `Lecture impossible : ${(e as Error).message}`, erreur: true };
  }
  afficher();
}

export function panneauReference(): HTMLElement {
  const choix = el(
    'label',
    { class: 'bouton-fichier secondaire' },
    ui.reference ? 'Autre référence' : 'Ancien TASKDATA ou shapefile',
  );
  // Plusieurs fichiers à la fois : un shapefile sans .zip (.shp, .dbf, .prj ensemble).
  const input = el('input', { type: 'file', multiple: '' });
  input.addEventListener('change', () => {
    const f = [...(input.files ?? [])];
    if (f.length > 0) void chargerReference(f);
  });
  choix.append(input);
  return el(
    'div',
    { class: 'info' },
    ui.reference && el('div', { class: 'doux' }, `${ui.reference.nom} (en gris sur la carte)`),
    el(
      'div',
      { class: 'rangee' },
      choix,
      ui.reference &&
        el(
          'button',
          {
            onclick: () => {
              ui.reference = null;
              afficher();
            },
          },
          'Retirer',
        ),
    ),
  );
}

/** Parcelle de la référence qui correspond à la parcelle `p` : même GUID, même nom, ou qui la recouvre. */
export function parcelleDeReference(s: Session, p: number) {
  if (!ui.reference) return null;
  const parcelle = s.td.parcelles[p]!;
  const parGuid = parcelle.guid && ui.reference.parcelles.find((r) => r.guid === parcelle.guid);
  if (parGuid) return parGuid;
  const parNom = ui.reference.parcelles.find((r) => r.nom === parcelle.nom);
  if (parNom) return parNom;
  const ext = s.etat.anneaux.find((a) => a.parcelle === p && a.type === 1);
  if (!ext) return null;
  const plan = planLocal(latLon(ext.sommets[0]!));
  const pts = ext.sommets.map((x) => plan.versXY(latLon(x)));
  const centre: XY = [
    pts.reduce((u, q) => u + q[0], 0) / pts.length,
    pts.reduce((u, q) => u + q[1], 0) / pts.length,
  ];
  return (
    ui.reference.parcelles.find((r) =>
      pointDansPolygone(
        centre,
        r.contour.map((q) => plan.versXY(q)),
      ),
    ) ?? null
  );
}

export function panneauRemplacement(s: Session): HTMLElement | null {
  if (ui.reference && ui.repriseBord) return panneauReprise(s);
  if (!ui.reference || ui.parcelleCourante === null) return null;
  const p = ui.parcelleCourante;
  const r = parcelleDeReference(s, p);
  const nom = s.td.parcelles[p]!.nom;
  if (!r) {
    return el('div', { class: 'info doux' }, `${nom} absente de la référence.`);
  }
  const ext = s.etat.anneaux.findIndex((a) => a.parcelle === p && a.type === 1);
  return el(
    'div',
    { class: 'info' },
    el('strong', {}, 'Référence'),
    el(
      'div',
      { class: 'doux' },
      `${r.contour.length} points (actuel : ${s.etat.anneaux[ext]!.sommets.length})`,
    ),
    el(
      'div',
      { class: 'rangee' },
      el(
        'button',
        {
          onclick: () => {
            if (!confirm(`Remplacer tout le contour de ${nom} par celui de la référence ?`)) return;
            const communs = s.etat.anneaux[ext]!.sommets.some((x) =>
              sommetsEn(s.etat, latLon(x)).some((q) => q.anneau !== ext),
            );
            modifier(
              () => remplacerContour(s.etat, ext, r.contour),
              `Contour de ${nom} remplacé par celui de ${ui.reference!.nom}` +
                (communs ? ' ; vérifie la limite avec le voisin' : ''),
              false,
            );
          },
        },
        `Remplacer ${nom}`,
      ),
      el(
        'button',
        {
          onclick: () => {
            arreterOutilsCarte();
            // Plus de point choisi : la croix de flèches ne gêne pas les touchers sur la carte.
            effacerSelection();
            ui.repriseBord = { anneauRef: null, debut: null, fin: null, autreCote: false };
            afficher();
          },
        },
        'Reprendre un bord',
      ),
    ),
  );
}

// ---------- Reprendre un bord de la référence ----------

/** Chemin choisi sur la référence, du premier point touché au second (null s'il manque un point). */
export function cheminReprise(): LatLon[] | null {
  const r = ui.repriseBord;
  if (!r || !ui.reference || r.anneauRef === null || r.debut === null || r.fin === null)
    return null;
  const pts = ui.reference.anneaux[r.anneauRef]!;
  const n = pts.length;
  const chemin = (sens: 1 | -1) => {
    const c = [pts[r.debut!]!];
    for (let k = r.debut!; k !== r.fin;) {
      k = (k + sens + n) % n;
      c.push(pts[k]!);
    }
    return c;
  };
  const longueur = (c: LatLon[]) => c.slice(1).reduce((t, p, k) => t + distanceM(c[k]!, p), 0);
  const [a, b] = [chemin(1), chemin(-1)];
  const court = longueur(a) <= longueur(b) ? a : b;
  return r.autreCote ? (court === a ? b : a) : court;
}

/** Anneau du contour actuel le plus proche des deux bouts du chemin. */
function anneauPourChemin(s: Session, chemin: LatLon[]): number | null {
  const bouts = [chemin[0]!, chemin[chemin.length - 1]!];
  let meilleur: { i: number; d: number } | null = null;
  s.etat.anneaux.forEach((a, i) => {
    if (anneauIgnore(s.etat, i)) return;
    const d = bouts.reduce(
      (t, b) => t + Math.min(...a.sommets.map((x) => distanceM(latLon(x), b))),
      0,
    );
    if (!meilleur || d < meilleur.d) meilleur = { i, d };
  });
  return (meilleur as { i: number } | null)?.i ?? null;
}

/** Résultat de la reprise (sans rien modifier), ou l'erreur qui l'empêche. */
export function apercuReprise(
  s: Session,
): { etat: Etat; bilan: BilanReprise; anneau: number } | { erreur: string } | null {
  const chemin = cheminReprise();
  if (!chemin) return null;
  const anneau = anneauPourChemin(s, chemin);
  if (anneau === null) return null;
  try {
    return { ...reprendreBord(s.etat, anneau, chemin), anneau };
  } catch (e) {
    return { erreur: (e as Error).message };
  }
}

/** Toucher sur la carte pendant la reprise : choisit un point gris de la référence. */
export function toucherReprise(
  ecran: { x: number; y: number },
  versEcran: (ll: LatLon) => { x: number; y: number },
): void {
  const r = ui.repriseBord;
  if (!r || !ui.reference) return;
  let proche: { anneau: number; k: number; d: number } | null = null;
  ui.reference.anneaux.forEach((pts, anneau) =>
    pts.forEach((p, k) => {
      const e = versEcran(p);
      const d = Math.hypot(e.x - ecran.x, e.y - ecran.y);
      if (d <= RAYON_TOUCHER_PX && (!proche || d < proche.d)) proche = { anneau, k, d };
    }),
  );
  const choix = proche as { anneau: number; k: number } | null;
  if (!choix) {
    ui.message = { texte: 'Touche un point gris de l’ancien contour.', erreur: true };
  } else if (r.debut === null || r.fin !== null || r.anneauRef !== choix.anneau) {
    ui.repriseBord = { anneauRef: choix.anneau, debut: choix.k, fin: null, autreCote: false };
  } else if (choix.k !== r.debut) {
    ui.repriseBord = { ...r, fin: choix.k };
    const a = ui.session && apercuReprise(ui.session);
    if (a && 'anneau' in a) ui.parcelleCourante = ui.session!.etat.anneaux[a.anneau]!.parcelle;
  }
  afficher();
}

function panneauReprise(s: Session): HTMLElement {
  const r = ui.repriseBord!;
  const lignes: (HTMLElement | false)[] = [el('strong', {}, 'Reprendre un bord de l’ancien')];
  if (r.debut === null || r.fin === null) {
    lignes.push(
      el(
        'div',
        { class: 'sens' },
        r.debut === null
          ? 'Touche le premier point gris du bord.'
          : 'Touche le dernier point gris du bord.',
      ),
    );
  } else {
    const a = apercuReprise(s);
    if (a && 'erreur' in a) lignes.push(el('div', { class: 'erreur' }, a.erreur));
    else if (a) {
      const p = s.etat.anneaux[a.anneau]!.parcelle;
      const surface = Math.round(
        (nouvelleSurface(s.td, a.etat, p) ?? 0) - (nouvelleSurface(s.td, s.etat, p) ?? 0),
      );
      const voisins = a.bilan.voisins.map((v) => s.td.parcelles[s.etat.anneaux[v]!.parcelle]!.nom);
      lignes.push(
        el(
          'div',
          { class: 'sens' },
          `${s.td.parcelles[p]!.nom} : ${a.bilan.avant} → ${a.bilan.apres} points · écart max ${a.bilan.ecartMax.toFixed(2).replace('.', ',')} m · surface ${surface >= 0 ? '+' : ''}${surface} m²`,
        ),
        voisins.length > 0 &&
          el('div', { class: 'doux' }, `Suit aussi chez ${[...new Set(voisins)].join(', ')}.`),
      );
    }
    lignes.push(
      el(
        'div',
        { class: 'rangee' },
        el(
          'button',
          {
            onclick: () => {
              ui.repriseBord = { ...r, autreCote: !r.autreCote };
              afficher();
            },
          },
          'Autre côté',
        ),
        a !== null &&
          !('erreur' in a) &&
          el(
            'button',
            {
              class: 'principal',
              onclick: () => {
                const res = apercuReprise(s);
                if (!res || 'erreur' in res) return;
                const nom = nomParcelle(s, res.anneau);
                ui.repriseBord = null;
                modifier(
                  () => res.etat,
                  `Bord de ${nom} repris de ${ui.reference!.nom} (${res.bilan.avant} → ${res.bilan.apres} points)`,
                  false,
                );
              },
            },
            'Reprendre ce bord',
          ),
      ),
    );
  }
  lignes.push(
    el(
      'div',
      { class: 'rangee' },
      el(
        'button',
        {
          onclick: () => {
            ui.repriseBord = null;
            afficher();
          },
        },
        'Annuler',
      ),
    ),
  );
  return el('div', { class: 'info' }, ...lignes);
}
