// Petit serveur statique pour les tests : sert le dépôt comme GitHub Pages
// (http://localhost:<port>/app/verbe.html), sans cache.
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.argv[2] || 4173);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

http
  .createServer((req, res) => {
    let chemin = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (chemin.endsWith('/')) chemin += 'index.html';
    const fichier = normalize(join(RACINE, chemin));
    if (!fichier.startsWith(RACINE)) {
      res.writeHead(403);
      return res.end();
    }
    let infos;
    try {
      infos = statSync(fichier);
    } catch {
      infos = null;
    }
    if (!infos || !infos.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('introuvable');
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(fichier)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    createReadStream(fichier).pipe(res);
  })
  .listen(PORT, () => console.log(`Verbe servi sur http://localhost:${PORT}/app/verbe.html`));
