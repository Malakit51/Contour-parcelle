// Nettoyage d'un état après une modification : points en double et sommets communs décollés.
//
// Un décalage de limite aller-retour peut laisser deux sommets au même endroit (à quelques
// micromètres près), et un sommet commun avec un voisin peut s'en écarter d'un rien par les
// conversions de coordonnées. Dans le fichier, deux points au même endroit font une limite de
// longueur nulle : la console Claas ne reconnaît alors plus le coin comme une borne (constaté le
// 14/10/2026 sur 130usag).

import { distanceM, latLon, type Etat, type Sommet } from './etat';

/** Deux sommets consécutifs plus proches que ça sont fusionnés. */
export const DOUBLON_M = 0.01;
/** Un sommet aussi proche d'un sommet d'une autre parcelle prend exactement ses coordonnées. */
export const RECOLLAGE_M = 0.001;

export interface Nettoyage {
  etat: Etat;
  /** Nombre de points en double retirés, par parcelle. */
  doublons: Map<number, number>;
  /** Nombre de sommets recollés sur le sommet commun d'un voisin. */
  recolles: number;
}

const memePosition = (a: Sommet, b: Sommet) => a.lat === b.lat && a.lon === b.lon;
/** Sommet resté à la position qu'il a dans le fichier. */
const intact = (s: Sommet) => !!s.origine && s.lat === s.origine.lat && s.lon === s.origine.lon;

export function nettoyer(etat: Etat): Nettoyage {
  const anneaux = etat.anneaux.map((a) => ({ ...a, sommets: [...a.sommets] }));
  const doublons = new Map<number, number>();
  let recolles = 0;

  // 1. Sommets presque confondus avec un sommet d'une autre parcelle : on les recolle. On garde
  //    la position du sommet resté tel que dans le fichier, s'il y en a un.
  const pres = (u: Sommet, t: Sommet) =>
    Math.abs(u.lat - t.lat) < 1e-7 &&
    Math.abs(u.lon - t.lon) < 1e-7 &&
    !memePosition(u, t) &&
    distanceM(latLon(u), latLon(t)) <= RECOLLAGE_M;
  for (const a of anneaux) {
    for (let is = 0; is < a.sommets.length; is++) {
      for (const b of anneaux) {
        if (b.parcelle === a.parcelle) continue;
        for (let it = 0; it < b.sommets.length; it++) {
          const u = a.sommets[is]!;
          const t = b.sommets[it]!;
          if ((intact(u) && intact(t)) || !pres(u, t)) continue;
          if (intact(u)) b.sommets[it] = { ...t, lat: u.lat, lon: u.lon };
          else a.sommets[is] = { ...u, lat: t.lat, lon: t.lon };
          recolles++;
        }
      }
    }
  }

  // 2. Sommets consécutifs presque confondus : on n'en garde qu'un. Le premier sommet de l'anneau
  //    (ligne « start » du fichier) reste toujours en tête.
  for (const a of anneaux) {
    let i = 0;
    while (a.sommets.length > 3 && i < a.sommets.length) {
      const n = a.sommets.length;
      const j = (i + 1) % n;
      const u = a.sommets[i]!;
      const v = a.sommets[j]!;
      if (distanceM(latLon(u), latLon(v)) >= DOUBLON_M) {
        i++;
        continue;
      }
      // Position gardée : celle qui est commune avec un voisin, sinon celle du fichier, sinon u.
      const commun = (s: Sommet) =>
        anneaux.some((b) => b.parcelle !== a.parcelle && b.sommets.some((t) => memePosition(s, t)));
      const garde = [u, v].find(commun) ?? [u, v].find(intact) ?? u;
      // Sommet retiré : jamais le premier ; sinon celui qui n'a pas de point dans le fichier.
      const retire = j === 0 ? i : i === 0 ? j : !v.origine ? j : !u.origine ? i : j;
      const reste = retire === i ? j : i;
      a.sommets[reste] = { ...a.sommets[reste]!, lat: garde.lat, lon: garde.lon };
      a.sommets.splice(retire, 1);
      doublons.set(a.parcelle, (doublons.get(a.parcelle) ?? 0) + 1);
      if (retire < i) i--;
    }
  }

  const change = recolles > 0 || doublons.size > 0;
  return { etat: change ? { anneaux } : etat, doublons, recolles };
}
