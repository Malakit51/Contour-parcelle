// Coller un bord sur la limite d'une parcelle voisine.
//
// Le bord choisi (du premier au dernier sommet) prend exactement la limite de la voisine, qui sert
// de modèle et ne bouge pas : les sommets du bord entre ses deux extrémités sont remplacés par
// ceux de la voisine, et les deux extrémités sont posées sur sa limite (et y sont ajoutées). Tous
// les sommets du bord deviennent ainsi communs aux deux parcelles (règle 1).

import {
  distancePointSegment,
  intersection,
  planLocal,
  positionSurSegment,
  type LatLon,
  type Plan,
  type XY,
} from '../geometrie/plan';
import {
  latLon,
  limitesJumelles,
  sommetsEn,
  TOLERANCE_PARTAGE_M,
  type Etat,
  type Sommet,
} from './etat';
import { appliquer, ErreurEdition, sommetsDuBord, type Ajout, type Bord } from './operations';

/** Au-delà de cette distance (m) entre le bord et la voisine, c'est sûrement une erreur. */
export const COLLAGE_MAX_M = 20;
/** En dessous de cet angle (degrés), la limite prolongée ne coupe pas la voisine de façon fiable. */
const ANGLE_MIN_DEG = 10;

export interface BilanCollage {
  /** Anneau de la voisine qui sert de modèle. */
  modele: number;
  avant: number;
  apres: number;
  /** Plus grande distance (m) entre un point de l'ancien bord et le nouveau. */
  ecartMax: number;
  /** Points ajoutés sur la limite de la voisine (extrémités du bord), 0 à 2. */
  ajoutsModele: number;
}

const xyDe = (plan: Plan, s: Sommet): XY => plan.versXY(latLon(s));

function distancePolyligne(p: XY, pts: readonly XY[], ferme: boolean): number {
  let d = Infinity;
  const n = ferme ? pts.length : pts.length - 1;
  for (let k = 0; k < n; k++) {
    d = Math.min(d, distancePointSegment(p, pts[k]!, pts[(k + 1) % pts.length]!));
  }
  return d;
}

/**
 * Anneau d'une autre parcelle le plus proche du bord (distance moyenne de ses sommets), s'il est
 * à moins de `COLLAGE_MAX_M` ; null sinon.
 */
export function modeleLePlusProche(etat: Etat, bord: Bord): number | null {
  const x = etat.anneaux[bord.anneau]!;
  const plan = planLocal(latLon(x.sommets[bord.debut]!));
  const pts = sommetsDuBord(etat, bord).map((i) => xyDe(plan, x.sommets[i]!));
  let meilleur: { anneau: number; d: number } | null = null;
  etat.anneaux.forEach((a, i) => {
    if (a.parcelle === x.parcelle) return;
    const ring = a.sommets.map((s) => xyDe(plan, s));
    const d = pts.reduce((t, p) => t + distancePolyligne(p, ring, true), 0) / pts.length;
    if (d <= COLLAGE_MAX_M && (!meilleur || d < meilleur.d)) meilleur = { anneau: i, d };
  });
  return (meilleur as { anneau: number } | null)?.anneau ?? null;
}

/** Où une extrémité du bord se pose sur le modèle : un de ses sommets, ou un point d'un segment. */
type Pose = { sommet: number; garde: boolean } | { segment: number; ll: LatLon };

/**
 * Colle le bord `bord` sur la limite de l'anneau `modele` (une autre parcelle, qui ne bouge pas).
 *
 * Chaque extrémité du bord déjà sur un sommet du modèle (à 2 cm près) y reste. Sinon, la limite
 * voisine hors du bord est prolongée (ou raccourcie) jusqu'au modèle, pour garder sa direction ;
 * à défaut, l'extrémité est ramenée au plus près sur le modèle. Le point est ajouté au modèle (et
 * aux parcelles qui partagent ce segment du modèle), sans changer leur surface.
 */
