// Stockage sur l'appareil (localStorage) et nom de l'appareil.

// localStorage du navigateur (null s'il est inaccessible : navigation privée…).
export const stockage = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();

// ---------- Nom de l'appareil ----------

/** Nom de cet appareil (pour la sauvegarde en ligne et le journal). */
export function nomAppareil(): string {
  try {
    return stockage?.getItem('contour-parcelle/appareil') ?? 'appareil';
  } catch {
    return 'appareil';
  }
}

export function changerNomAppareil(): boolean {
  const nom = prompt(
    'Nom de cet appareil (par exemple « téléphone » ou « tablette ») :',
    nomAppareil(),
  );
  if (!nom?.trim()) return false;
  try {
    stockage?.setItem('contour-parcelle/appareil', nom.trim());
  } catch {
    // pas de stockage : le nom par défaut reste
  }
  return true;
}

export function lireStockage(cle: string): string | null {
  try {
    return stockage?.getItem(cle) ?? null;
  } catch {
    return null;
  }
}

export function ecrireStockage(cle: string, valeur: string | null): void {
  try {
    if (valeur === null) stockage?.removeItem(cle);
    else stockage?.setItem(cle, valeur);
  } catch {
    // pas de stockage : tant pis
  }
}
