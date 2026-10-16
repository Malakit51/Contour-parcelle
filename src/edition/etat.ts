// État des contours en cours de modification.
//
// L'état ne se modifie jamais en place : chaque opération renvoie un nouvel état, ce qui rend
// « annuler » trivial (on garde la liste des états précédents).

import { aireSignee, planLocal, type LatLon, type XY } from '../geometrie/plan';
import type { Point, TaskData } from '../isoxml/lecture';
import { sommets as sommetsLus } from '../isoxml/parcelles';

export interface Sommet {
  readonly lat: number;
  readonly lon: number;
  /** Point du fichier d'origine, ou null pour un point ajouté par l'éditeur. */
  readonly origine: Point | null;
}

export interface AnneauEdite {
  /** Indice de la parcelle dans `TaskData.parcelles`. */
  readonly parcelle: number;
  /** Indice de l'anneau dans `Parcelle.anneaux`. */
  readonly anneau: number;
  readonly type: 1 | 2;
  /** Sommets sans répétition du premier à la fin. */
  readonly sommets: readonly Sommet[];
  /** Nombre de sommets dans le fichier d'origine (pour repérer les suppressions). */
  readonly nbOrigine: number;
}

/** Ligne de guidage créée dans l'éditeur, écrite dans le fichier en LSG A="5". */
export interface Guidage {
  /** Indice dans `TaskData.parcelles`. */
  readonly parcelle: number;
  readonly type: 'ab' | 'courbe';
  /** Nom écrit dans l'attribut B du LSG. */
  readonly nom: string;
  readonly points: readonly LatLon[];
}

export interface Etat {
  readonly anneaux: readonly AnneauEdite[];
  /** Lignes de guidage créées dans l'éditeur (celles du fichier sont toujours retirées). */
  readonly guidages?: readonly Guidage[];
  /**
   * Parcelles retirées du fichier (indices dans `TaskData.parcelles`). Leurs anneaux restent dans
   * `anneaux` (les indices ne bougent pas) mais ne comptent plus : ni carte, ni calculs, ni export.
   */
  readonly supprimees?: readonly number[];
  /** Zones exclues retirées (indices dans `anneaux`, anneaux de type 2) : la parcelle les reprend. */
  readonly zonesRetirees?: readonly number[];
}

/** Anneau qui ne compte plus : parcelle retirée, ou zone exclue retirée. */
export const anneauIgnore = (etat: Etat, i: number) =>
  estSupprimee(etat, etat.anneaux[i]!.parcelle) || (etat.zonesRetirees?.includes(i) ?? false);

export const estSupprimee = (etat: Etat, parcelle: number) =>
  etat.supprimees?.includes(parcelle) ?? false;

/** Le même état sans les anneaux des parcelles retirées (pour les contrôles). */
export function sansSupprimees(etat: Etat): Etat {
  if (!etat.supprimees?.length && !etat.zonesRetirees?.length) return etat;
  return { ...etat, anneaux: etat.anneaux.filter((_, i) => !anneauIgnore(etat, i)) };
}

export interface RefSommet {
  /** Indice dans `Etat.anneaux`. */
  readonly anneau: number;
  readonly sommet: number;
}

/** Limite allant du sommet `debut` au sommet suivant de l'anneau. */
export interface RefLimite {
  readonly anneau: number;
  readonly debut: number;
}

/** Distance en dessous de laquelle deux sommets sont considérés comme le même point. */
export const TOLERANCE_PARTAGE_M = 0.02;

export function etatInitial(td: TaskData): Etat {
  const anneaux: AnneauEdite[] = [];
  td.parcelles.forEach((parcelle, ip) => {
    parcelle.anneaux.forEach((anneau, ia) => {
      const n = sommetsLus(anneau).length;
      anneaux.push({
        parcelle: ip,
        anneau: ia,
        type: anneau.type,
        sommets: anneau.points.slice(0, n).map((p) => ({ lat: p.lat, lon: p.lon, origine: p })),
        nbOrigine: n,
      });
    });
  });
  return { anneaux };
}

export const latLon = (s: Sommet): LatLon => [s.lat, s.lon];

export function sommet(etat: Etat, ref: RefSommet): Sommet {
  const s = etat.anneaux[ref.anneau]?.sommets[ref.sommet];
  if (!s) throw new Error(`Sommet inexistant : ${ref.anneau}/${ref.sommet}`);
  return s;
}

/** Distance approximative en mètres entre deux points proches. */
export function distanceM(a: LatLon, b: LatLon): number {
  const dy = (a[0] - b[0]) * 111_132;
  const dx = (a[1] - b[1]) * 111_320 * Math.cos((a[0] * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

/** Tous les sommets (de tous les anneaux) situés à moins de `tolerance` mètres de `p`. */
export function sommetsEn(etat: Etat, p: LatLon, tolerance = TOLERANCE_PARTAGE_M): RefSommet[] {
  const refs: RefSommet[] = [];
  etat.anneaux.forEach((a, ia) => {
    // Une parcelle (ou une zone exclue) retirée ne partage plus rien avec ses voisines.
    if (anneauIgnore(etat, ia)) return;
    a.sommets.forEach((s, is) => {
      if (distanceM(p, latLon(s)) <= tolerance) refs.push({ anneau: ia, sommet: is });
    });
  });
  return refs;
}

export const suivant = (etat: Etat, anneau: number, i: number) =>
  (i + 1) % etat.anneaux[anneau]!.sommets.length;
export const precedent = (etat: Etat, anneau: number, i: number) => {
  const n = etat.anneaux[anneau]!.sommets.length;
  return (i - 1 + n) % n;
};

/**
 * Les autres anneaux qui contiennent la même limite (mêmes deux extrémités, adjacentes).
 * Pour chacun : indices des deux extrémités dans cet anneau, dans l'ordre (début, fin) de `ref`.
 */
export function limitesJumelles(
  etat: Etat,
  ref: RefLimite,
): { anneau: number; debut: number; fin: number }[] {
  const a = latLon(sommet(etat, { anneau: ref.anneau, sommet: ref.debut }));
  const b = latLon(
    sommet(etat, { anneau: ref.anneau, sommet: suivant(etat, ref.anneau, ref.debut) }),
  );
  const resultat: { anneau: number; debut: number; fin: number }[] = [];
  for (const ra of sommetsEn(etat, a)) {
    if (ra.anneau === ref.anneau) continue;
    for (const voisin of [
      suivant(etat, ra.anneau, ra.sommet),
      precedent(etat, ra.anneau, ra.sommet),
    ]) {
      if (
        distanceM(b, latLon(sommet(etat, { anneau: ra.anneau, sommet: voisin }))) <=
        TOLERANCE_PARTAGE_M
      ) {
        resultat.push({ anneau: ra.anneau, debut: ra.sommet, fin: voisin });
      }
    }
  }
  return resultat;
}

/** Sommets d'un anneau dans un plan local centré sur son premier sommet. */
export function anneauXY(a: AnneauEdite): XY[] {
  const plan = planLocal(latLon(a.sommets[0]!));
  return a.sommets.map((s) => plan.versXY(latLon(s)));
}

/** Surface cultivable d'une parcelle (m²) : contours extérieurs moins zones exclues. */
export function surfaceEtat(etat: Etat, parcelle: number): number {
  let total = 0;
  for (const [i, a] of etat.anneaux.entries()) {
    if (a.parcelle !== parcelle || etat.zonesRetirees?.includes(i)) continue;
    const aire = Math.abs(aireSignee(anneauXY(a)));
    total += a.type === 1 ? aire : -aire;
  }
  return total;
}