export function collerBord(
  etat: Etat,
  bord: Bord,
  modele: number,
): { etat: Etat; bilan: BilanCollage } {
  const X = bord.anneau;
  const x = etat.anneaux[X]!;
  const y = etat.anneaux[modele]!;
  if (y.parcelle === x.parcelle) {
    throw new ErreurEdition('Choisis une autre parcelle comme modèle.');
  }
  const ids = sommetsDuBord(etat, bord);
  const autresParcelles = (i: number) =>
    sommetsEn(etat, latLon(x.sommets[i]!)).filter((r) => r.anneau !== X && r.anneau !== modele);
  if (ids.slice(1, -1).some((i) => autresParcelles(i).length > 0)) {
    throw new ErreurEdition(
      'Le bord passe par un point commun avec une troisième parcelle : choisis un bord plus court.',
    );
  }

  const plan = planLocal(latLon(x.sommets[bord.debut]!));
  const ancienBord = ids.map((i) => xyDe(plan, x.sommets[i]!));
  const ring = y.sommets.map((s) => xyDe(plan, s));
  const m = ring.length;
  const n = x.sommets.length;
  const pas = (i: number, sens: 1 | -1) => (i + (bord.aRebours ? -sens : sens) + n) % n;

  const poser = (e: number, dehors: number): Pose => {
    const E = xyDe(plan, x.sommets[e]!);
    const proche = ring.findIndex(
      (q) => Math.hypot(q[0] - E[0], q[1] - E[1]) <= TOLERANCE_PARTAGE_M,
    );
    if (proche >= 0) return { sommet: proche, garde: true };
    if (autresParcelles(e).length > 0) {
      throw new ErreurEdition(
        'Un bout du bord est un point commun avec une troisième parcelle et n’est pas sur la limite du modèle : choisis un autre bout.',
      );
    }
    // Prolongement de la limite voisine (hors du bord) jusqu'au modèle.
    const O = xyDe(plan, x.sommets[dehors]!);
    const u: XY = [E[0] - O[0], E[1] - O[1]];
    const lu = Math.hypot(...u);
    let choix: { segment: number; p: XY; d: number } | null = null;
    for (let k = 0; k < m; k++) {
      const a = ring[k]!;
      const b = ring[(k + 1) % m]!;
      const p = intersection(
        E,
        u,
        a,
        [b[0] - a[0], b[1] - a[1]],
        Math.sin((ANGLE_MIN_DEG * Math.PI) / 180),
      );
      if (!p) continue;
      const t = ((p[0] - E[0]) * u[0] + (p[1] - E[1]) * u[1]) / lu; // mètres au-delà de E
      const pos = positionSurSegment(p, a, b);
      if (pos.t < 0 || pos.t > 1 || t <= -lu + 0.01 || Math.abs(t) > COLLAGE_MAX_M) continue;
      if (!choix || Math.abs(t) < choix.d) choix = { segment: k, p, d: Math.abs(t) };
    }
    if (!choix) {
      // Repli : le point du modèle le plus proche.
      for (let k = 0; k < m; k++) {
        const a = ring[k]!;
        const b = ring[(k + 1) % m]!;
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const t = Math.max(
          0,
          Math.min(1, ((E[0] - a[0]) * dx + (E[1] - a[1]) * dy) / (dx * dx + dy * dy)),
        );
        const p: XY = [a[0] + t * dx, a[1] + t * dy];
        const d = Math.hypot(p[0] - E[0], p[1] - E[1]);
        if (!choix || d < choix.d) choix = { segment: k, p, d };
      }
    }
    if (!choix || choix.d > COLLAGE_MAX_M) {
      throw new ErreurEdition(`Le bord est à plus de ${COLLAGE_MAX_M} m de la parcelle modèle.`);
    }
    // Tout contre un sommet du modèle : on prend le sommet.
    for (const k of [choix.segment, (choix.segment + 1) % m]) {
      const q = ring[k]!;
      if (Math.hypot(q[0] - choix.p[0], q[1] - choix.p[1]) <= TOLERANCE_PARTAGE_M)
        return { sommet: k, garde: false };
    }
    return { segment: choix.segment, ll: plan.versLatLon(choix.p) };
  };

  const pose0 = poser(bord.debut, pas(bord.debut, -1));
  const pose1 = poser(bord.fin, pas(bord.fin, 1));

  // Extrémités ajoutées au modèle (et aux parcelles qui partagent ce segment avec lui), une à une :
  // les indices du modèle changent à chaque ajout.
  let e1 = etat;
  const lls: LatLon[] = [];
  let ajoutsModele = 0;
  for (const pose of [pose0, pose1]) {
    if ('sommet' in pose) {
      lls.push(latLon(etat.anneaux[modele]!.sommets[pose.sommet]!));
      continue;
    }
    const sommets = e1.anneaux[modele]!.sommets;
    const ll = pose.ll;
    // Segment du modèle (dans l'état courant) qui porte le point.
    const p = plan.versXY(ll);
    let k = 0;
    let dMin = Infinity;
    sommets.forEach((s, i) => {
      const d = distancePointSegment(
        p,
        xyDe(plan, s),
        xyDe(plan, sommets[(i + 1) % sommets.length]!),
      );
      if (d < dMin) [k, dMin] = [i, d];
    });
    const ajouts: Ajout[] = [
      { anneau: modele, v: k, w: (k + 1) % sommets.length, ll },
      ...limitesJumelles(e1, { anneau: modele, debut: k })
        .filter((j) => j.anneau !== X)
        .map((j) => ({ anneau: j.anneau, v: j.debut, w: j.fin, ll })),
    ];
    e1 = appliquer(e1, [], ajouts);
    lls.push(ll);
    ajoutsModele++;
  }

  // Chemin sur le modèle entre les deux extrémités, dans le sens qui longe l'ancien bord.
  const y1 = e1.anneaux[modele]!;
  const ring1 = y1.sommets.map((s) => xyDe(plan, s));
  const m1 = ring1.length;
  const indice = (ll: LatLon) => {
    const p = plan.versXY(ll);
    let k = 0;
    let dMin = Infinity;
    ring1.forEach((q, i) => {
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d < dMin) [k, dMin] = [i, d];
    });
    return k;
  };
  const s0 = indice(lls[0]!);
  const s1 = indice(lls[1]!);
  if (s0 === s1)
    throw new ErreurEdition('Les deux bouts du bord tombent au même endroit du modèle.');
  const chemin = (sens: 1 | -1) => {
    const ks: number[] = [];
    for (let k = (s0 + sens + m1) % m1; k !== s1; k = (k + sens + m1) % m1) ks.push(k);
    return ks;
  };
  const ecartAuBord = (ks: number[]) => {
    const pts = [plan.versXY(lls[0]!), ...ks.map((k) => ring1[k]!), plan.versXY(lls[1]!)];
    let d = 0;
    for (let k = 0; k < pts.length; k++) {
      d = Math.max(d, distancePolyligne(pts[k]!, ancienBord, false));
      if (k > 0) {
        const mil: XY = [(pts[k - 1]![0] + pts[k]![0]) / 2, (pts[k - 1]![1] + pts[k]![1]) / 2];
        d = Math.max(d, distancePolyligne(mil, ancienBord, false));
      }
    }
    return d;
  };
  const [avant, arriere] = [chemin(1), chemin(-1)];
  const interieur = ecartAuBord(avant) <= ecartAuBord(arriere) ? avant : arriere;

  // Nouveau contour, dans le sens du bord : bord recollé puis le reste du contour.
  const dehors = sommetsDuBord(etat, { ...bord, debut: bord.fin, fin: bord.debut }).slice(1, -1);
  const fixe = (i: number, ll: LatLon): Sommet => {
    const s = x.sommets[i]!;
    return s.lat === ll[0] && s.lon === ll[1] ? s : { lat: ll[0], lon: ll[1], origine: s.origine };
  };
  // Une extrémité déjà commune avec le modèle garde ses coordonnées (les voisins aussi les ont).
  const bout = (i: number, pose: Pose, ll: LatLon) =>
    'sommet' in pose && pose.garde ? x.sommets[i]! : fixe(i, ll);
  let seq: { s: Sommet; src: number | null }[] = [
    { s: bout(bord.debut, pose0, lls[0]!), src: bord.debut },
    ...interieur.map((k) => ({ s: { ...y1.sommets[k]!, origine: null }, src: null })),
    { s: bout(bord.fin, pose1, lls[1]!), src: bord.fin },
    ...dehors.map((i) => ({ s: x.sommets[i]!, src: i })),
  ];
  if (bord.aRebours) seq.reverse();
  // Le premier point du fichier (ligne « start ») reste en tête.
  const tete = seq.findIndex((e) => e.src === 0);
  if (tete >= 0) {
    seq = [...seq.slice(tete), ...seq.slice(0, tete)];
  } else {
    // Il était dans le bord : le point qui suit l'extrémité précédente prend sa ligne.
    const avantBord = bord.aRebours ? bord.fin : bord.debut;
    const k = (seq.findIndex((e) => e.src === avantBord) + 1) % seq.length;
    seq = [...seq.slice(k), ...seq.slice(0, k)];
    seq[0] = { ...seq[0]!, s: { ...seq[0]!.s, origine: x.sommets[0]!.origine } };
  }
  if (seq.length < 3) throw new ErreurEdition('Le contour aurait moins de 3 points.');

  const nouveauBord = [
    plan.versXY(lls[0]!),
    ...interieur.map((k) => ring1[k]!),
    plan.versXY(lls[1]!),
  ];
  const ecartMax = Math.max(...ancienBord.map((p) => distancePolyligne(p, nouveauBord, false)));
  if (ecartMax > COLLAGE_MAX_M) {
    throw new ErreurEdition(`Le bord est à plus de ${COLLAGE_MAX_M} m de la parcelle modèle.`);
  }
  const sommets = seq.map((e) => e.s);
  return {
    etat: { ...e1, anneaux: e1.anneaux.map((a, i) => (i === X ? { ...a, sommets } : a)) },
    bilan: { modele, avant: n, apres: sommets.length, ecartMax, ajoutsModele },
  };
}
