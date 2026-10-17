// Lecture d'un shapefile de polygones (.shp, .dbf, .prj, .cpg) pour l'afficher en référence :
// contours en coordonnées GPS, avec un nom pris dans la table attributaire. Systèmes reconnus :
// Lambert 93 (le système officiel en France) et WGS84 en degrés.

import { depuisLambert93 } from '../geometrie/lambert93';
import type { LatLon } from '../geometrie/plan';

export interface FichiersShapefile {
  shp: Uint8Array;
  dbf?: Uint8Array | undefined;
  prj?: string | undefined;
  cpg?: string | undefined;
}

export interface PolygoneLu {
  /** Nom tiré de la table (champ NOM, NAME…), sinon « Polygone N ». */
  nom: string;
  /** GUID s'il y a un champ GUID (shapefile exporté par l'éditeur), sinon ''. */
  guid: string;
  /** Contour extérieur, sans répéter le premier point. */
  contour: LatLon[];
  /** Trous (zones exclues), sans répéter le premier point. */
  trous: LatLon[][];
}

type XY = [number, number];

/** Champs essayés, dans l'ordre, pour le nom d'un polygone. */
const CHAMPS_NOM = [
  'NOM',
  'NAME',
  'NOM_PARC',
  'NOM_PARCEL',
  'PARCELLE',
  'LIBELLE',
  'LABEL',
  'NUM_ILOT',
  'NUM_PARCEL',
  'NUMERO',
  'ID_PARCEL',
  'ID',
];

function lireDbf(octets: Uint8Array, cpg?: string): Record<string, string>[] {
  const v = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
  const nombre = v.getUint32(4, true);
  const lgEntete = v.getUint16(8, true);
  const lgLigne = v.getUint16(10, true);
  const champs: { nom: string; longueur: number }[] = [];
  for (let p = 32; p + 32 <= lgEntete && octets[p] !== 0x0d; p += 32) {
    const brut = octets.subarray(p, p + 11);
    const fin = brut.indexOf(0);
    champs.push({
      nom: new TextDecoder('latin1').decode(fin >= 0 ? brut.subarray(0, fin) : brut).trim(),
      longueur: octets[p + 16]!,
    });
  }
  // Encodage du texte : celui du .cpg, sinon UTF-8 s'il est valide, sinon Windows-1252.
  const utf8 = cpg ? /utf-?8/i.test(cpg) : null;
  const decoder = (b: Uint8Array) => {
    if (utf8 === false) return new TextDecoder('windows-1252').decode(b);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(b);
    } catch {
      return new TextDecoder('windows-1252').decode(b);
    }
  };
  const lignes: Record<string, string>[] = [];
  for (let k = 0; k < nombre; k++) {
    let p = lgEntete + k * lgLigne;
    if (p + lgLigne > octets.length) break;
    const supprimee = octets[p] === 0x2a; // « * »
    p += 1;
    const ligne: Record<string, string> = {};
    for (const c of champs) {
      ligne[c.nom] = decoder(octets.subarray(p, p + c.longueur)).trim();
      p += c.longueur;
    }
    lignes.push(supprimee ? {} : ligne);
  }
  return lignes;
}

