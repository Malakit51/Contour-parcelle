// Couper une parcelle en deux, parallèlement à un de ses côtés : à une distance donnée de ce côté,
// ou pour une surface donnée côté bord. Un morceau garde la parcelle (nom, tâches, lignes de
// guidage), l'autre devient une parcelle créée dans l'éditeur. La ligne de coupe devient une
// limite commune aux deux (ses deux bouts sont des sommets communs).

import { aireSignee, planLocal, type LatLon, type XY } from '../geometrie/plan';
import { directionDuSegment } from '../geometrie/passages';
import type { TaskData } from '../isoxml/lecture';
import { anneauIgnore, estSupprimee, latLon, type Etat, type Sommet } from './etat';
import { ErreurEdition } from './operations';
import { idSuivant, nouveauGuid, parcelleVirtuelle } from './parcelles-ajoutees';

export interface Coupe {
  /** Distance (m) entre le côté choisi et la ligne de coupe. */
  distance: number;
  /** Ligne de coupe (ses deux bouts sur le contour). */
  ligne: [LatLon, LatLon];
  /** Morceau côté bord et morceau de l'autre côté. */
  coteBord: LatLon[];
  autre: LatLon[];
  surfaceBord: number;
  surfaceAutre: number;
  /** Sommets du côté choisi (indices dans le contour), pour le dessiner. */
  sommetsCote: number[];
}

interface Repere {
  X: number;
  plan: ReturnType<typeof planLocal>;
  pts: XY[];
  s: (q: XY) => number;
  sommetsCote: number[];
}

function repere(etat: Etat, parcelle: number, segment: number): Repere {
  const X = etat.anneaux.findIndex(
    (a, i) => a.parcelle === parcelle && a.type === 1 && !anneauIgnore(etat, i),
  );
  if (X < 0 || estSupprimee(etat, parcelle)) throw new ErreurEdition('Parcelle introuvable.');
  const ext = etat.anneaux[X]!;
  const plan = planLocal(latLon(ext.sommets[0]!));
  const pts = ext.sommets.map((s) => plan.versXY(latLon(s)));
  const d = directionDuSegment(pts, segment);
  const l = Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]);
  const u: XY = [(d.b[0] - d.a[0]) / l, (d.b[1] - d.a[1]) / l];
  const g = aireSignee(pts) > 0 ? 1 : -1;
  const n: XY = [-u[1] * g, u[0] * g]; // vers l'intérieur
  const s = (q: XY) => (q[0] - d.a[0]) * n[0] + (q[1] - d.a[1]) * n[1];
  return { X, plan, pts, s, sommetsCote: d.sommets };
}

/** Surface (m²) de la partie de la parcelle à moins de `d` du côté (découpe par demi-plan). */
function surfaceCoteBord(pts: XY[], s: (q: XY) => number, d: number): number {
  const garde: XY[] = [];
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k]!;
    const q = pts[(k + 1) % pts.length]!;
    const sp = s(p) - d;
    const sq = s(q) - d;
    if (sp <= 0) garde.push(p);
    if (sp < 0 !== sq < 0 && sp !== sq) {
      const t = sp / (sp - sq);
      garde.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return garde.length >= 3 ? Math.abs(aireSignee(garde)) : 0;
}

/** Les deux morceaux, si la ligne coupe le contour en exactement deux points. */
function decouper(r: Repere, d: number) {
  const { pts, s } = r;
  const n = pts.length;
  const coupes: { k: number; p: XY }[] = [];
  for (let k = 0; k < n; k++) {
    const p = pts[k]!;
    const q = pts[(k + 1) % n]!;
    const sp = s(p) - d;
    const sq = s(q) - d;
    if (sp < 0 !== sq < 0) {
      const t = sp / (sp - sq);
      coupes.push({ k, p: [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t] });
    }
  }
  if (coupes.length !== 2) {
    throw new ErreurEdition(
      coupes.length === 0
        ? 'La ligne de coupe ne traverse pas la parcelle : distance trop grande.'
        : 'La ligne de coupe traverse la parcelle plusieurs fois (forme en creux) : choisis un autre côté ou une autre distance.',
    );
  }
  const [c1, c2] = coupes as [{ k: number; p: XY }, { k: number; p: XY }];
  // Morceau 1 : c1, sommets c1.k+1 … c2.k, c2 ; morceau 2 : c2, sommets c2.k+1 … c1.k, c1.
  const m1: number[] = [];
  for (let k = c1.k + 1; k <= c2.k; k++) m1.push(k);
  const m2: number[] = [];
  for (let k = (c2.k + 1) % n; k !== (c1.k + 1) % n; k = (k + 1) % n) m2.push(k);
  const premierBord = s(pts[m1[0]!]!) < d;
  return {
    c1,
    c2,
    bord: premierBord ? { ids: m1, debut: c1, fin: c2 } : { ids: m2, debut: c2, fin: c1 },
    autre: premierBord ? { ids: m2, debut: c2, fin: c1 } : { ids: m1, debut: c1, fin: c2 },
  };
}

