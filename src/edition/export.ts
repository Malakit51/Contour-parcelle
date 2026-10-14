// Passage de l'état modifié aux changements à écrire dans le fichier.

import { exporterTaskData, type Changements } from '../isoxml/ecriture';
import type { Point, TaskData } from '../isoxml/lecture';
import { etatInitial, surfaceEtat, type Etat } from './etat';

/** Parcelles dont au moins un sommet a bougé, a été ajouté ou supprimé. */
export function parcellesModifiees(etat: Etat): number[] {
  const modifiees = new Set<number>();
  for (const a of etat.anneaux) {
    const supprime = a.sommets.filter((s) => s.origine).length < a.nbOrigine;
    if (
      supprime ||
      a.sommets.some((s) => !s.origine || s.lat !== s.origine.lat || s.lon !== s.origine.lon)
    ) {
      modifiees.add(a.parcelle);
    }
  }
  return [...modifiees].sort((x, y) => x - y);
}

/**
 * Nouvelle surface à écrire dans D. On applique à la surface du fichier la variation relative
 * calculée par l'éditeur : D est calculé par un autre logiciel, avec un écart d'environ 0,05 %
 * par rapport au calcul de l'éditeur, et écrire directement notre calcul ferait varier D même
 * pour un décalage de quelques centimètres.
 */
export function nouvelleSurface(td: TaskData, etat: Etat, parcelle: number): number | null {
  const d = td.parcelles[parcelle]?.surface;
  if (!d) return null;
  const avant = surfaceEtat(etatInitial(td), parcelle);
  return (Number(d.texte) * surfaceEtat(etat, parcelle)) / avant;
}

export function changementsDepuisEtat(td: TaskData, etat: Etat): Changements {
  const points: NonNullable<Changements['points']>[number][] = [];
  const insertions: { apres: Point; points: { lat: number; lon: number }[] }[] = [];
  const suppressions: Point[] = [];
  for (const a of etat.anneaux) {
    const anneau = td.parcelles[a.parcelle]!.anneaux[a.anneau]!;
    // Points du fichier qui ne sont plus utilisés (hors répétition finale du premier).
    const utilises = new Set(a.sommets.map((s) => s.origine));
    suppressions.push(...anneau.points.slice(0, a.nbOrigine).filter((p) => !utilises.has(p)));
    let dernier: Point | null = null;
    a.sommets.forEach((s, i) => {
      if (s.origine) {
        dernier = s.origine;
        if (s.lat !== s.origine.lat || s.lon !== s.origine.lon) {
          points.push({ point: s.origine, lat: s.lat, lon: s.lon });
          // Le premier point est répété à la fin de l'anneau dans le fichier.
          if (i === 0) points.push({ point: anneau.points.at(-1)!, lat: s.lat, lon: s.lon });
        }
        return;
      }
      if (!dernier) throw new Error("Un point ajouté ne peut pas être le premier de l'anneau.");
      const groupe = insertions.at(-1);
      if (groupe?.apres === dernier) groupe.points.push({ lat: s.lat, lon: s.lon });
      else insertions.push({ apres: dernier, points: [{ lat: s.lat, lon: s.lon }] });
    });
  }
  const surfaces = parcellesModifiees(etat).flatMap((p) => {
    const m2 = nouvelleSurface(td, etat, p);
    return m2 === null ? [] : [{ parcelle: td.parcelles[p]!, m2 }];
  });
  const guidages = td.parcelles.flatMap((parcelle, i) => {
    const lignes = (etat.guidages ?? []).filter((g) => g.parcelle === i);
    return lignes.length === 0
      ? []
      : [
          {
            parcelle,
            lignes: lignes.map((g) => ({
              nom: g.nom,
              points: g.points.map(([lat, lon]) => ({ lat, lon })),
            })),
          },
        ];
  });
  return { points, insertions, suppressions, surfaces, guidages };
}

export function exporterEtat(td: TaskData, etat: Etat): string {
  return exporterTaskData(td, changementsDepuisEtat(td, etat));
}
