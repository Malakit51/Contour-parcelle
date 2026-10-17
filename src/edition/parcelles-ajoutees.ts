// Parcelles créées dans l'éditeur (tracées au doigt ou au GPS). Elles sont ajoutées à la suite
// des parcelles du fichier, et écrites en entier à l'export, sur le modèle des parcelles de la
// console : <PFD A B C D E F>, <PLN A="1" B>, <LSG A="1">, les points, </LSG>, </PLN>, </PFD>.

import { aireSignee, planLocal, pointDansPolygone, type LatLon, type XY } from '../geometrie/plan';
import type { Parcelle, TaskData } from '../isoxml/lecture';
import { seCroisent } from './controles';
import {
  anneauIgnore,
  estSupprimee,
  etatInitial,
  latLon,
  surfaceEtat,
  type Etat,
  type ParcelleAjoutee,
} from './etat';
import { ErreurEdition } from './operations';

/** Plus petite parcelle acceptée (m²). */
export const SURFACE_MIN_PARCELLE_M2 = 100;

function parcelleVirtuelle(a: ParcelleAjoutee): Parcelle {
  return {
    id: a.id,
    guid: a.guid,
    nom: a.nom,
    surface: null,
    anneaux: [],
    debutContour: null,
    ajoutee: true,
  };
}

/**
 * Ajoute à `td.parcelles` les parcelles créées dans l'éditeur qui n'y sont pas encore (après une
 * reprise de session). Une parcelle annulée y reste, sans anneau : elle ne compte plus.
 */
export function completerParcelles(td: TaskData, etat: Etat): void {
  for (const a of etat.ajoutees ?? []) {
    while (td.parcelles.length < a.parcelle) {
      td.parcelles.push({ ...parcelleVirtuelle(a), id: '', guid: '', nom: '(annulée)' });
    }
    if (!td.parcelles[a.parcelle]) td.parcelles[a.parcelle] = parcelleVirtuelle(a);
  }
}

/**
 * Rapport moyen entre la surface D du fichier et celle calculée par l'éditeur (environ 0,9995) :
 * appliqué à une parcelle créée, pour que son D soit calculé comme celui des autres.
 */
export function rapportSurface(td: TaskData): number {
  const initial = etatInitial(td);
  const rapports = td.parcelles.flatMap((p, i) => {
    const d = p.surface ? Number(p.surface.texte) : NaN;
    const calc = p.ajoutee ? 0 : surfaceEtat(initial, i);
    return Number.isFinite(d) && d > 0 && calc > 0 ? [d / calc] : [];
  });
  return rapports.length ? rapports.reduce((s, r) => s + r, 0) / rapports.length : 1;
}

/** Identifiant suivant : « PFD31 » après « PFD30 ». */
export function idSuivant(td: TaskData): string {
  const n = Math.max(0, ...td.parcelles.map((p) => Number(/^PFD(\d+)$/.exec(p.id)?.[1] ?? 0)));
  return `PFD${n + 1}`;
}

/** GUID au format du fichier : 32 chiffres hexadécimaux en minuscules. */
export function nouveauGuid(): string {
  const octets = new Uint8Array(16);
  crypto.getRandomValues(octets);
  return [...octets].map((o) => o.toString(16).padStart(2, '0')).join('');
}

/**
 * Crée la parcelle `nom` de contour `zone` (sans répéter le premier point). Refusé si le contour
 * se recoupe, est trop petit, ou chevauche une parcelle existante (un simple contact est permis :
 * on peut ensuite « Coller au voisin »). Ajoute la parcelle à `td.parcelles` et renvoie l'état.
 */
export function creerParcelle(
  td: TaskData,
  etat: Etat,
  nom: string,
  zone: readonly LatLon[],
  guid = nouveauGuid(),
): { etat: Etat; parcelle: number } {
  const nomPropre = nom.trim();
  if (!nomPropre) throw new ErreurEdition('Donne un nom à la parcelle.');
  const existe = td.parcelles.some(
    (p, i) => !estSupprimee(etat, i) && p.nom.toLowerCase() === nomPropre.toLowerCase(),
  );
  if (existe) throw new ErreurEdition(`Une parcelle s’appelle déjà « ${nomPropre} ».`);
  if (zone.length < 3) throw new ErreurEdition('Il faut au moins 3 points pour une parcelle.');
  const plan = planLocal(zone[0]!);
  let pts: XY[] = zone.map((p) => plan.versXY(p));
  for (let k = 0; k < pts.length; k++) {
    for (let m = k + 2; m < pts.length; m++) {
      if (k === 0 && m === pts.length - 1) continue;
      if (seCroisent(pts[k]!, pts[k + 1]!, pts[m]!, pts[(m + 1) % pts.length]!)) {
        throw new ErreurEdition('Le contour se recoupe lui-même.');
      }
    }
  }
  if (Math.abs(aireSignee(pts)) < SURFACE_MIN_PARCELLE_M2) {
    throw new ErreurEdition('Parcelle trop petite (moins de 100 m²).');
  }
  // Pas de chevauchement avec les parcelles existantes ; la plus proche sert de modèle.
  let modele = -1;
  let distanceModele = Infinity;
  const centre: XY = [
    pts.reduce((s, p) => s + p[0], 0) / pts.length,
    pts.reduce((s, p) => s + p[1], 0) / pts.length,
  ];
  let sensModele = -1;
  for (const [i, a] of etat.anneaux.entries()) {
    if (a.type !== 1 || anneauIgnore(etat, i)) continue;
    const autre = a.sommets.map((s) => plan.versXY(latLon(s)));
    const croise = pts.some((_, k) =>
      autre.some((__, m) =>
        seCroisent(pts[k]!, pts[(k + 1) % pts.length]!, autre[m]!, autre[(m + 1) % autre.length]!),
      ),
    );
    const nomAutre = td.parcelles[a.parcelle]!.nom;
    if (croise || pointDansPolygone(centre, autre) || pointDansPolygone(autre[0]!, pts)) {
      throw new ErreurEdition(`La nouvelle parcelle chevauche ${nomAutre}.`);
    }
    if (td.parcelles[a.parcelle]!.ajoutee) continue;
    const d = Math.min(...autre.map((q) => Math.hypot(q[0] - centre[0], q[1] - centre[1])));
    if (d < distanceModele) {
      distanceModele = d;
      modele = a.parcelle;
      sensModele = Math.sign(aireSignee(autre));
    }
  }
  if (modele < 0) throw new ErreurEdition('Aucune parcelle du fichier pour servir de modèle.');
  // Même sens de rotation que les contours de la console.
  if (Math.sign(aireSignee(pts)) !== sensModele) pts = [...pts].reverse();
  const parcelle = td.parcelles.length;
  const ajoutee: ParcelleAjoutee = { parcelle, id: idSuivant(td), guid, nom: nomPropre, modele };
  td.parcelles.push(parcelleVirtuelle(ajoutee));
  const sommets = pts.map((p) => {
    const [lat, lon] = plan.versLatLon(p);
    return { lat, lon, origine: null };
  });
  return {
    parcelle,
    etat: {
      ...etat,
      anneaux: [...etat.anneaux, { parcelle, anneau: -1, type: 1, sommets, nbOrigine: 0 }],
      ajoutees: [...(etat.ajoutees ?? []), ajoutee],
    },
  };
}
