// Lignes de guidage tirées des contours : une ligne sur un bord choisi, ou une par côté d'une
// parcelle (coins détectés par un seuil d'angle). Calculs purs, sans interface.

import { coins, cotesEntreCoins, courbeDecalee, estDroit, ligneAB } from '../geometrie/guidage';
import { aireSignee, planLocal, pointDansPolygone, type LatLon, type XY } from '../geometrie/plan';
import { latLon, type Etat, type Guidage } from './etat';
import { sommetsDuBord, type Bord } from './operations';

/** Côtés plus courts que ça : pas de ligne (décrochements, coins coupés). */
export const COTE_MIN_M = 20;
/** Écart maximal (m) des points d'un côté à sa droite moyenne pour en faire une droite AB. */
export const TOLERANCE_DROIT_M = 0.5;

export interface ReglagesGuidage {
  /** Décalage par rapport au bord, en mètres (valeur absolue). */
  distance: number;
  /** Décalage vers l'intérieur de la parcelle (sinon vers l'extérieur). */
  interieur: boolean;
  /** Angle (degrés) à partir duquel un sommet est un coin. */
  seuil: number;
  /** Nom du jeu de lignes : « Semoir 4 m » donne « Semoir 4 m 1 », « Semoir 4 m 2 »… */
  base: string;
}

export interface LignesParcelle {
  coins: LatLon[];
  lignes: Guidage[];
  /** Côtés trop courts, sans ligne. */
  ignores: number;
}

/** Nom du jeu d'une ligne : « Semoir 4 m 3 » → « Semoir 4 m » (le nom entier s'il n'est pas numéroté). */
export const jeuDe = (nom: string) => /^(.*\S) \d+$/.exec(nom)?.[1] ?? nom;

/** Noms des jeux de lignes présents, dans l'ordre de leur première ligne. */
export const jeux = (lignes: readonly Guidage[]) => [...new Set(lignes.map((g) => jeuDe(g.nom)))];

/** Vrai si la ligne fait partie du jeu « base » (« base 1 », « base 2 »…). */
export const duJeu = (g: Guidage, base: string) =>
  g.nom.startsWith(`${base} `) && /^\d+$/.test(g.nom.slice(base.length + 1));

/** Numéro suivant du jeu « base » sur la parcelle `p`. */
export function numeroSuivant(etat: Etat, p: number, base: string): number {
  const numeros = (etat.guidages ?? [])
    .filter((g) => g.parcelle === p && duJeu(g, base))
    .map((g) => Number(g.nom.slice(base.length + 1)));
  return Math.max(0, ...numeros) + 1;
}

/**
 * Une ligne par côté du contour extérieur de la parcelle `p` : coins au seuil réglé, côtés d'au
 * moins COTE_MIN_M mètres, droite AB si le côté est droit, sinon courbe.
 */
export function lignesDeParcelle(etat: Etat, p: number, r: ReglagesGuidage): LignesParcelle | null {
  const a = etat.anneaux.find((x) => x.parcelle === p && x.type === 1);
  if (!a) return null;
  const plan = planLocal(latLon(a.sommets[0]!));
  const pts = a.sommets.map((x) => plan.versXY(latLon(x)));
  const trouves = coins(pts, r.seuil);
  // Décalage compté à gauche du sens de l'anneau : la gauche est l'intérieur s'il tourne dans le
  // sens inverse des aiguilles d'une montre.
  const decalage = r.distance * (aireSignee(pts) > 0 ? 1 : -1) * (r.interieur ? 1 : -1);
  const lignes: Guidage[] = [];
  let ignores = 0;
  for (const ids of cotesEntreCoins(pts.length, trouves)) {
    const cote = ids.map((i) => pts[i]!);
    let longueur = 0;
    for (let k = 1; k < cote.length; k++) {
      longueur += Math.hypot(cote[k]![0] - cote[k - 1]![0], cote[k]![1] - cote[k - 1]![1]);
    }
    if (longueur < COTE_MIN_M) {
      ignores++;
      continue;
    }
    const type = estDroit(cote, TOLERANCE_DROIT_M) ? 'ab' : 'courbe';
    const xy = type === 'ab' ? ligneAB(cote, decalage) : courbeDecalee(cote, decalage);
    lignes.push({
      parcelle: a.parcelle,
      type,
      nom: `${r.base} ${lignes.length + 1}`,
      points: xy.map((q) => plan.versLatLon(q)),
    });
  }
  return { coins: trouves.map((c) => latLon(a.sommets[c.sommet]!)), lignes, ignores };
}

/** Parcelle à contrôler : pas exactement 4 coins, ou un petit côté sans ligne. */
export const aControler = (r: LignesParcelle) => r.coins.length !== 4 || r.ignores > 0;

/** Ligne (droite AB ou courbe) sur un bord choisi, numérotée à la suite du jeu « base ». */
export function ligneSurBord(
  etat: Etat,
  bord: Bord,
  type: 'ab' | 'courbe',
  r: ReglagesGuidage,
): Guidage {
  const a = etat.anneaux[bord.anneau]!;
  const ids = sommetsDuBord(etat, bord);
  const plan = planLocal(latLon(a.sommets[ids[0]!]!));
  const pts = ids.map((i) => plan.versXY(latLon(a.sommets[i]!)));
  // Côté intérieur : celui où un point décalé de 1 m depuis le milieu du bord tombe dans l'anneau
  // (pour une zone exclue, l'intérieur de la parcelle est hors de l'anneau).
  const [m1, m2] = ligneAB(pts.length > 1 ? pts : [pts[0]!, pts[0]!], 1);
  const essai: XY = [(m1[0] + m2[0]) / 2, (m1[1] + m2[1]) / 2];
  const dansAnneau = pointDansPolygone(
    essai,
    a.sommets.map((x) => plan.versXY(latLon(x))),
  );
  const gaucheInterieur = a.type === 1 ? dansAnneau : !dansAnneau;
  const decalage = r.distance * (gaucheInterieur ? 1 : -1) * (r.interieur ? 1 : -1);
  const xy = type === 'ab' ? ligneAB(pts, decalage) : courbeDecalee(pts, decalage);
  return {
    parcelle: a.parcelle,
    type,
    nom: `${r.base} ${numeroSuivant(etat, a.parcelle, r.base)}`,
    points: xy.map((q) => plan.versLatLon(q)),
  };
}

/**
 * Ajoute des lignes à l'état. Avec `remplacerJeu`, les lignes de ce jeu déjà présentes sur les
 * parcelles concernées sont d'abord retirées (pas de doublons quand on regénère).
 */
export function ajouterGuidages(
  etat: Etat,
  lignes: readonly Guidage[],
  remplacerJeu: string | null,
): Etat {
  const touchees = new Set(lignes.map((g) => g.parcelle));
  const gardees = (etat.guidages ?? []).filter(
    (g) => remplacerJeu === null || !touchees.has(g.parcelle) || !duJeu(g, remplacerJeu),
  );
  return { ...etat, guidages: [...gardees, ...lignes] };
}

/**
 * Retire toutes les lignes de la parcelle `p`, ou de toutes les parcelles si `p` est null.
 * Rend le même état s'il n'y a rien à retirer (pas de modification au journal).
 */
export function retirerGuidages(etat: Etat, p: number | null): Etat {
  const avant = etat.guidages ?? [];
  const gardees = p === null ? [] : avant.filter((g) => g.parcelle !== p);
  return gardees.length === avant.length ? etat : { ...etat, guidages: gardees };
}
