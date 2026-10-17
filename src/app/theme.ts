// Thème clair ou sombre : celui du téléphone (automatique) ou imposé dans les Réglages.

import { lireStockage, ecrireStockage } from './stockage';

export type Theme = 'auto' | 'clair' | 'sombre';
const CLE_THEME = 'contour-parcelle/theme';
// Fond de la page dans chaque thème (barre d'état du téléphone de la même couleur).
const FOND = { clair: '#f4f2ec', sombre: '#121614' };

export function themeChoisi(): Theme {
  const t = lireStockage(CLE_THEME);
  return t === 'clair' || t === 'sombre' ? t : 'auto';
}

/** Pose le thème sur la page (attribut `data-theme` lu par la feuille de style). */
export function appliquerTheme(theme: Theme = themeChoisi()): void {
  const racine = document.documentElement;
  if (theme === 'auto') racine.removeAttribute('data-theme');
  else racine.setAttribute('data-theme', theme);
  // Les deux balises theme-color suivent le téléphone ; un thème imposé leur donne sa couleur.
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  metas.forEach((m) => {
    const sombre = m.media.includes('dark');
    m.content = theme === 'auto' ? FOND[sombre ? 'sombre' : 'clair'] : FOND[theme];
  });
}

export function choisirTheme(theme: Theme): void {
  ecrireStockage(CLE_THEME, theme === 'auto' ? null : theme);
  appliquerTheme(theme);
}
