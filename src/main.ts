// Point d'entrée : l'éditeur de contours (TASKDATA.XML de la console), découpé en modules dans
// src/app/ (interface) ; géométrie, édition, lecture et écriture du fichier dans les autres dossiers.

import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import './style.css';
import { afficher } from './app/mise-en-page';
import { reprendreSession } from './app/travail';
import { annoncerMiseAJour } from './app/version';

afficher();
reprendreSession();
annoncerMiseAJour();
afficher();

// Installation comme une application (icône sur l'écran d'accueil, plein écran).
if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.register('./sw.js').catch(() => {
    // sans service worker, l'éditeur marche quand même
  });
}
