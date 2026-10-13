// Calculs sur les parcelles lues dans le fichier.

import { aireSignee, planLocal, type LatLon } from '../geometrie/plan';
import type { Anneau, Parcelle } from './lecture';

/** Points de l'anneau sans la répétition finale du premier point. */
export function sommets(anneau: Anneau): LatLon[] {
  const pts = anneau.points.map((p): LatLon => [p.lat, p.lon]);
  const premier = pts[0];
  const dernier = pts[pts.length - 1];
  if (
    pts.length > 1 &&
    premier &&
    dernier &&
    premier[0] === dernier[0] &&
    premier[1] === dernier[1]
  ) {
    pts.pop();
  }
  return pts;
}

/** Surface cultivable en m² : contour extérieur moins les zones exclues. */
export function surfaceParcelle(parcelle: Parcelle): number {
  const exterieur = parcelle.anneaux.find((a) => a.type === 1);
  if (!exterieur || exterieur.points.length === 0) return 0;
  const p0 = exterieur.points[0]!;
  const plan = planLocal([p0.lat, p0.lon]);
  let total = 0;
  for (const anneau of parcelle.anneaux) {
    const aire = Math.abs(aireSignee(sommets(anneau).map(plan.versXY)));
    total += anneau.type === 1 ? aire : -aire;
  }
  return total;
}
