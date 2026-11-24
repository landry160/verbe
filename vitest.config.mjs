// Tests rapides (Vitest) de la logique autonome (src/lib) : sans navigateur, en quelques millisecondes.
// Les tests de l'app dans Chromium et Electron restent dans Playwright (tests/web, tests/bureau).
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@lib': fileURLToPath(new URL('./src/lib', import.meta.url)) } },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
});
