// Ce qui est dessiné sur la carte.

import { latLon, type RefLimite } from '../edition/etat';
import { jeuDe } from '../edition/guidages';
import { cotesLimite, repereLeLong, sommetsDuBord } from '../edition/operations';
import { fiche } from '../suivi/suivi';
import { type Dessin } from '../ui/carte';
import { choixDeBord, COULEURS, COULEURS_ETAT, SEL, type Session, ui } from './etat';
import { apercuGuidages, coinsGuidage } from './guidage';
import { afficher } from './mise-en-page';
import { apercuSimplification } from './modifier';
import { anneauxLL } from './vue';

export function dessin(s: Session): Dessin {
  const anneaux = anneauxLL(s);
  // Simplification : la parcelle courante est dessinée telle qu'elle serait, l'actuelle en pointillés.
  const apercu = apercuSimplification(s);
  const affiches = apercu ? apercu.etat.anneaux.map((a) => a.sommets.map(latLon)) : anneaux;
  const d: Dessin = {
    reference: ui.reference?.anneaux ?? [],
    fantomes: apercu
      ? anneaux.filter((_, i) => s.etat.anneaux[i]!.parcelle === ui.parcelleCourante)
      : [],
    anneaux: affiches.map((pts, i) => {
      const a = s.etat.anneaux[i]!;
      return {
        pts,
        couleur: ui.couleursParEtat
          ? COULEURS_ETAT[fiche(ui.suivi, s.td.parcelles[a.parcelle]!).etat]
          : COULEURS[s.couleurs[a.parcelle]! % COULEURS.length]!,
        courant: a.parcelle === ui.parcelleCourante,
        nom: a.type === 1 ? s.td.parcelles[a.parcelle]!.nom : null,
      };
    }),
    traits: [],
    points: [],
  };
  const trait = (ref: RefLimite, epaisseur: number) => {
    const pts = anneaux[ref.anneau]!;
    d.traits.push({
      a: pts[ref.debut]!,
      b: pts[(ref.debut + 1) % pts.length]!,
      couleur: SEL,
      epaisseur,
    });
  };
  if (choixDeBord() && (ui.bord || ui.bordDebut)) {
    const ring = (ui.bord ?? ui.bordDebut)!.anneau;
    const pts = anneaux[ring]!;
    if (ui.bord) {
      const ids = sommetsDuBord(s.etat, ui.bord);
      for (let k = 1; k < ids.length; k++) {
        d.traits.push({ a: pts[ids[k - 1]!]!, b: pts[ids[k]!]!, couleur: SEL, epaisseur: 6 });
      }
    }
    const debut = ui.bord ? ui.bord.debut : ui.bordDebut!.sommet;
    d.points.push({ p: pts[debut]!, couleur: SEL, rayon: 8 });
    if (ui.bord) d.points.push({ p: pts[ui.bord.fin]!, couleur: SEL, rayon: 8 });
  }
  d.guidages = [
    ...(s.etat.guidages ?? [])
      .filter((g) => !ui.jeuxMasques.has(jeuDe(g.nom)))
      .map((g) => ({ pts: [...g.points], apercu: false })),
    ...(ui.porteeGuidage === 'toutes' ? [] : apercuGuidages(s)).map((g) => ({
      pts: [...g.points],
      apercu: true,
    })),
  ];
  for (const c of coinsGuidage(s)?.coins ?? []) d.points.push({ p: c, couleur: SEL, rayon: 7 });
  if (ui.selLimite) {
    trait(ui.selLimite, 7);
    const ref = ui.selLimite;
    const c = cotesLimite(s.etat, ref);
    d.fleches = (['exterieur', 'interieur'] as const).map((sens) => ({
      depuis: c.milieu,
      vers: c[sens],
      choisie: ui.sensLimite === sens,
      action: () => {
        ui.sensLimite = sens;
        ui.onglet = 'modifier';
        afficher();
      },
    }));
  }
  if (ui.selSommet) {
    if (ui.limiteGlisse) {
      trait(ui.limiteGlisse, 5);
      const ref = ui.selSommet;
      const limite = ui.limiteGlisse;
      d.fleches = (['vers', 'oppose'] as const).map((sens) => ({
        depuis: latLon(s.etat.anneaux[ref.anneau]!.sommets[ref.sommet]!),
        vers: repereLeLong(s.etat, ref, limite, sens === 'vers'),
        choisie: ui.sensGlisse === sens,
        action: () => {
          ui.sensGlisse = sens;
          afficher();
        },
      }));
    }
    d.points.push({
      p: anneaux[ui.selSommet.anneau]![ui.selSommet.sommet]!,
      couleur: SEL,
      rayon: 9,
    });
  }
  // Mesure en cours : trait orange entre les points touchés.
  const MESURE = '#ff6d00';
  (ui.mesure ?? []).forEach((p, k, pts) => {
    if (k > 0) d.traits.push({ a: pts[k - 1]!, b: p, couleur: MESURE, epaisseur: 4 });
    d.points.push({ p, couleur: MESURE, rayon: 6 });
  });
  return d;
}
