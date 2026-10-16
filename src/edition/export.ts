// Passage de l'état modifié aux changements à écrire dans le fichier.

import { exporterTaskData, type Changements } from '../isoxml/ecriture';
import { lireTaskData, type Point, type TaskData } from '../isoxml/lecture';
import {
  anneauIgnore,
  distanceM,
  estSupprimee,
  etatInitial,
  latLon,
  surfaceEtat,
  type Etat,
} from './etat';

/** Parcelles dont au moins un sommet a bougé, a été ajouté ou supprimé. */
export function parcellesModifiees(etat: Etat): number[] {
  const modifiees = new Set<number>();
  for (const i of etat.zonesRetirees ?? []) {
    const p = etat.anneaux[i]!.parcelle;
    if (!estSupprimee(etat, p)) modifiees.add(p);
  }
  for (const [i, a] of etat.anneaux.entries()) {
    if (anneauIgnore(etat, i)) continue;
    if (a.anneau < 0) {
      modifiees.add(a.parcelle);
      continue;
    }
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
  for (const [i, a] of etat.anneaux.entries()) {
    if (anneauIgnore(etat, i) || a.anneau < 0) continue;
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
          // (seulement si l'anneau est bien fermé dans le fichier : sinon le dernier point est un
          // vrai sommet, à ne pas écraser).
          if (i === 0 && anneau.points.length > a.nbOrigine) {
            points.push({ point: anneau.points.at(-1)!, lat: s.lat, lon: s.lon });
          }
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
    if (estSupprimee(etat, i)) return [];
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
  const parcellesRetirees = (etat.supprimees ?? []).map((p) => td.parcelles[p]!);
  const zonesRetirees = (etat.zonesRetirees ?? [])
    .filter((i) => !estSupprimee(etat, etat.anneaux[i]!.parcelle))
    .map((i) => {
      const a = etat.anneaux[i]!;
      const plage = td.parcelles[a.parcelle]!.anneaux[a.anneau]!.plage;
      if (!plage) throw new Error('Zone exclue introuvable dans le fichier.');
      return plage;
    });
  // Zones exclues créées dans l'éditeur : écrites après le dernier anneau gardé de la parcelle.
  const zonesAjoutees = td.parcelles.flatMap((parcelle, p) => {
    const nouvelles = etat.anneaux.filter(
      (a, i) => a.parcelle === p && a.anneau < 0 && !anneauIgnore(etat, i),
    );
    if (nouvelles.length === 0) return [];
    const gardes = etat.anneaux.filter(
      (a, i) => a.parcelle === p && a.anneau >= 0 && !anneauIgnore(etat, i),
    );
    const dernier = parcelle.anneaux[gardes.at(-1)?.anneau ?? -1];
    if (!dernier?.plage) throw new Error(`${parcelle.nom} : contour introuvable dans le fichier.`);
    return [
      {
        parcelle,
        apres: dernier.plage.fin,
        zones: nouvelles.map((a) => a.sommets.map((s) => ({ lat: s.lat, lon: s.lon }))),
      },
    ];
  });
  return {
    points,
    insertions,
    suppressions,
    surfaces,
    guidages,
    parcellesRetirees,
    zonesRetirees,
    zonesAjoutees,
  };
}

export function exporterEtat(td: TaskData, etat: Etat): string {
  return exporterTaskData(td, changementsDepuisEtat(td, etat));
}

/**
 * Relit le fichier produit et le compare à l'état : chaque contour doit y être, point pour point
 * (à l'arrondi près des décimales du fichier), fermé comme dans l'original, et chaque ligne de
 * guidage présente. Renvoie la liste des problèmes (vide si tout va bien). Filet de sécurité
 * contre un fichier mal écrit (XML cassé, point en double, anneau ouvert…).
 */
export function verifierRelecture(td: TaskData, etat: Etat, texte: string): string[] {
  let relu: TaskData;
  try {
    relu = lireTaskData(texte);
  } catch (e) {
    return [`Le fichier produit est illisible : ${(e as Error).message}`];
  }
  const problemes: string[] = [];
  // Parcelles gardées, dans l'ordre : la i-ième du fichier produit est gardees[i].
  const gardees = td.parcelles.map((_, i) => i).filter((i) => !estSupprimee(etat, i));
  if (relu.parcelles.length !== gardees.length) {
    problemes.push('Le fichier produit n’a pas le nombre de parcelles attendu.');
    return problemes;
  }
  if (gardees.some((p, i) => relu.parcelles[i]!.id !== td.parcelles[p]!.id)) {
    problemes.push('Les parcelles du fichier produit ne sont pas celles attendues.');
    return problemes;
  }
  const reluEtat = etatInitial(relu);
  for (const [k, a] of etat.anneaux.entries()) {
    if (anneauIgnore(etat, k)) continue;
    const nom = td.parcelles[a.parcelle]!.nom;
    const i = gardees.indexOf(a.parcelle);
    // Rang de l'anneau dans le fichier produit : les anneaux gardés de la parcelle, dans l'ordre
    // (ceux du fichier, puis les zones créées dans l'éditeur, écrites après).
    const rang = etat.anneaux
      .map((x, j) => ({ x, j }))
      .filter(({ x, j }) => x.parcelle === a.parcelle && !anneauIgnore(etat, j))
      .sort(
        (u, v) =>
          (u.x.anneau < 0 ? 1e9 + u.j : u.x.anneau) - (v.x.anneau < 0 ? 1e9 + v.j : v.x.anneau),
      )
      .findIndex(({ j }) => j === k);
    const r = reluEtat.anneaux.find((x) => x.parcelle === i && x.anneau === rang);
    const ferme = (pts: readonly { lat: number; lon: number }[]) =>
      pts.length > 1 && pts[0]!.lat === pts.at(-1)!.lat && pts[0]!.lon === pts.at(-1)!.lon;
    if (!r || r.sommets.length !== a.sommets.length) {
      problemes.push(`${nom} : le contour écrit n’a pas le bon nombre de points.`);
    } else if (r.sommets.some((s, i) => distanceM(latLon(s), latLon(a.sommets[i]!)) > 0.02)) {
      problemes.push(`${nom} : un point du contour écrit n’est pas à la bonne place.`);
    } else if (
      (a.anneau < 0 ? true : ferme(td.parcelles[a.parcelle]!.anneaux[a.anneau]!.points)) !==
      ferme(relu.parcelles[i]!.anneaux[rang]!.points)
    ) {
      problemes.push(`${nom} : le contour écrit n’est plus fermé comme dans l’original.`);
    }
  }
  const lignes = (etat.guidages ?? []).filter((g) => !estSupprimee(etat, g.parcelle)).length;
  if (relu.segmentsIgnores.length !== lignes) {
    problemes.push('Les lignes de guidage écrites ne correspondent pas à celles de l’éditeur.');
  }
  return problemes;
}
