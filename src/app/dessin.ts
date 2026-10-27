// Ce qui est dessiné sur la carte.

import { anneauIgnore, latLon, type RefLimite } from '../edition/etat';
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
import {
  apercuCollage,
  apercuCoupeCourante,
  apercuFusionCourante,
  apercuSimplification,
} from './modifier';
import { directionDuSegment } from '../geometrie/passages';
import { planLocal } from '../geometrie/plan';
import { anneauxLL } from './vue';
import { apercuReprise, cheminReprise } from './reference';

export function dessin(s: Session): Dessin {
  const anneaux = anneauxLL(s);
  // Simplification ou collage : la parcelle courante est dessinée telle qu'elle serait, l'actuelle
  // en pointillés.
  // Ce qui sert à modifier (aperçus, sélections, flèches) ne s'affiche que dans les onglets
  // Modifier et Guidage : ailleurs, la carte montre seulement les parcelles (et les notes).
  const enEdition = ui.onglet === 'modifier' || ui.onglet === 'guidage';
  const collage = enEdition ? apercuCollage(s) : null;
  const reprise = enEdition && ui.repriseBord ? apercuReprise(s) : null;
  const apercu = enEdition
    ? (apercuSimplification(s) ??
      (collage && 'etat' in collage ? collage : null) ??
      (reprise && 'etat' in reprise ? reprise : null))
    : null;
  const affiches = apercu ? apercu.etat.anneaux.map((a) => a.sommets.map(latLon)) : anneaux;
  const d: Dessin = {
    reference: ui.reference?.anneaux ?? [],
    fantomes: apercu
      ? anneaux.filter((_, i) => s.etat.anneaux[i]!.parcelle === ui.parcelleCourante)
      : [],
    anneaux: affiches.flatMap((pts, i) => {
      const a = s.etat.anneaux[i]!;
      if (anneauIgnore(s.etat, i)) return [];
      return {
        pts,
        couleur: ui.couleursParEtat
          ? COULEURS_ETAT[fiche(ui.suivi, s.td.parcelles[a.parcelle]!).etat]
          : COULEURS[(s.couleurs[a.parcelle] ?? a.parcelle) % COULEURS.length]!,
        courant: a.parcelle === ui.parcelleCourante,
        nom: a.type === 1 ? s.td.parcelles[a.parcelle]!.nom : null,
      };
    }),
    traits: [],
    points: [],
  };
  // Reprise d'un bord de l'ancien fichier : point touché et chemin choisi en violet.
  if (enEdition && ui.repriseBord && ui.reference && ui.repriseBord.anneauRef !== null) {
    const pts = ui.reference.anneaux[ui.repriseBord.anneauRef]!;
    const chemin = cheminReprise();
    if (chemin)
      chemin
        .slice(1)
        .forEach((b, k) =>
          d.traits.push({ a: chemin[k]!, b, couleur: SEL, epaisseur: 4, dessus: true }),
        );
    if (ui.repriseBord.debut !== null)
      d.points.push({ p: pts[ui.repriseBord.debut]!, couleur: SEL, rayon: 8 });
  }
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
      if (k > 0)
        d.traits.push({ a: vue.points[k - 1]!, b: p, couleur: SEL, epaisseur: 7, dessus: true });
    });
    d.points.push({ p: vue.points[0]!, couleur: SEL, rayon: 8 });
    d.points.push({ p: vue.points.at(-1)!, couleur: SEL, rayon: 8 });
  }
  // Couper : le côté touché en violet, la ligne de coupe en violet plus fin, l'ancien contour.
  if (enEdition && ui.mode === 'couper' && ui.coupe && ui.coupe.parcelle === ui.parcelleCourante) {
    const X = s.etat.anneaux.findIndex(
      (a, i) => a.parcelle === ui.coupe!.parcelle && a.type === 1 && !anneauIgnore(s.etat, i),
    );
    if (X >= 0) {
      const ext = s.etat.anneaux[X]!.sommets.map(latLon);
      const plan = planLocal(ext[0]!);
      const ids = directionDuSegment(
        ext.map((p) => plan.versXY(p)),
        ui.coupe.segment,
      ).sommets;
      ids.forEach((i, k) => {
        if (k > 0) d.traits.push({ a: ext[ids[k - 1]!]!, b: ext[i]!, couleur: SEL, epaisseur: 7 });
      });
      const r = apercuCoupeCourante(s);
      if (r && 'coupe' in r) {
        d.traits.push({ a: r.coupe.ligne[0], b: r.coupe.ligne[1], couleur: SEL, epaisseur: 4 });
        d.points.push({ p: r.coupe.ligne[0], couleur: SEL, rayon: 7 });
        d.points.push({ p: r.coupe.ligne[1], couleur: SEL, rayon: 7 });
      }
    }
  }
  // Fusion : la voisine en violet, le contour fusionné en pointillés.
  if (enEdition && ui.mode === 'couper' && ui.actionCoupe === 'fusionner' && ui.fusion !== null) {
    const X = s.etat.anneaux.findIndex(
      (a, i) => a.parcelle === ui.fusion && a.type === 1 && !anneauIgnore(s.etat, i),
    );
    if (X >= 0) {
      const pts = s.etat.anneaux[X]!.sommets.map(latLon);
      pts.forEach((q, k) =>
        d.traits.push({ a: q, b: pts[(k + 1) % pts.length]!, couleur: SEL, epaisseur: 4 }),
      );
    }
    const r = apercuFusionCourante(s);
    if (r && 'contour' in r) d.fantomes = [...(d.fantomes ?? []), r.contour];
  }
  // Optimisation : passages de la proposition choisie, en traits fins sous la ligne AB.
  const optim = enEdition ? optimisationCourante(s) : null;
  const prop = optim?.proposition;
  // Côté touché : en violet, comme une limite choisie.
  const manuelle = optim?.optimisation.manuelle;
  if (optim && manuelle && ui.propositionChoisie === -1) {
    const ext = s.etat.anneaux.find((a) => a.parcelle === optim.parcelle && a.type === 1)!;
    manuelle.sommets.forEach((i, k) => {
      if (k > 0)
        d.traits.push({
          a: latLon(ext.sommets[manuelle.sommets[k - 1]!]!),
          b: latLon(ext.sommets[i]!),
          couleur: SEL,
          epaisseur: 7,
        });
    });
  }
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
          ui.porteeSuivi = 'parcelle';
          ui.message = {
            texte: `${n.parcelle} · ${n.type || 'Note'}${n.texte ? ` : ${n.texte}` : ''}`,
            erreur: false,
          };
          afficher();
        },
      }));
    // Endroit choisi pour la note en cours de saisie (sa zone en violet, si elle en a une).
    if (ui.noteEnCours?.position && !ui.noteEnCours.zone) {
      d.points.push({ p: ui.noteEnCours.position, couleur: SEL, rayon: 9 });
    }
    // Zones des notes (onglet Suivi) : celle de la note en cours de saisie à la place de la sienne.
    if (ui.onglet === 'suivi') {
      d.zones = (ui.suivi.notes ?? [])
        .filter((n) => !n.supprimee && n.zone && parCle.has(n.cle))
        .filter((n) => n.id !== ui.noteEnCours?.id)
        .map((n) => ({ pts: n.zone!, couleur: couleurNote(n.type), choisie: ui.noteVue === n.id }));
      if (ui.noteEnCours?.zone)
        d.zones.push({ pts: ui.noteEnCours.zone, couleur: SEL, choisie: true });
    }
  }
  // Zone en cours de tracé (au doigt ou en marchant), dans tous les onglets.
  if (ui.traceZone && ui.traceZone.points.length > 0) {
    (d.zones ??= []).push({ pts: ui.traceZone.points, couleur: SEL, choisie: true, enCours: true });
  }
  // Mesure en cours : trait orange entre les points touchés.
  const MESURE = '#ff6d00';
  (ui.mesure ?? []).forEach((p, k, pts) => {
    if (k > 0) d.traits.push({ a: pts[k - 1]!, b: p, couleur: MESURE, epaisseur: 4 });
    d.points.push({ p, couleur: MESURE, rayon: 6 });
  });
  // Trois points ou plus : la surface mesurée se referme (pointillés vers le premier point).
  const m = ui.mesure ?? [];
  if (m.length >= 3) d.fantomes = [...(d.fantomes ?? []), [m[m.length - 1]!, m[0]!]];
  return d;
}
