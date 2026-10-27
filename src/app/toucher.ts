// Toucher sur la carte : sélection de limite, de sommet, de bord ; placement au doigt.

import { modeleLePlusProche } from '../edition/collage';
import { precedent } from '../edition/etat';
import { ajouterPoint, bordLePlusCourt, placerSommet } from '../edition/operations';
import {
  distancePointSegment,
  type LatLon,
  pointDansPolygone,
  positionSurSegment,
  type XY,
} from '../geometrie/plan';
import { type VersEcran } from '../ui/carte';
import { choixDeBord, RAYON_TOUCHER_PX, ui, ongletDuMode } from './etat';
import { afficher } from './mise-en-page';
import { toucherReprise } from './reference';
import { effacerSelection, enregistrerModification, modifier } from './travail';
import { anneauxLL, nomParcelle, pointSousLeDoigt } from './vue';

// ---------- Sélection au doigt ----------

export function toucher(
  ecran: { x: number; y: number },
  versEcran: VersEcran,
  position: LatLon,
): void {
  if (!ui.session) return;
  const s = ui.session;
  // Coin de la zone d'une note, posé au doigt.
  if (ui.traceZone?.mode === 'points') {
    ui.traceZone = { ...ui.traceZone, points: [...ui.traceZone.points, position] };
    afficher();
    return;
  }
  // Endroit d'une note en cours de saisie.
  if (ui.placementNote && ui.noteEnCours) {
    ui.noteEnCours.position = [position[0], position[1]];
    ui.noteEnCours.zone = null;
    ui.placementNote = false;
    ui.message = { texte: 'Endroit noté.', erreur: false };
    afficher();
    return;
  }
  if (ui.mesure !== null) {
    // Un sommet ou un point de référence sous le doigt attire le point de mesure.
    const aimant = pointSousLeDoigt(
      [...anneauxLL(s).flat(), ...(ui.reference?.anneaux.flat() ?? [])],
      ecran,
      versEcran,
    );
    ui.mesure = [...ui.mesure, aimant ?? position];
    afficher();
    return;
  }
  // Reprise d'un bord de l'ancien fichier : on touche ses points gris.
  if (ui.repriseBord && ui.onglet === 'modifier') {
    toucherReprise(ecran, versEcran);
    return;
  }
  // Onglets Suivi, Export, Fichier : un toucher choisit seulement la parcelle (sur sa limite ou à
  // l'intérieur), sans renvoyer vers Modifier ni sélectionner de limite ou de sommet.
  if (ui.onglet !== 'modifier' && ui.onglet !== 'guidage') {
    const p: XY = [ecran.x, ecran.y];
    const anneaux = anneauxLL(s).map((pts) =>
      pts.map((ll): XY => {
        const e = versEcran(ll);
        return [e.x, e.y];
      }),
    );
    let proche: { anneau: number; d: number } | null = null;
    anneaux.forEach((pts, i) => {
      pts.forEach((q, k) => {
        const d = distancePointSegment(p, q, pts[(k + 1) % pts.length]!);
        if (d <= RAYON_TOUCHER_PX && (!proche || d < proche.d)) proche = { anneau: i, d };
      });
    });
    const i =
      (proche as { anneau: number } | null)?.anneau ??
      anneaux.findIndex((pts, j) => s.etat.anneaux[j]!.type === 1 && pointDansPolygone(p, pts));
    if (i >= 0) {
      ui.parcelleCourante = s.etat.anneaux[i]!.parcelle;
      ui.porteeSuivi = 'parcelle';
    }
    afficher();
    return;
  }
  if (ui.mode === 'sommet' && ui.selSommet && ui.placerAuDoigt) {
    const ref = ui.selSommet;
    ui.placerAuDoigt = false;
    // Toucher près d'un point de l'ancien fichier : le point s'y colle exactement.
    const aimant = pointSousLeDoigt(ui.reference?.anneaux.flat() ?? [], ecran, versEcran);
    modifier(
      () => placerSommet(s.etat, ref, aimant ?? position),
      aimant
        ? `Point de ${nomParcelle(s, ref.anneau)} placé exactement sur le point de ${ui.reference!.nom}`
        : `Point de ${nomParcelle(s, ref.anneau)} placé au doigt`,
      true,
    );
    return;
  }
  // Tout se mesure en pixels à l'écran : la cible a la même taille quel que soit le zoom.
  const p: XY = [ecran.x, ecran.y];
  const rayon = RAYON_TOUCHER_PX;
  const anneaux = anneauxLL(s).map((pts) =>
    pts.map((ll): XY => {
      const e = versEcran(ll);
      return [e.x, e.y];
    }),
  );
  // La parcelle courante passe en premier : en cas d'égalité (limite partagée), c'est elle qui gagne.
  const ordre = anneaux
    .map((_, i) => i)
    .sort(
      (i, j) =>
        Number(s.etat.anneaux[j]!.parcelle === ui.parcelleCourante) -
        Number(s.etat.anneaux[i]!.parcelle === ui.parcelleCourante),
    );
  // Ajout d'un point : la limite la plus proche du toucher reçoit un nouveau sommet.
  if (ui.mode === 'sommet' && ui.ajoutEnCours) {
    let proche: { anneau: number; debut: number; d: number } | null = null;
    for (const i of ordre) {
      const pts = anneaux[i]!;
      pts.forEach((q, k) => {
        const pos = positionSurSegment(p, q, pts[(k + 1) % pts.length]!);
        if (
          pos.t > 0 &&
          pos.t < 1 &&
          pos.ecart <= rayon &&
          (!proche || pos.ecart < proche.d - 1e-6)
        ) {
          proche = { anneau: i, debut: k, d: pos.ecart };
        }
      });
    }
    const limite = proche as { anneau: number; debut: number } | null;
    if (!limite) {
      ui.message = { texte: 'Touche une limite.', erreur: true };
      afficher();
      return;
    }
    try {
      const r = ajouterPoint(s.etat, { anneau: limite.anneau, debut: limite.debut }, position);
      ui.ajoutEnCours = false;
      const note = enregistrerModification(
        s,
        r.etat,
        `Point ajouté sur une limite de ${nomParcelle(s, limite.anneau)}`,
      );
      effacerSelection();
      ui.parcelleCourante = s.etat.anneaux[limite.anneau]!.parcelle;
      // Si le nettoyage a retiré un point (ajout tout contre un sommet), l'indice n'est plus sûr.
      if (!note) ui.selSommet = r.sommet;
      ui.message = { texte: `Point ajouté${note}.`, erreur: false };
    } catch (e) {
      ui.message = { texte: (e as Error).message, erreur: true };
    }
    afficher();
    return;
  }
  // Mode point, sommet déjà choisi : toucher un des deux bords qui y aboutissent choisit le bord
  // le long duquel il glissera (sans désélectionner le sommet).
  if (ui.mode === 'sommet' && ui.selSommet) {
    const ref = ui.selSommet;
    const pts = anneaux[ref.anneau]!;
    const v = pts[ref.sommet]!;
    if (Math.hypot(v[0] - p[0], v[1] - p[1]) > rayon) {
      const candidats = [ref.sommet, precedent(s.etat, ref.anneau, ref.sommet)].map((debut) => {
        const a = pts[debut]!;
        const b = pts[(debut + 1) % pts.length]!;
        const pos = positionSurSegment(p, a, b);
        // Un toucher près d'une extrémité vise un sommet, pas le bord.
        const presDuBout = Math.min(
          Math.hypot(a[0] - p[0], a[1] - p[1]),
          Math.hypot(b[0] - p[0], b[1] - p[1]),
        );
        return {
          debut,
          d: pos.t >= 0 && pos.t <= 1 && presDuBout > rayon ? pos.ecart : Infinity,
        };
      });
      const bordTouche = candidats.sort((x, y) => x.d - y.d)[0]!;
      if (bordTouche.d <= rayon) {
        ui.limiteGlisse = { anneau: ref.anneau, debut: bordTouche.debut };
        ui.sensGlisse = null;
        ui.message = null;
        ui.onglet = ongletDuMode();
        afficher();
        return;
      }
    }
  }
  // Mode Coller, bord choisi : toucher une autre parcelle (sa limite ou son intérieur) en fait le
  // modèle. Toucher la parcelle du bord recommence le choix du bord.
  if (ui.mode === 'coller' && ui.bord) {
    const parcelleBord = s.etat.anneaux[ui.bord.anneau]!.parcelle;
    let modele: { anneau: number; d: number } | null = null;
    anneaux.forEach((pts, i) => {
      if (s.etat.anneaux[i]!.parcelle === parcelleBord) return;
      pts.forEach((q, k) => {
        const r = pts[(k + 1) % pts.length]!;
        const pos = positionSurSegment(p, q, r);
        const d =
          pos.t < 0
            ? Math.hypot(p[0] - q[0], p[1] - q[1])
            : pos.t > 1
              ? Math.hypot(p[0] - r[0], p[1] - r[1])
              : pos.ecart;
        if (d <= rayon && (!modele || d < modele.d)) modele = { anneau: i, d };
      });
    });
    const touche =
      (modele as { anneau: number } | null)?.anneau ??
      anneaux.findIndex(
        (pts, i) =>
          s.etat.anneaux[i]!.type === 1 &&
          s.etat.anneaux[i]!.parcelle !== parcelleBord &&
          pointDansPolygone(p, pts),
      );
    if (touche >= 0) {
      ui.modele = touche;
      ui.message = null;
      ui.onglet = ongletDuMode();
      afficher();
      return;
    }
  }
  // Fusion : toucher une autre parcelle (sa limite ou son intérieur) la choisit comme voisine à
  // reprendre ; la parcelle choisie reste.
  if (ui.mode === 'couper' && ui.actionCoupe === 'fusionner' && ui.parcelleCourante !== null) {
    const autre = anneaux.findIndex(
      (pts, i) =>
        s.etat.anneaux[i]!.type === 1 &&
        s.etat.anneaux[i]!.parcelle !== ui.parcelleCourante &&
        pointDansPolygone(p, pts),
    );
    if (autre >= 0) {
      ui.fusion = s.etat.anneaux[autre]!.parcelle;
      ui.message = null;
      ui.onglet = ongletDuMode();
      afficher();
      return;
    }
  }
  let meilleur: { anneau: number; indice: number; d: number } | null = null;
  for (const i of ordre) {
    const pts = anneaux[i]!;
    pts.forEach((q, k) => {
      let d: number;
      if (ui.mode === 'sommet' || choixDeBord()) {
        d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      } else {
        const r = pts[(k + 1) % pts.length]!;
        const pos = positionSurSegment(p, q, r);
        d =
          pos.t < 0
            ? Math.hypot(p[0] - q[0], p[1] - q[1])
            : pos.t > 1
              ? Math.hypot(p[0] - r[0], p[1] - r[1])
              : pos.ecart;
      }
      if (d <= rayon && (!meilleur || d < meilleur.d - 1e-6))
        meilleur = { anneau: i, indice: k, d };
    });
  }
  const choix = meilleur as { anneau: number; indice: number } | null;
  const [ancienDebut, ancienBord] = [ui.bordDebut, ui.bord];
  effacerSelection();
  if (choix && choixDeBord()) {
    // Premier toucher : début du bord ; deuxième : fin ; un toucher de plus recommence.
    ui.parcelleCourante = s.etat.anneaux[choix.anneau]!.parcelle;
    if (ancienDebut && !ancienBord && ancienDebut.anneau === choix.anneau) {
      if (ancienDebut.sommet !== choix.indice) {
        ui.bordDebut = ancienDebut;
        ui.bord = bordLePlusCourt(s.etat, choix.anneau, ancienDebut.sommet, choix.indice);
        // Collage : la parcelle voisine la plus proche du bord est proposée comme modèle.
        if (ui.mode === 'coller') ui.modele = modeleLePlusProche(s.etat, ui.bord);
      } else ui.bordDebut = ancienDebut;
    } else {
      ui.bordDebut = { anneau: choix.anneau, sommet: choix.indice };
    }
    ui.onglet = ongletDuMode();
  } else if (choix) {
    ui.parcelleCourante = s.etat.anneaux[choix.anneau]!.parcelle;
    if (ui.mode === 'limite') ui.selLimite = { anneau: choix.anneau, debut: choix.indice };
    else if (ui.mode === 'sommet') ui.selSommet = { anneau: choix.anneau, sommet: choix.indice };
    // Couper : le côté touché (contour extérieur) donne la direction de la coupe.
    if (
      ui.mode === 'couper' &&
      ui.actionCoupe === 'couper' &&
      s.etat.anneaux[choix.anneau]!.type === 1
    ) {
      ui.coupe = { parcelle: ui.parcelleCourante, segment: choix.indice };
    }
    // Optimisation : un bord touché du contour extérieur donne des passages parallèles à son côté.
    if (
      ui.mode === 'guidage' &&
      ui.porteeGuidage === 'optimiser' &&
      s.etat.anneaux[choix.anneau]!.type === 1
    ) {
      ui.coteOptimise = { parcelle: ui.parcelleCourante, segment: choix.indice };
      ui.propositionChoisie = -1;
    }
    ui.onglet = ongletDuMode();
  } else {
    // Toucher à l'intérieur d'une parcelle (loin de ses limites) : on la sélectionne.
    const dedans = anneaux.findIndex(
      (pts, i) => s.etat.anneaux[i]!.type === 1 && pointDansPolygone(p, pts),
    );
    if (dedans >= 0) ui.parcelleCourante = s.etat.anneaux[dedans]!.parcelle;
  }
  ui.message = null;
  afficher();
}
