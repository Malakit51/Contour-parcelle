// Zones dessinées dans les notes (tache de vulpin, mouillère…) : un polygone en
// [latitude, longitude], sans répétition du premier point.

import { aireSignee, pointDansPolygone, planLocal, type LatLon, type XY } from '../geometrie/plan';

export type Zone = [number, number][];

/** Un point du tracé GPS est gardé s'il est assez précis et assez loin du précédent. */
export const PRECISION_MAX_M = 15;
export const ECART_MIN_M = 2;

/** Surface de la zone en m² (plan local centré sur son premier point). */
export function surfaceZone(zone: readonly LatLon[]): number {
  if (zone.length < 3) return 0;
  const plan = planLocal(zone[0]!);
  return Math.abs(aireSignee(zone.map((p) => plan.versXY(p))));
}

/**
 * Point à l'intérieur de la zone, pour l'épingle et pour savoir dans quelle parcelle elle est :
 * le centre de gravité s'il est dedans (zone en L ou en croissant : sinon le centre d'un des
 * triangles formés par trois sommets consécutifs).
 */
export function pointInterieur(zone: readonly LatLon[]): [number, number] {
  const plan = planLocal(zone[0]!);
  const xy = zone.map((p) => plan.versXY(p));
  const n = xy.length;
  const moyenne = (pts: XY[]): XY => [
    pts.reduce((s, p) => s + p[0], 0) / pts.length,
    pts.reduce((s, p) => s + p[1], 0) / pts.length,
  ];
  const candidats = [moyenne(xy)];
  for (let k = 0; k < n; k++) candidats.push(moyenne([xy[k]!, xy[(k + 1) % n]!, xy[(k + 2) % n]!]));
  const bon = candidats.find((c) => pointDansPolygone(c, xy)) ?? candidats[0]!;
  const [lat, lon] = plan.versLatLon(bon);
  return [lat, lon];
}

/** Ajoute une position GPS au tracé si elle est précise et à plus de 2 m de la précédente. */
export function ajouterPointTrace(trace: readonly LatLon[], p: LatLon, precision: number): Zone {
  const copie = trace.map((q): [number, number] => [q[0], q[1]]);
  if (precision > PRECISION_MAX_M) return copie;
  const dernier = trace[trace.length - 1];
  if (dernier) {
    const plan = planLocal(dernier);
    const [x, y] = plan.versXY(p);
    if (Math.hypot(x, y) < ECART_MIN_M) return copie;
  }
  return [...copie, [p[0], p[1]]];
}

/** « 0,35 ha » au-dessus d'un demi-hectare, sinon « 850 m² ». */
export function texteSurface(m2: number): string {
  return m2 >= 5000
    ? `${(m2 / 10000).toFixed(2).replace('.', ',')} ha`
    : `${Math.round(m2).toLocaleString('fr-FR')} m²`;
}

/** Zone écrite dans le CSV : « lat lon | lat lon | … » (point décimal, 7 décimales). */
export function zoneEnTexte(zone: readonly LatLon[]): string {
  return zone.map((p) => `${p[0].toFixed(7)} ${p[1].toFixed(7)}`).join(' | ');
}

/** Relit une zone écrite par `zoneEnTexte` (virgule décimale acceptée) ; null si illisible. */
export function zoneDuTexte(texte: string): Zone | null {
  const pts = texte
    .split('|')
    .map((m) => m.trim())
    .filter(Boolean)
    .map((m) => m.split(/\s+/).map((v) => Number(v.replace(',', '.'))));
  if (pts.length < 3 || pts.some((p) => p.length !== 2 || p.some((v) => !Number.isFinite(v))))
    return null;
  return pts.map(([a, b]) => [a!, b!]);
}
