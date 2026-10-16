// Tracé de la zone d'une note : coins touchés sur la carte, ou tour de la zone à pied avec le
// GPS du téléphone (l'écran reste allumé pendant le tracé).

import { ajouterPointTrace, pointInterieur } from '../suivi/zones';
import { ui } from './etat';
import { afficher } from './mise-en-page';
import { arreterOutilsCarte } from './travail';

let suivi: number | null = null;
let verrouEcran: { release(): Promise<void> } | null = null;

function arreterGps(): void {
  if (suivi !== null) navigator.geolocation.clearWatch(suivi);
  suivi = null;
  void verrouEcran?.release().catch(() => undefined);
  verrouEcran = null;
}

/** Commence le tracé : au doigt (un toucher = un coin) ou en marchant (GPS). */
export function commencerTrace(mode: 'points' | 'gps'): void {
  arreterOutilsCarte();
  arreterGps();
  ui.placementNote = false;
  ui.traceZone = { mode, points: [], precision: null };
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
  if (!t || !ui.noteEnCours) return annulerTrace();
  if (t.points.length < 3) {
    ui.message = { texte: 'Il faut au moins 3 points pour faire une zone.', erreur: true };
    afficher();
    return;
  }
  arreterGps();
  const zone = t.points.map((p): [number, number] => [p[0], p[1]]);
  ui.noteEnCours.zone = zone;
  ui.noteEnCours.position = pointInterieur(zone);
  ui.traceZone = null;
  afficher();
}
