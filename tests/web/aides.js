// Outils communs des tests web.
// - Groq est simulé : aucune requête ne sort sur Internet, et une requête inattendue fait échouer le test.
// - La copie est interceptée dans la page : le vrai presse-papiers n'est jamais touché.
// - Une erreur JavaScript dans la page fait échouer le test.
const base = require('@playwright/test');

const { expect } = base;

// Réglages d'une personne qui a déjà collé sa clé (migrations déjà faites).
const REGLAGES = { provider: 'groq', keys: { groq: 'gsk_test' }, floating: false, scV: 2, fixV: 1, posV: 1 };

const reponse = (status, corps, entetes = {}) => ({
  status,
  headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', ...entetes },
  body: JSON.stringify(corps),
});

const test = base.test.extend({
  // Groq simulé ; chaque test peut changer la réponse avant de dicter.
  groq: [
    async ({ context }, use) => {
      const g = {
        texte: 'Bonjour, ceci est un test de Verbe.', // ce que « Groq » transcrit
        statut: 200, // 429 pour simuler la limite atteinte
        entetes: {}, // en-têtes de limite (lisibles seulement dans l'app bureau)
        nettoye: 'Texte nettoyé.', // réponse du modèle pour « Nettoyer »
        transcriptions: 0,
        corpsChat: null,
        dehors: [],
      };
      await context.route(
        url => !/^http:\/\/localhost(:\d+)?\//.test(url.href),
        route => {
          const u = route.request().url();
          if (u === 'https://api.groq.com/openai/v1/audio/transcriptions') {
            g.transcriptions++;
            return route.fulfill(
              g.statut === 200 ? reponse(200, { text: g.texte }, g.entetes) : reponse(g.statut, { error: { message: 'rate limit' } }, g.entetes),
            );
          }
          if (u === 'https://api.groq.com/openai/v1/models') {
            return route.fulfill(reponse(200, { data: [{ id: 'whisper-large-v3-turbo' }, { id: 'llama-3.3-70b-versatile' }] }));
          }
          if (u === 'https://api.groq.com/openai/v1/chat/completions') {
            g.corpsChat = route.request().postDataJSON();
            return route.fulfill(reponse(200, { choices: [{ message: { content: g.nettoye } }] }));
          }
          g.dehors.push(u);
          return route.abort();
        },
      );
      await use(g);
      expect(g.dehors, 'requêtes vers Internet non prévues').toEqual([]);
    },
    { auto: true },
  ],

  page: async ({ page }, use) => {
    const erreurs = [];
    page.on('pageerror', e => erreurs.push(e.message));
    page.on('console', m => {
      // « Failed to load resource » : Chromium note ainsi les réponses d'erreur simulées (429…), pas un bogue de la page
      if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) erreurs.push(m.text());
    });
    await page.addInitScript(() => {
      window.__copies = [];
      const faux = {
        writeText: async t => { window.__copies.push(String(t)); },
        readText: async () => '',
        write: async () => {},
        read: async () => [],
      };
      try {
        Object.defineProperty(Navigator.prototype, 'clipboard', { get: () => faux, configurable: true });
      } catch (e) { /* navigateur sans presse-papiers */ }
      const exec = Document.prototype.execCommand;
      Document.prototype.execCommand = function (commande, ...reste) {
        if (String(commande).toLowerCase() === 'copy') { window.__copies.push('(execCommand)'); return true; }
        return exec.call(this, commande, ...reste);
      };
    });
    await use(page);
    expect(erreurs, 'erreurs JavaScript dans la page').toEqual([]);
  },
});

const pret = page => page.waitForFunction(() => window.Verbe && window.Verbe.App);

/**
 * Ouvre Verbe avec des réglages de départ.
 * reglages : null = aucun réglage (première visite) ; avant : une fonction lancée dans la page avant le rechargement.
 */
async function ouvrir(page, { hash = '', reglages = REGLAGES, avant } = {}) {
  await page.goto('/app/verbe.html');
  await page.evaluate(r => {
    localStorage.clear();
    if (r) localStorage.setItem('verbe.reglages.v1', JSON.stringify(r));
  }, reglages);
  if (avant) await page.evaluate(avant);
  await page.goto('/app/verbe.html' + hash);
  if (hash) await page.reload();
  await pret(page);
}

const attendreEtat = (page, etat, timeout = 8000) => page.waitForFunction(e => window.Verbe.App.state === e, etat, { timeout });

/** Une dictée complète avec le faux micro. Par défaut : App.toggle() puis App.stop(). */
async function dicter(page, { demarrer, arreter, duree = 1300 } = {}) {
  await (demarrer ? demarrer() : page.evaluate(() => window.Verbe.App.toggle()));
  await attendreEtat(page, 'recording');
  await page.waitForTimeout(duree);
  await (arreter ? arreter() : page.evaluate(() => window.Verbe.App.stop()));
  await attendreEtat(page, 'idle', 12000);
}

module.exports = { test, expect, REGLAGES, ouvrir, pret, attendreEtat, dicter };