/** Aire signée (positive dans le sens inverse des aiguilles d'une montre, axes x vers l'est). */
function aire(a: readonly XY[]): number {
  let s = 0;
  for (let k = 0; k < a.length; k++) {
    const [x1, y1] = a[k]!;
    const [x2, y2] = a[(k + 1) % a.length]!;
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

function dedans(p: XY, a: readonly XY[]): boolean {
  let c = false;
  for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
    const [xi, yi] = a[i]!;
    const [xj, yj] = a[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Système de coordonnées : d'après le .prj, sinon d'après l'étendue des coordonnées. */
function conversion(prj: string | undefined, boite: number[]): (p: XY) => LatLon {
  const degres = (p: XY): LatLon => [p[1], p[0]];
  if (prj?.trim()) {
    if (!/PROJCS/i.test(prj)) return degres;
    const l93 =
      /Lambert/i.test(prj) && /700000/.test(prj) && /6600000/.test(prj) && /\b44\b/.test(prj);
    if (l93 || /2154/.test(prj) || /Lambert[-_ ]?93/i.test(prj)) return depuisLambert93;
    const nom = /PROJCS\s*\[\s*"([^"]*)"/i.exec(prj)?.[1] ?? 'inconnue';
    throw new Error(
      `projection « ${nom} » non reconnue (Lambert 93 ou coordonnées GPS en degrés seulement)`,
    );
  }
  const [xmin, ymin, xmax, ymax] = boite as [number, number, number, number];
  if (xmin >= -180 && xmax <= 180 && ymin >= -90 && ymax <= 90) return degres;
  if (xmin > -400_000 && xmax < 1_600_000 && ymin > 5_900_000 && ymax < 7_300_000)
    return depuisLambert93;
  throw new Error('pas de fichier .prj et coordonnées ni en Lambert 93 ni en degrés');
}

/** Polygones du shapefile (types polygone, polygone Z ou M), en coordonnées GPS. */
export function lireShapefile(f: FichiersShapefile): PolygoneLu[] {
  const o = f.shp;
  const v = new DataView(o.buffer, o.byteOffset, o.byteLength);
  if (o.length < 100 || v.getInt32(0, false) !== 9994) throw new Error('fichier .shp illisible');
  const type = v.getInt32(32, true);
  if (type !== 5 && type !== 15 && type !== 25)
    throw new Error('ce shapefile ne contient pas de polygones (des points ou des lignes ?)');
  const boite = [36, 44, 52, 60].map((d) => v.getFloat64(d, true)); // xmin, ymin, xmax, ymax
  const versLatLon = conversion(f.prj, boite);
  const table = f.dbf ? lireDbf(f.dbf, f.cpg) : [];
  const champs = Object.keys(table.find((l) => Object.keys(l).length > 0) ?? {});
  const champNom =
    CHAMPS_NOM.map((c) => champs.find((x) => x.toUpperCase() === c)).find(Boolean) ?? champs[0];
  const champGuid = champs.find((x) => x.toUpperCase() === 'GUID');

  const polygones: PolygoneLu[] = [];
  let p = 100;
  let numero = 0;
  while (p + 8 <= o.length) {
    const longueur = v.getInt32(p + 4, false) * 2;
    const debut = p + 8;
    p = debut + longueur;
    const ligne = table[numero] ?? {};
    numero++;
    if (longueur < 4 || v.getInt32(debut, true) === 0) continue; // forme vide
    const nbParties = v.getInt32(debut + 36, true);
    const nbPoints = v.getInt32(debut + 40, true);
    const parties = Array.from({ length: nbParties }, (_, k) =>
      v.getInt32(debut + 44 + 4 * k, true),
    );
    const pts = debut + 44 + 4 * nbParties;
    const anneaux: XY[][] = parties.map((d, k) => {
      const f2 = k + 1 < nbParties ? parties[k + 1]! : nbPoints;
      const a: XY[] = [];
      for (let i = d; i < f2; i++)
        a.push([v.getFloat64(pts + 16 * i, true), v.getFloat64(pts + 16 * i + 8, true)]);
      const [x0, y0] = a[0] ?? [0, 0];
      const [xn, yn] = a[a.length - 1] ?? [1, 1];
      if (a.length > 1 && x0 === xn && y0 === yn) a.pop();
      return a;
    });
    // Anneaux extérieurs : sens des aiguilles d'une montre ; trous : l'autre sens, rangés dans
    // l'anneau extérieur qui les contient.
    const exterieurs = anneaux.filter((a) => a.length >= 3 && aire(a) < 0);
    const trous = anneaux.filter((a) => a.length >= 3 && aire(a) > 0);
    // Shapefile mal orienté (aucun anneau dans le sens horaire) : tout est extérieur.
    const ext = exterieurs.length > 0 ? exterieurs : trous.splice(0);
    const nom = (champNom && ligne[champNom]) || `Polygone ${numero}`;
    const guid = (champGuid && ligne[champGuid]) || '';
    ext.forEach((a, k) => {
      const siens = trous.filter((t) => dedans(t[0]!, a));
      polygones.push({
        nom: ext.length > 1 ? `${nom} (${k + 1})` : nom,
        guid,
        contour: a.map(versLatLon),
        trous: siens.map((t) => t.map(versLatLon)),
      });
    });
  }
  return polygones;
}