/**
 * Aperçu de la coupe de `parcelle` parallèlement au côté qui contient le segment `segment` du
 * contour : à `distance` m de ce côté, ou pour une surface `surface` (m²) côté bord.
 */
export function apercuCoupe(
  etat: Etat,
  parcelle: number,
  segment: number,
  voulu: { distance: number } | { surface: number },
): Coupe {
  const r = repere(etat, parcelle, segment);
  const total = Math.abs(aireSignee(r.pts));
  let d: number;
  if ('distance' in voulu) {
    d = voulu.distance;
  } else {
    if (voulu.surface <= 0 || voulu.surface >= total) {
      throw new ErreurEdition(
        'La surface demandée doit être plus petite que celle de la parcelle.',
      );
    }
    let [bas, haut] = [Math.min(...r.pts.map(r.s)), Math.max(...r.pts.map(r.s))];
    for (let i = 0; i < 60; i++) {
      const milieu = (bas + haut) / 2;
      if (surfaceCoteBord(r.pts, r.s, milieu) < voulu.surface) bas = milieu;
      else haut = milieu;
    }
    d = (bas + haut) / 2;
  }
  if (!(d > 0)) throw new ErreurEdition('Tape une distance plus grande que 0.');
  const morceaux = decouper(r, d);
  const ll = (q: XY): LatLon => r.plan.versLatLon(q);
  const piece = (m: { ids: number[]; debut: { p: XY }; fin: { p: XY } }) => [
    ll(m.debut.p),
    ...m.ids.map((k) => ll(r.pts[k]!)),
    ll(m.fin.p),
  ];
  const aire = (m: { ids: number[]; debut: { p: XY }; fin: { p: XY } }) =>
    Math.abs(aireSignee([m.debut.p, ...m.ids.map((k) => r.pts[k]!), m.fin.p]));
  return {
    distance: d,
    ligne: [ll(morceaux.c1.p), ll(morceaux.c2.p)],
    coteBord: piece(morceaux.bord),
    autre: piece(morceaux.autre),
    surfaceBord: aire(morceaux.bord),
    surfaceAutre: aire(morceaux.autre),
    sommetsCote: r.sommetsCote,
  };
}

/**
 * Coupe la parcelle à `distance` m du côté choisi. `garder` : le morceau qui reste la parcelle
 * (avec son nom, ses tâches et ses lignes de guidage) ; l'autre devient la parcelle `nom`. Les
 * zones exclues suivent leur morceau ; refusé si la ligne en traverse une.
 */
