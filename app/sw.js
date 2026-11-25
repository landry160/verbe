/* Verbe installé sur un téléphone ou un ordi (app web) : ce service garde la page et ses fichiers
   pour qu'elle s'ouvre même sans réseau. Toujours le réseau d'abord : une nouvelle version arrive
   dès qu'elle est en ligne ; la copie gardée ne sert que hors connexion.
   Il ne touche jamais aux appels vers les services de transcription (autres adresses). */
const CACHE = 'verbe-v1';
const FICHIERS = ['./verbe.html', './manifest.webmanifest', './fonts/inter-latin.woff2', './fonts/inter-latin-ext.woff2', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(noms => Promise.all(noms.filter(n => n !== CACHE).map(n => caches.delete(n)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return; /* Groq, OpenAI… : jamais interceptés */
  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) { const copie = res.clone(); caches.open(CACHE).then(c => c.put(req, copie)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./verbe.html'))),
  );
});
