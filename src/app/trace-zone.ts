// Tracé de la zone d'une note : coins touchés sur la carte, ou tour de la zone à pied avec le
// GPS du téléphone (l'écran reste allumé pendant le tracé).

import { creerParcelle } from '../edition/parcelles-ajoutees';
import { ajouterZoneExclue } from '../edition/zones-exclues';
import { ajouterPointTrace, pointInterieur, surfaceZone, texteSurface } from '../suivi/zones';
import { ui } from './etat';
import { afficher } from './mise-en-page';
import { arreterOutilsCarte, modifier } from './travail';

let suivi: number | null = null;
let verrouEcran: { release(): Promise<void> } | null = null;

function arreterGps(): void {
  if (suivi !== null) navigator.geolocation.clearWatch(suivi);
  suivi = null;
  void verrouEcran?.release().catch(() => undefined);
  verrouEcran = null;
}

/**
 * Commence le tracé : au doigt (un toucher = un coin) ou en marchant (GPS), pour la zone de la
 * note en cours ou pour une nouvelle zone exclue de la parcelle `parcelle`.
 */
export function commencerTrace(
  mode: 'points' | 'gps',
  pour: 'note' | 'exclue' | 'parcelle' = 'note',
  parcelle: number | null = null,
): void {
  arreterOutilsCarte();
  arreterGps();
  ui.placementNote = false;
  ui.traceZone = { mode, pour, parcelle, points: [], precision: null };
  if (mode === 'gps') {
    if (!('geolocation' in navigator)) {
      ui.traceZone = null;
      ui.message = { texte: 'Position GPS indisponible sur cet appareil.', erreur: true };
      afficher();
      return;
    }
    // Écran allumé pendant le tour de la zone (sinon le téléphone se met en veille et le GPS
    // s'arrête). Sans effet si Chrome ne le permet pas.
    const nav = navigator as Navigator & {
      wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> };
    };
    void nav.wakeLock
      ?.request('screen')
      .then((v) => (verrouEcran = v))
      .catch(() => undefined);
    suivi = navigator.geolocation.watchPosition(
      (pos) => {
        const t = ui.traceZone;
        if (!t || t.mode !== 'gps') return;
        ui.traceZone = {
          ...t,
          points: ajouterPointTrace(
            t.points,
            [pos.coords.latitude, pos.coords.longitude],
            pos.coords.accuracy,
          ),
          precision: pos.coords.accuracy,
        };
        afficher();
      },
      (err) => {
        ui.message = {
          texte:
            err.code === err.PERMISSION_DENIED
              ? 'Position refusée : autorise la localisation pour ce site dans Chrome.'
              : `Position indisponible (${err.message}).`,
          erreur: true,
        };
        afficher();
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 30000 },
    );
  }
  afficher();
}

/** Retire le dernier coin (ou la dernière position GPS). */
export function retirerDernierPoint(): void {
  if (!ui.traceZone) return;
  ui.traceZone = { ...ui.traceZone, points: ui.traceZone.points.slice(0, -1) };
  afficher();
}

/** Abandonne le tracé (la note garde son endroit d'avant). */
export function annulerTrace(): void {
  arreterGps();
  ui.traceZone = null;
  afficher();
}

/** Termine le tracé : la zone devient l'endroit de la note en cours. */
export function terminerTrace(): void {
  const t = ui.traceZone;
  if (!t || (t.pour === 'note' && !ui.noteEnCours)) return annulerTrace();
  if (t.points.length < 3) {
    ui.message = { texte: 'Il faut au moins 3 points pour faire une zone.', erreur: true };
    afficher();
    return;
  }
  const zone = t.points.map((p): [number, number] => [p[0], p[1]]);
  if (t.pour === 'parcelle') {
    const s = ui.session;
    if (!s) return annulerTrace();
    const nom = prompt('Nom de la nouvelle parcelle', '')?.trim();
    if (!nom) return; // le tracé reste, on peut terminer plus tard
    let creee = -1;
    modifier(
      () => {
        const r = creerParcelle(s.td, s.etat, nom, zone);
        creee = r.parcelle;
        return r.etat;
      },
      `Parcelle ${nom} créée (${texteSurface(surfaceZone(zone))})`,
      false,
    );
    if (creee >= 0) {
      arreterGps();
      ui.traceZone = null;
      ui.parcelleCourante = creee;
    }
    afficher();
    return;
  }
  if (t.pour === 'exclue') {
    const s = ui.session;
    if (!s || t.parcelle === null) return annulerTrace();
    const p = t.parcelle;
    let refusee = false;
    modifier(
      () => {
        try {
          return ajouterZoneExclue(s.etat, p, zone);
        } catch (e) {
          refusee = true;
          throw e;
        }
      },
      `Zone exclue de ${texteSurface(surfaceZone(zone))} ajoutée à ${s.td.parcelles[p]!.nom}`,
      false,
    );
    // Refusée (hors de la parcelle…) : le tracé reste, pour retirer ou ajouter des points.
    if (!refusee) {
      arreterGps();
      ui.traceZone = null;
    }
    afficher();
    return;
  }
  arreterGps();
  if (ui.noteEnCours) {
    ui.noteEnCours.zone = zone;
    ui.noteEnCours.position = pointInterieur(zone);
  }
  ui.traceZone = null;
  afficher();
}
