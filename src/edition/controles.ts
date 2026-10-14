// Contrôles avant export, et repérage des sommets presque communs au chargement.

import { planLocal, type Plan, type XY } from '../geometrie/plan';
import type { TaskData } from '../isoxml/lecture';
import { distanceM, etatInitial, latLon, TOLERANCE_PARTAGE_M, type Etat } from './etat';
import { DOUBLON_M } from './nettoyage';

export interface Alerte {
  grave: boolean;
  message: string;
}

/** Écart minimal (m) pour considérer qu'un point est franchement d'un côté d'une limite. */
const MARGE_M = 1e-4;

function cote(a: XY, b: XY, p: XY): number {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const d = ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / l;
  return Math.abs(d) < MARGE_M ? 0 : Math.sign(d);
}

/** Vrai si les segments se croisent franchement (un simple contact ou un recouvrement ne compte pas). */
export function seCroisent(p1: XY, p2: XY, q1: XY, q2: XY): boolean {
  return cote(p1, p2, q1) * cote(p1, p2, q2) < 0 && cote(q1, q2, p1) * cote(q1, q2, p2) < 0;
}

interface AnneauXY {
  nom: string;
  pts: XY[];
  min: XY;
  max: XY;
}

function versXY(td: TaskData, etat: Etat, plan: Plan): AnneauXY[] {
  return etat.anneaux.map((a) => {
    const pts = a.sommets.map((s) => plan.versXY(latLon(s)));
    return {
      nom: td.parcelles[a.parcelle]!.nom,
      pts,
      min: [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))],
      max: [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))],
    };
  });
}

const segment = (a: AnneauXY, i: number): [XY, XY] => [a.pts[i]!, a.pts[(i + 1) % a.pts.length]!];

/**
 * Contrôle les parcelles `parcelles` (indices dans td.parcelles) : anneau d'au moins 3 sommets,
 * aucune auto-intersection, aucun croisement avec une autre parcelle, sommets communs identiques.
 */
export function controler(td: TaskData, etat: Etat, parcelles: readonly number[]): Alerte[] {
  const alertes: Alerte[] = [];
  const concernes = etat.anneaux.flatMap((a, i) => (parcelles.includes(a.parcelle) ? [i] : []));
  if (concernes.length === 0) return alertes;
  const plan = planLocal(latLon(etat.anneaux[concernes[0]!]!.sommets[0]!));
  const anneaux = versXY(td, etat, plan);

  for (const i of concernes) {
    const a = anneaux[i]!;
    const n = a.pts.length;
    if (n < 3) {
      alertes.push({ grave: true, message: `${a.nom} : contour de moins de 3 points.` });
      continue;
    }
    // Deux points au même endroit : limite de longueur nulle, la console ne voit plus le coin.
    const sommets = etat.anneaux[i]!.sommets;
    if (sommets.some((u, k) => distanceM(latLon(u), latLon(sommets[(k + 1) % n]!)) < DOUBLON_M)) {
      alertes.push({
        grave: true,
        message: `${a.nom} : deux points au même endroit (la console ne reconnaîtrait pas ce coin).`,
      });
    }
    for (let k = 0; k < n; k++) {
      for (let m = k + 2; m < n; m++) {
        if (k === 0 && m === n - 1) continue; // limites voisines
        if (seCroisent(...segment(a, k), ...segment(a, m))) {
          alertes.push({ grave: true, message: `${a.nom} : le contour se recoupe lui-même.` });
          k = n;
          break;
        }
      }
    }
    anneaux.forEach((b, j) => {
      if (j === i || etat.anneaux[j]!.parcelle === etat.anneaux[i]!.parcelle) return;
      if (concernes.includes(j) && j < i) return; // paire déjà contrôlée
      if (b.min[0] > a.max[0] || b.max[0] < a.min[0] || b.min[1] > a.max[1] || b.max[1] < a.min[1])
        return;
      for (let k = 0; k < a.pts.length; k++) {
        for (let m = 0; m < b.pts.length; m++) {
          if (seCroisent(...segment(a, k), ...segment(b, m))) {
            alertes.push({ grave: true, message: `${a.nom} chevauche ${b.nom}.` });
            return;
          }
        }
      }
    });
  }
  // Le long d'une limite commune, un point d'une parcelle qui n'est pas sur la limite du voisin.
  for (const m of limitesDecollees(td, etat, parcelles)) {
    alertes.push({ grave: false, message: m });
  }
  // Voisins qui avaient des sommets communs dans le fichier d'origine et en ont perdu : leur
  // limite commune ne coïncide plus (bande vide ou chevauchement le long de cette limite).
  const avant = paresDeVoisins(etatInitial(td));
  const apres = paresDeVoisins(etat);
  for (const [cle, n] of avant) {
    const [a, b] = cle.split('|').map(Number) as [number, number];
    if (!parcelles.includes(a) && !parcelles.includes(b)) continue;
    if ((apres.get(cle) ?? 0) < n) {
      alertes.push({
        grave: false,
        message: `${td.parcelles[a]!.nom} / ${td.parcelles[b]!.nom} : la limite commune ne coïncide plus (${n - (apres.get(cle) ?? 0)} sommet(s) commun(s) perdu(s)) ; risque de bande vide ou de chevauchement, vérifie sur la carte.`,
      });
    }
  }
  for (const p of sommetsPresqueCommuns(td, etat, 1, true)) {
    if (parcelles.includes(p.parcelles[0]) || parcelles.includes(p.parcelles[1])) {
      alertes.push({
        grave: p.distance < TOLERANCE_PARTAGE_M,
        message: `${p.noms[0]} / ${p.noms[1]} : sommets presque communs, à ${(p.distance * 100).toFixed(1).replace('.', ',')} cm l'un de l'autre.`,
      });
    }
  }
  return alertes;
}

