// Modifications des contours : décaler une limite, faire glisser un sommet.
//
// Règle commune : un sommet partagé par plusieurs parcelles bouge dans toutes à la fois, et le
// contour extérieur d'un ensemble de parcelles voisines ne bouge jamais sans qu'on l'ait demandé.

import {
  aireSignee,
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
  precedent,
  sommet,
  sommetsEn,
  suivant,
  type Etat,
  type RefLimite,
  type RefSommet,
  type Sommet,
} from './etat';

export class ErreurEdition extends Error {
  override name = 'ErreurEdition';
}

/** En dessous de cet angle (degrés) entre deux limites, leur intersection n'est pas fiable. */
const ANGLE_MIN_DEG = 10;
/** Écart (m) en dessous duquel un point est considéré comme sur une droite. */
const ALIGNEMENT_M = 0.001;

interface Deplacement {
  anneau: number;
  sommet: number;
  ll: LatLon;
}

/** Point ajouté entre le sommet `v` et son voisin `w` de l'anneau, juste à côté de `v`. */
interface Ajout {
  anneau: number;
  v: number;
  w: number;
  ll: LatLon;
}

function appliquer(etat: Etat, deplacements: Deplacement[], ajouts: Ajout[]): Etat {
  const anneaux = etat.anneaux.map((a) => ({ ...a, sommets: [...a.sommets] }));
  for (const d of deplacements) {
    const a = anneaux[d.anneau]!;
    a.sommets[d.sommet] = { ...a.sommets[d.sommet]!, lat: d.ll[0], lon: d.ll[1] };
  }
  // Position d'insertion dans l'anneau d'origine ; à position égale, un point ajouté « avant w »
  // doit finir après un point ajouté « après v » : on l'insère donc en premier.
  const places = ajouts.map((aj) => {
    const n = etat.anneaux[aj.anneau]!.sommets.length;
    const apresV = aj.w === (aj.v + 1) % n;
    const position = apresV ? aj.v + 1 : aj.v === 0 ? n : aj.v;
    return { aj, position, rang: apresV ? 0 : 1 };
  });
  places.sort((p, q) => q.position - p.position || q.rang - p.rang);
  for (const { aj, position } of places) {
    const nouveau: Sommet = { lat: aj.ll[0], lon: aj.ll[1], origine: null };
    anneaux[aj.anneau]!.sommets.splice(position, 0, nouveau);
  }
  return { anneaux };
}

function xy(etat: Etat, plan: Plan, anneau: number, i: number): XY {
  return plan.versXY(latLon(sommet(etat, { anneau, sommet: i })));
}

/**
 * Décale la limite `ref` parallèlement à elle-même.
 *
 * `distance` en mètres : positif = vers l'extérieur de la parcelle de `ref`, donc vers la parcelle
 * voisine pour une limite partagée. Les deux extrémités sont recalculées à l'intersection avec les
 * limites voisines, qui gardent leur direction. Pour une limite partagée, chaque nouvelle extrémité
 * est placée sur la limite de la parcelle qui perd du terrain ; l'autre parcelle garde l'ancien
 * sommet et reçoit le nouveau en plus : le contour extérieur des deux parcelles ne bouge pas.
 */
