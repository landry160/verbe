// Verbe se développe en fichiers (src/), et Vite les rassemble en une seule page : app/verbe.html.
// Cette page unique est ce que chargent l'app bureau (depuis le disque), GitHub Pages et les tests ;
// elle est enregistrée dans le dépôt, et la CI vérifie qu'elle correspond bien aux sources.
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';

const ici = chemin => fileURLToPath(new URL(chemin, import.meta.url));

export default defineConfig({
  root: 'src',
  base: './',
  publicDir: '../public', // polices et licences, copiées telles quelles à côté de la page
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
  build: {
    outDir: '../app',
    emptyOutDir: true,
    minify: false, // une page lisible : les erreurs restent faciles à suivre
    cssMinify: false,
    reportCompressedSize: false,
    rollupOptions: { input: ici('./src/verbe.html') },
  },
  server: { port: 5173, strictPort: true },
});
