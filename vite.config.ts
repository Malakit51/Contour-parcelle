import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Chemins relatifs : le site peut être servi depuis n'importe quel sous-dossier (GitHub Pages).
  base: './',
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
