import { execSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';

/** Numéro de version : nombre de commits (il augmente à chaque mise à jour publiée). */
function numeroVersion(): string {
  try {
    return execSync('git rev-list --count HEAD').toString().trim();
  } catch {
    return '?';
  }
}

/** Date et heure de construction, à l'heure française (« 14/10/2026 16:05 »). */
const dateConstruction = new Date()
  .toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' })
  .replace(',', '');

export default defineConfig({
  // Chemins relatifs : le site peut être servi depuis n'importe quel sous-dossier (GitHub Pages).
  base: './',
  define: {
    __VERSION__: JSON.stringify(numeroVersion()),
    __DATE_VERSION__: JSON.stringify(dateConstruction),
  },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
