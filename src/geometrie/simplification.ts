// Simplification d'un contour : Douglas-Peucker, puis redressement des côtés.
//
// 1. Douglas-Peucker choisit les sommets à garder : on retire tout point dont la suppression
//    déplace le contour de moins de la tolérance. Les sommets « fixes » (communs avec une parcelle
//    voisine, et le premier point du fichier) sont toujours gardés.
// 2. Redressement : chaque côté devient la droite qui passe au mieux au milieu de tous les points
//    mesurés entre ses deux extrémités (moindres carrés orthogonaux), et chaque coin est recalculé
//    à l'intersection des droites de ses deux côtés. Un sommet fixe ne bouge pas : les droites
//    voisines passent par lui.

import type { XY } from './plan';

export interface Simplification {
  /** Nouveaux sommets, dans l'ordre du contour. */
  points: XY[];
  /** Pour chaque nouveau sommet, l'indice du sommet d'origine qu'il remplace. */
  origines: number[];
  /** Plus grande distance entre un point d'origine et le nouveau contour (m). */
  ecartMax: number;
}

/** En dessous de cet angle entre deux côtés, leur intersection n'est pas fiable. */
const ANGLE_MIN_RAD = (10 * Math.PI) / 180;

function distanceSegment(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Douglas-Peucker sur la chaîne pts[debut..fin] : ajoute à `gardes` les indices intérieurs retenus. */
function douglasPeucker(pts: XY[], debut: number, fin: number, tol: number, gardes: Set<number>) {
  let iMax = -1;
  let dMax = 0;
  for (let i = debut + 1; i < fin; i++) {
    const d = distanceSegment(pts[i]!, pts[debut]!, pts[fin]!);
    if (d > dMax) {
      dMax = d;
      iMax = i;
    }
  }
  if (iMax >= 0 && dMax > tol) {
    gardes.add(iMax);
    douglasPeucker(pts, debut, iMax, tol, gardes);
    douglasPeucker(pts, iMax, fin, tol, gardes);
  }
}

interface Droite {
  /** Point de passage. */
  p: XY;
  /** Direction unitaire. */
  u: XY;
}

/** Droite des moindres carrés orthogonaux ; si `passant` est donné, elle passe par ce point. */
function ajuster(points: XY[], passant: XY | null): Droite {
  const n = points.length;
  const c: XY = passant ?? [
    points.reduce((s, p) => s + p[0], 0) / n,
    points.reduce((s, p) => s + p[1], 0) / n,
  ];
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    const x = p[0] - c[0];
    const y = p[1] - c[1];
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { p: c, u: [Math.cos(angle), Math.sin(angle)] };
}

function droiteParDeuxPoints(a: XY, b: XY): Droite {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return { p: a, u: [(b[0] - a[0]) / l, (b[1] - a[1]) / l] };
}

function projeter(q: XY, d: Droite): XY {
  const t = (q[0] - d.p[0]) * d.u[0] + (q[1] - d.p[1]) * d.u[1];
  return [d.p[0] + t * d.u[0], d.p[1] + t * d.u[1]];
}

function intersection(d1: Droite, d2: Droite): XY | null {
  const det = d1.u[0] * d2.u[1] - d1.u[1] * d2.u[0];
  if (Math.abs(det) < Math.sin(ANGLE_MIN_RAD)) return null;
  const t = ((d2.p[0] - d1.p[0]) * d2.u[1] - (d2.p[1] - d1.p[1]) * d2.u[0]) / det;
  return [d1.p[0] + t * d1.u[0], d1.p[1] + t * d1.u[1]];
}

/** Plus grande distance entre les points d'origine et le contour fermé `contour`. */
export function ecartMaximal(origine: XY[], contour: XY[]): number {
  let max = 0;
  for (const p of origine) {
    let d = Infinity;
    for (let j = 0; j < contour.length; j++) {
      d = Math.min(d, distanceSegment(p, contour[j]!, contour[(j + 1) % contour.length]!));
    }
    max = Math.max(max, d);
  }
  return max;
}

/**
 * Simplifie un contour fermé (sans répétition du premier point). `fixes` : indices des sommets à
 * garder tels quels. Le sommet 0 est toujours gardé (il porte « start » dans le fichier).
 */
export function simplifierContour(
  pts: XY[],
  tolerance: number,
  fixes: ReadonlySet<number>,
): Simplification {
  const n = pts.length;
  if (n <= 3) return { points: [...pts], origines: pts.map((_, i) => i), ecartMax: 0 };

  // Points d'appui : sommet 0, sommets fixes, et le point le plus éloigné du sommet 0 (un contour
  // fermé a besoin d'au moins deux appuis pour Douglas-Peucker).
  const appuis = new Set<number>([0, ...fixes]);
  let loin = 0;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(pts[i]![0] - pts[0]![0], pts[i]![1] - pts[0]![1]);
    if (d > Math.hypot(pts[loin]![0] - pts[0]![0], pts[loin]![1] - pts[0]![1])) loin = i;
  }
  appuis.add(loin);
  const ordre = [...appuis].sort((a, b) => a - b);

  // On déroule l'anneau (indice n = sommet 0) pour traiter chaque tronçon entre deux appuis.
  const deroule = [...pts, pts[0]!];
  const gardes = new Set<number>(ordre);
  for (let k = 0; k < ordre.length; k++) {
    const debut = ordre[k]!;
    const fin = k + 1 < ordre.length ? ordre[k + 1]! : n;
    const interieurs = new Set<number>();
    douglasPeucker(deroule, debut, fin, tolerance, interieurs);
    for (const i of interieurs) gardes.add(i % n);
  }
  const indices = [...gardes].sort((a, b) => a - b);
  const m = indices.length;
  if (m < 3) return { points: [...pts], origines: pts.map((_, i) => i), ecartMax: 0 };

  // Redressement : une droite par côté, ajustée sur tous les points mesurés du côté.
  const droites: Droite[] = indices.map((a, k) => {
    const b = indices[(k + 1) % m]!;
    const fin = b > a ? b : b + n;
    const mesures: XY[] = [];
    for (let i = a; i <= fin; i++) mesures.push(pts[i % n]!);
    const fa = fixes.has(a);
    const fb = fixes.has(b);
    if ((fa && fb) || mesures.length <= 2) return droiteParDeuxPoints(pts[a]!, pts[b]!);
    if (fa) return ajuster(mesures, pts[a]!);
    if (fb) return ajuster(mesures, pts[b]!);
    return ajuster(mesures, null);
  });

  const points = indices.map((i, k): XY => {
    const avant = droites[(k - 1 + m) % m]!;
    const apres = droites[k]!;
    if (fixes.has(i)) return pts[i]!;
    const coin = intersection(avant, apres);
    // Côtés presque alignés (courbe douce) ou coin parti trop loin : on garde le point mesuré,
    // ramené au milieu des deux droites.
    if (!coin || Math.hypot(coin[0] - pts[i]![0], coin[1] - pts[i]![1]) > 3 * tolerance) {
      const a = projeter(pts[i]!, avant);
      const b = projeter(pts[i]!, apres);
      return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    }
    return coin;
  });

  return { points, origines: indices, ecartMax: ecartMaximal(pts, points) };
}