export function decalerLimite(etat: Etat, ref: RefLimite, distance: number): Etat {
  if (distance === 0) return etat;
  const X = ref.anneau;
  const a = ref.debut;
  const b = suivant(etat, X, a);
  const jumelles = limitesJumelles(etat, ref);
  if (jumelles.length > 1)
    throw new ErreurEdition('Cette limite est commune à plus de deux parcelles.');
  const Y = jumelles[0];

  const A = latLon(sommet(etat, { anneau: X, sommet: a }));
  const B = latLon(sommet(etat, { anneau: X, sommet: b }));
  const plan = planLocal([(A[0] + B[0]) / 2, (A[1] + B[1]) / 2]);
  const pa = plan.versXY(A);
  const pb = plan.versXY(B);
  const dir: XY = [pb[0] - pa[0], pb[1] - pa[1]];
  const longueur = Math.hypot(...dir);

  // Normale vers l'extérieur de la parcelle : à droite du sens de parcours pour un anneau tourné
  // dans le sens inverse des aiguilles d'une montre. Pour une zone exclue, l'extérieur de la
  // parcelle est l'intérieur de l'anneau.
  const anneauX = etat.anneaux[X]!;
  const sensX = aireSignee(anneauX.sommets.map((s) => plan.versXY(latLon(s)))) > 0 ? 1 : -1;
  const cote = sensX * (anneauX.type === 2 ? -1 : 1);
  const normale: XY = [(dir[1] / longueur) * cote, (-dir[0] / longueur) * cote];
  const origineDroite: XY = [pa[0] + normale[0] * distance, pa[1] + normale[1] * distance];

  // Parcelle qui perd du terrain (null : la limite part vers l'extérieur, personne ne perd).
  const perdant = distance > 0 ? (Y?.anneau ?? null) : X;

  const deplacements: Deplacement[] = [];
  const ajouts: Ajout[] = [];

  for (const extremite of ['debut', 'fin'] as const) {
    const roles = [extremite === 'debut' ? { anneau: X, v: a, w: b } : { anneau: X, v: b, w: a }];
    if (Y) {
      roles.push(
        extremite === 'debut'
          ? { anneau: Y.anneau, v: Y.debut, w: Y.fin }
          : { anneau: Y.anneau, v: Y.fin, w: Y.debut },
      );
    }
    const autreVoisin = (r: { anneau: number; v: number; w: number }) =>
      suivant(etat, r.anneau, r.v) === r.w
        ? precedent(etat, r.anneau, r.v)
        : suivant(etat, r.anneau, r.v);

    const v = extremite === 'debut' ? pa : pb;
    const guide = roles.find((r) => r.anneau === perdant) ?? roles[0]!;
    const g1 = xy(etat, plan, guide.anneau, autreVoisin(guide));
    const nouveau = intersection(
      origineDroite,
      dir,
      v,
      [g1[0] - v[0], g1[1] - v[1]],
      Math.sin((ANGLE_MIN_DEG * Math.PI) / 180),
    );
    if (!nouveau) {
      throw new ErreurEdition(
        `La limite voisine est presque dans le prolongement de celle-ci (moins de ${ANGLE_MIN_DEG}°) : décalage impossible.`,
      );
    }
    if (perdant !== null && positionSurSegment(nouveau, v, g1).t >= 1) {
      throw new ErreurEdition(
        'Décalage trop grand : il dépasse le sommet suivant de la limite voisine.',
      );
    }
    const ll = plan.versLatLon(nouveau);

    const ancien = latLon(sommet(etat, { anneau: X, sommet: roles[0]!.v }));
    const autres = sommetsEn(etat, ancien).filter(
      (r) => !roles.some((ro) => ro.anneau === r.anneau),
    );

    for (const r of roles) {
      const q = xy(etat, plan, r.anneau, autreVoisin(r));
      const pos = positionSurSegment(nouveau, v, q);
      const surLaLimite = pos.ecart < ALIGNEMENT_M;
      if (surLaLimite && (pos.t > 0 || autres.length === 0)) {
        deplacements.push({ anneau: r.anneau, sommet: r.v, ll });
      } else {
        ajouts.push({ anneau: r.anneau, v: r.v, w: r.w, ll });
      }
    }
    // Parcelles qui touchent ce sommet sans contenir la limite : si le nouveau point tombe sur une
    // de leurs limites, on l'y ajoute pour que les sommets communs restent identiques.
    for (const r of autres) {
      for (const voisin of [
        suivant(etat, r.anneau, r.sommet),
        precedent(etat, r.anneau, r.sommet),
      ]) {
        const pos = positionSurSegment(nouveau, v, xy(etat, plan, r.anneau, voisin));
        if (pos.ecart < ALIGNEMENT_M && pos.t > 0 && pos.t < 1) {
          ajouts.push({ anneau: r.anneau, v: r.sommet, w: voisin, ll });
          break;
        }
      }
    }
  }
  return appliquer(etat, deplacements, ajouts);
}

/** Sens d'un déplacement positif le long d'une limite : vers l'Est si elle est plutôt orientée Est-Ouest, sinon vers le Nord. */
export function sensPositif(etat: Etat, limite: RefLimite): 'Est' | 'Nord' {
  const A = latLon(sommet(etat, { anneau: limite.anneau, sommet: limite.debut }));
  const plan = planLocal(A);
  const pb = xy(etat, plan, limite.anneau, suivant(etat, limite.anneau, limite.debut));
  return Math.abs(pb[0]) >= Math.abs(pb[1]) ? 'Est' : 'Nord';
}

/**
 * Fait glisser un sommet le long d'une des deux limites qui y aboutissent.
 *
 * `distance` en mètres : positif = vers l'Est pour une limite orientée Est-Ouest, vers le Nord pour
 * une limite orientée Nord-Sud. Le sommet bouge dans toutes les parcelles qui le contiennent.
 */
export function glisserSommet(
  etat: Etat,
  ref: RefSommet,
  limite: RefLimite,
  distance: number,
): Etat {
  if (distance === 0) return etat;
  const fin = suivant(etat, limite.anneau, limite.debut);
  if (limite.anneau !== ref.anneau || (limite.debut !== ref.sommet && fin !== ref.sommet)) {
    throw new ErreurEdition('La limite choisie ne passe pas par ce sommet.');
  }
  const autre = limite.debut === ref.sommet ? fin : limite.debut;
  const V = latLon(sommet(etat, ref));
  const plan = planLocal(V);
  const q = xy(etat, plan, ref.anneau, autre);
  const l = Math.hypot(...q);
  let u: XY = [q[0] / l, q[1] / l];
  const versEst = Math.abs(u[0]) >= Math.abs(u[1]);
  if ((versEst && u[0] < 0) || (!versEst && u[1] < 0)) u = [-u[0], -u[1]];
  const nouveau: XY = [u[0] * distance, u[1] * distance];
  if (positionSurSegment(nouveau, [0, 0], q).t >= 1) {
    throw new ErreurEdition("Déplacement trop grand : il dépasse l'autre extrémité de la limite.");
  }
  const ll = plan.versLatLon(nouveau);
  return appliquer(
    etat,
    sommetsEn(etat, V).map((r) => ({ anneau: r.anneau, sommet: r.sommet, ll })),
    [],
  );
}