export interface PresqueCommun {
  parcelles: [number, number];
  noms: [string, string];
  /** Distance en mètres (jamais nulle : les sommets identiques sont des sommets communs). */
  distance: number;
}

/**
 * Vrai si le sommet `u` est relié par une limite de son anneau à un sommet situé exactement en `p`.
 * C'est le cas après le décalage d'une limite partagée : la parcelle qui s'agrandit garde l'ancien
 * sommet, relié au nouveau sommet commun.
 */
function relies(
  etat: Etat,
  u: { anneau: number; i: number },
  p: { lat: number; lon: number },
): boolean {
  const sommets = etat.anneaux[u.anneau]!.sommets;
  const n = sommets.length;
  return [sommets[(u.i + 1) % n]!, sommets[(u.i - 1 + n) % n]!].some(
    (s) => s.lat === p.lat && s.lon === p.lon,
  );
}

/**
 * Sommets de parcelles différentes, distincts mais à moins de `max` mètres l'un de l'autre.
 * Avec `ignorerRelies`, on écarte les sommets reliés par une limite au sommet voisin (voir `relies`).
 */
export function sommetsPresqueCommuns(
  td: TaskData,
  etat: Etat,
  max: number,
  ignorerRelies = false,
): PresqueCommun[] {
  const tous = etat.anneaux.flatMap((a, anneau) =>
    a.sommets.map((s, i) => ({ parcelle: a.parcelle, anneau, i, s })),
  );
  const resultat: PresqueCommun[] = [];
  for (let i = 0; i < tous.length; i++) {
    for (let j = i + 1; j < tous.length; j++) {
      const u = tous[i]!;
      const v = tous[j]!;
      if (u.parcelle === v.parcelle) continue;
      if (u.s.lat === v.s.lat && u.s.lon === v.s.lon) continue;
      if (ignorerRelies && (relies(etat, u, v.s) || relies(etat, v, u.s))) continue;
      const d = distanceM(latLon(u.s), latLon(v.s));
      if (d < max) {
        resultat.push({
          parcelles: [u.parcelle, v.parcelle],
          noms: [td.parcelles[u.parcelle]!.nom, td.parcelles[v.parcelle]!.nom],
          distance: d,
        });
      }
    }
  }
  return resultat;
}