export function couperParcelle(
  td: TaskData,
  etat: Etat,
  parcelle: number,
  segment: number,
  distance: number,
  garder: 'bord' | 'autre',
  nom: string,
  guid = nouveauGuid(),
): { etat: Etat; nouvelle: number } {
  const nomPropre = nom.trim().replace(/\s+/g, ' ');
  if (!nomPropre) throw new ErreurEdition('Donne un nom à la nouvelle parcelle.');
  if (
    td.parcelles.some(
      (p, i) => !estSupprimee(etat, i) && p.nom.toLowerCase() === nomPropre.toLowerCase(),
    )
  ) {
    throw new ErreurEdition(`Une parcelle s’appelle déjà « ${nomPropre} ».`);
  }
  const r = repere(etat, parcelle, segment);
  if (!(distance > 0)) throw new ErreurEdition('Tape une distance plus grande que 0.');
  const m = decouper(r, distance);
  const ext = etat.anneaux[r.X]!;
  const garde = garder === 'bord' ? m.bord : m.autre;
  const part = garder === 'bord' ? m.autre : m.bord;
  const nouveau = (q: XY): Sommet => {
    const [lat, lon] = r.plan.versLatLon(q);
    return { lat, lon, origine: null };
  };
  // Morceau gardé : ses sommets du fichier (avec leur ligne), les deux bouts de la coupe ajoutés.
  const debut = nouveau(garde.debut.p);
  const fin = nouveau(garde.fin.p);
  let seq: { s: Sommet; src: number | null }[] = [
    { s: debut, src: null },
    ...garde.ids.map((k) => ({ s: ext.sommets[k]!, src: k })),
    { s: fin, src: null },
  ];
  // Le premier point du fichier (ligne « start ») reste en tête ; s'il part avec l'autre morceau,
  // le premier point du morceau gardé prend sa ligne.
  const tete = seq.findIndex((e) => e.src === 0);
  if (tete >= 0) {
    seq = [...seq.slice(tete), ...seq.slice(0, tete)];
  } else if (ext.sommets[0]!.origine) {
    seq[0] = { ...seq[0]!, s: { ...seq[0]!.s, origine: ext.sommets[0]!.origine } };
  }
  // Morceau qui part : nouvelle parcelle, mêmes coordonnées pour les bouts de la coupe.
  const sommetsPart: Sommet[] = [
    { lat: fin.lat, lon: fin.lon, origine: null },
    ...part.ids.map((k) => ({ lat: ext.sommets[k]!.lat, lon: ext.sommets[k]!.lon, origine: null })),
    { lat: debut.lat, lon: debut.lon, origine: null },
  ];
  // Zones exclues : chacune suit son morceau ; une zone coupée par la ligne est refusée.
  const nouvelle = td.parcelles.length;
  const anneaux = [...etat.anneaux];
  const zonesRetirees = [...(etat.zonesRetirees ?? [])];
  const anneauxPart: (typeof anneaux)[number][] = [];
  const retirer: number[] = [];
  for (const [i, a] of etat.anneaux.entries()) {
    if (a.parcelle !== parcelle || a.type !== 2 || anneauIgnore(etat, i)) continue;
    const cotes = a.sommets.map((x) => r.s(r.plan.versXY(latLon(x))) < distance);
    if (cotes.some((c) => c !== cotes[0])) {
      throw new ErreurEdition('La ligne de coupe traverse une zone exclue : change la distance.');
    }
    const cotePart = (cotes[0] ? 'bord' : 'autre') !== garder;
    if (!cotePart) continue;
    anneauxPart.push({
      parcelle: nouvelle,
      anneau: -1,
      type: 2,
      nbOrigine: 0,
      sommets: a.sommets.map((x) => ({ lat: x.lat, lon: x.lon, origine: null })),
    });
    if (a.anneau >= 0) zonesRetirees.push(i);
    else retirer.push(i);
  }
  const modele =
    etat.ajoutees?.find((a) => a.parcelle === parcelle)?.modele ??
    (td.parcelles[parcelle]!.ajoutee ? 0 : parcelle);
  const ajoutee = { parcelle: nouvelle, id: idSuivant(td), guid, nom: nomPropre, modele };
  td.parcelles.push(parcelleVirtuelle(ajoutee));
  anneaux[r.X] = { ...ext, sommets: seq.map((e) => e.s) };
  return {
    nouvelle,
    etat: {
      ...etat,
      anneaux: [
        ...anneaux.filter((_, i) => !retirer.includes(i)),
        { parcelle: nouvelle, anneau: -1, type: 1, nbOrigine: 0, sommets: sommetsPart },
        ...anneauxPart,
      ],
      ...(zonesRetirees.length ? { zonesRetirees: zonesRetirees.sort((a, b) => a - b) } : {}),
      ajoutees: [...(etat.ajoutees ?? []), ajoutee],
    },
  };
}
