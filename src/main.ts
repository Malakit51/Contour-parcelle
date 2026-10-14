// Point d'entrée : l'éditeur de contours (TASKDATA.XML de la console), découpé en modules dans
// src/app/ (interface) ; géométrie, édition, lecture et écriture du fichier dans les autres dossiers.

import './style.css';
import { afficher } from './app/mise-en-page';
import { reprendreSession } from './app/travail';

afficher();
reprendreSession();

// Installation comme une application (icône sur l'écran d'accueil, plein écran).
if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.register('./sw.js').catch(() => {
    // sans service worker, l'éditeur marche quand même
  });
}
