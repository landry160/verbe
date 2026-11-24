// Verbe se développe en fichiers (src/), et Vite les rassemble en une seule page : app/verbe.html.
// Cette page unique est ce que chargent l'app bureau (depuis le disque), GitHub Pages et les tests ;
// elle est enregistrée dans le dépôt, et la CI vérifie qu'elle correspond bien aux sources.
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const ici = chemin => fileURLToPath(new URL(chemin, import.meta.url));

/* Les fichiers de src/app/ forment UN SEUL module, rassemblés dans l'ordre de leur numéro :
   le code garde exactement l'ordre et la portée de l'ancien script unique (pas de module qui
   s'exécuterait avant un autre dont il dépend). La logique autonome vit, elle, dans de vrais
   modules (src/lib/), importés normalement. */
const VIRTUEL = 'virtual:verbe-app';
const RESOLU = '\0verbe-app';
function assembler() {
  const dossier = ici('./src/app/');
  return {
    name: 'verbe-assembler',
    resolveId(id) {
      return id === VIRTUEL ? RESOLU : null;
    },
    load(id) {
      if (id !== RESOLU) return null;
      const fichiers = fs.readdirSync(dossier).filter(f => /^\d\d-.+\.js$/.test(f)).sort();
      for (const f of fichiers) this.addWatchFile(path.join(dossier, f));
      return fichiers.map(f => fs.readFileSync(path.join(dossier, f), 'utf8')).join('\n');
    },
  };
}

export default defineConfig({
  root: 'src',
  base: './',
  publicDir: '../public', // polices et licences, copiées telles quelles à côté de la page
  plugins: [assembler(), viteSingleFile({ removeViteModuleLoader: true })],
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