/** Nombre de sommets communs (coordonnées identiques) entre chaque paire de parcelles « a|b ». */
function paresDeVoisins(etat: Etat): Map<string, number> {
  const parPosition = new Map<string, Set<number>>();
  for (const a of etat.anneaux) {
    for (const s of a.sommets) {
      const cle = `${s.lat} ${s.lon}`;
      if (!parPosition.has(cle)) parPosition.set(cle, new Set());
      parPosition.get(cle)!.add(a.parcelle);
    }
  }
  const paires = new Map<string, number>();
  for (const parcelles of parPosition.values()) {
    const liste = [...parcelles].sort((x, y) => x - y);
    for (let i = 0; i < liste.length; i++) {
      for (let j = i + 1; j < liste.length; j++) {
        const cle = `${liste[i]}|${liste[j]}`;
        paires.set(cle, (paires.get(cle) ?? 0) + 1);
      }
    }
  }
  return paires;
}

/**
 * Limites communes qui ne coïncident plus : entre deux sommets communs consécutifs d'une parcelle B,
 * reliés directement dans la parcelle voisine A, tous les points de B doivent être sur ce segment
 * de A. Sinon il reste une bande vide ou un chevauchement (par exemple après le remplacement du
 * contour de A, ou un point ajouté puis déplacé chez un seul des deux).
 */
function limitesDecollees(td: TaskData, etat: Etat, parcelles: readonly number[]): string[] {
  const messages: string[] = [];
  const cle = (s: { lat: number; lon: number }) => `${s.lat} ${s.lon}`;
  for (const b of etat.anneaux) {
    for (const a of etat.anneaux) {
      if (a === b || a.parcelle === b.parcelle) continue;
      if (!parcelles.includes(a.parcelle) && !parcelles.includes(b.parcelle)) continue;
      const indexA = new Map(a.sommets.map((s, i) => [cle(s), i]));
      const communs = b.sommets.flatMap((s, i) => (indexA.has(cle(s)) ? [i] : []));
      if (communs.length < 2) continue;
      const n = b.sommets.length;
      let probleme = 0;
      communs.forEach((i, k) => {
        const j = communs[(k + 1) % communs.length]!;
        const entre: number[] = [];
        for (let x = (i + 1) % n; x !== j; x = (x + 1) % n) entre.push(x);
        if (entre.length === 0) return;
        // Sommets aussi reliés directement dans B : la limite commune est ce segment, et le
        // chemin trouvé est le reste du contour (parcelle étroite).
        if ((j + 1) % n === i) return;
        // Les deux sommets doivent être reliés directement dans A.
        const ia = indexA.get(cle(b.sommets[i]!))!;
        const ja = indexA.get(cle(b.sommets[j]!))!;
        const m = a.sommets.length;
        if ((ia + 1) % m !== ja && (ja + 1) % m !== ia) return;
        const plan = planLocal(latLon(b.sommets[i]!));
        const p1 = plan.versXY(latLon(b.sommets[i]!));
        const p2 = plan.versXY(latLon(b.sommets[j]!));
        const pts = entre.map((x) => plan.versXY(latLon(b.sommets[x]!)));
        // Le chemin de B doit longer le segment (sinon c'est l'autre côté de la parcelle).
        let longueur = 0;
        let prec = p1;
        for (const q of [...pts, p2]) {
          longueur += Math.hypot(q[0] - prec[0], q[1] - prec[1]);
          prec = q;
        }
        if (longueur > 1.5 * Math.hypot(p2[0] - p1[0], p2[1] - p1[1])) return;
        probleme += pts.filter((q) => distanceAuSegment(q, p1, p2) > 0.01).length;
      });
      if (probleme > 0) {
        messages.push(
          `${td.parcelles[b.parcelle]!.nom} / ${td.parcelles[a.parcelle]!.nom} : la limite commune ne coïncide plus (${probleme} point(s) de ${td.parcelles[b.parcelle]!.nom} hors de la limite de ${td.parcelles[a.parcelle]!.nom}) ; risque de bande vide ou de chevauchement, vérifie sur la carte.`,
        );
      }
    }
  }
  return messages;
}

function distanceAuSegment(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
