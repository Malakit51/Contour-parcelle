// Ce qui est dessiné sur la carte.

import { latLon, type RefLimite } from '../edition/etat';
import { jeuDe } from '../edition/guidages';
import { cotesLimite, repereLeLong, sommetsDuBord } from '../edition/operations';
import { cleParcelle, fiche } from '../suivi/suivi';
import { type Dessin } from '../ui/carte';
import {
  choixDeBord,
  COULEURS,
  COULEURS_ETAT,
  couleurNote,
  ongletDuMode,
  SEL,
  type Session,
  ui,
} from './etat';
import { apercuGuidages, coinsGuidage, optimisationCourante } from './guidage';
import { afficher } from './mise-en-page';
import { apercuCollage, apercuSimplification } from './modifier';
import { anneauxLL } from './vue';

export function dessin(s: Session): Dessin {
  const anneaux = anneauxLL(s);
  // Simplification ou collage : la parcelle courante est dessinée telle qu'elle serait, l'actuelle
  // en pointillés.
  // Ce qui sert à modifier (aperçus, sélections, flèches) ne s'affiche que dans les onglets
  // Modifier et Guidage : ailleurs, la carte montre seulement les parcelles (et les notes).
  const enEdition = ui.onglet === 'modifier' || ui.onglet === 'guidage';
  const collage = enEdition ? apercuCollage(s) : null;
  const apercu = enEdition
    ? (apercuSimplification(s) ?? (collage && 'etat' in collage ? collage : null))
    : null;
  const affiches = apercu ? apercu.etat.anneaux.map((a) => a.sommets.map(latLon)) : anneaux;
  const d: Dessin = {
    reference: ui.reference?.anneaux ?? [],
    fantomes: apercu
      ? anneaux.filter((_, i) => s.etat.anneaux[i]!.parcelle === ui.parcelleCourante)
      : [],
    anneaux: affiches.flatMap((pts, i) => {
      const a = s.etat.anneaux[i]!;
      if (s.etat.supprimees?.includes(a.parcelle)) return [];
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
  // Parcelle modèle du collage : son contour en violet fin.
  if (enEdition && ui.mode === 'coller' && ui.modele !== null) {
    const pts = anneaux[ui.modele]!;
    pts.forEach((a, k) =>
      d.traits.push({ a, b: pts[(k + 1) % pts.length]!, couleur: SEL, epaisseur: 2 }),
    );
  }
  const trait = (ref: RefLimite, epaisseur: number) => {
    const pts = anneaux[ref.anneau]!;
    d.traits.push({
      a: pts[ref.debut]!,
      b: pts[(ref.debut + 1) % pts.length]!,
      couleur: SEL,
      epaisseur,
    });
  };
  if (enEdition && choixDeBord() && (ui.bord || ui.bordDebut)) {
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
    ...(!enEdition || ui.porteeGuidage === 'toutes' ? [] : apercuGuidages(s)).map((g) => ({
      pts: [...g.points],
      apercu: true,
    })),
  ];
  if (enEdition) {
    for (const c of coinsGuidage(s)?.coins ?? []) d.points.push({ p: c, couleur: SEL, rayon: 7 });
  }
  if (enEdition && ui.selLimite) {
    trait(ui.selLimite, 7);
    const ref = ui.selLimite;
    const c = cotesLimite(s.etat, ref);
    d.fleches = (['exterieur', 'interieur'] as const).map((sens) => ({
      depuis: c.milieu,
      vers: c[sens],
      choisie: ui.sensLimite === sens,
      action: () => {
        ui.sensLimite = sens;
        ui.onglet = ongletDuMode();
        afficher();
      },
    }));
  }
  if (enEdition && ui.selSommet) {
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
  // Ligne de guidage touchée dans la liste : en violet épais, ses deux bouts marqués.
  const vue =
    ui.onglet === 'guidage' && ui.ligneVue
      ? (s.etat.guidages ?? []).find(
          (g) => g.parcelle === ui.ligneVue!.parcelle && g.nom === ui.ligneVue!.nom,
        )
      : undefined;
  if (vue && vue.points.length > 1) {
    vue.points.forEach((p, k) => {
      if (k > 0) d.traits.push({ a: vue.points[k - 1]!, b: p, couleur: SEL, epaisseur: 7 });
    });
    d.points.push({ p: vue.points[0]!, couleur: SEL, rayon: 8 });
    d.points.push({ p: vue.points.at(-1)!, couleur: SEL, rayon: 8 });
  }
  // Optimisation : passages de la proposition choisie, en traits fins sous la ligne AB.
  const optim = enEdition ? optimisationCourante(s) : null;
  const prop = optim?.optimisation.propositions[ui.propositionChoisie];
  if (optim && prop) {
    for (const [a, b] of prop.lignes) {
      d.traits.push({
        a: optim.optimisation.plan.versLatLon(a),
        b: optim.optimisation.plan.versLatLon(b),
        couleur: '#ffd600',
        epaisseur: 2,
      });
    }
  }
  // Notes de toutes les parcelles, dans l'onglet Suivi (épingles de la couleur de leur type), et
  // pendant l'optimisation du guidage (pour voir où tombent les obstacles).
  if (ui.onglet === 'suivi' || optim) {
    const parCle = new Map(s.td.parcelles.map((p, i) => [cleParcelle(p), i]));
    d.notes = (ui.suivi.notes ?? [])
      .filter((n) => !n.supprimee && n.position && parCle.has(n.cle))
      .map((n) => ({
        p: n.position!,
        couleur: couleurNote(n.type),
        lettre: (n.type || n.texte || '?').trim().charAt(0).toUpperCase(),
        titre: `${n.type || n.texte} · ${n.parcelle}`,
        choisie: ui.noteVue === n.id,
        obstacle: !!n.obstacle,
        action: () => {
          ui.noteVue = n.id;
          ui.parcelleCourante = parCle.get(n.cle)!;
          ui.message = {
            texte: `${n.parcelle} · ${n.type || 'Note'}${n.texte ? ` : ${n.texte}` : ''}`,
            erreur: false,
          };
          afficher();
        },
      }));
    // Endroit choisi pour la note en cours de saisie.
    if (ui.noteEnCours?.position) {
      d.points.push({ p: ui.noteEnCours.position, couleur: SEL, rayon: 9 });
    }
  }
  // Mesure en cours : trait orange entre les points touchés.
  const MESURE = '#ff6d00';
  (ui.mesure ?? []).forEach((p, k, pts) => {
    if (k > 0) d.traits.push({ a: pts[k - 1]!, b: p, couleur: MESURE, epaisseur: 4 });
    d.points.push({ p, couleur: MESURE, rayon: 6 });
  });
  return d;
}
