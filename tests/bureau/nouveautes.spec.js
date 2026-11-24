// Nouveautés : après une mise à jour, une fenêtre présente ce qui change, une seule fois par version.
// L'app tourne dans un profil à part ; aucune dictée, aucun collage.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');

const RACINE = path.join(__dirname, '..', '..');
const VERSION = require(path.join(RACINE, 'package.json')).version;

test.describe.configure({ mode: 'serial' });

let app;
let principale;
let profil;
const erreurs = [];

const pret = page => page.waitForFunction(() => window.Verbe && window.Verbe.Settings);
const fenetre = () => principale.evaluate(() => {
  const w = document.querySelector('#news');
  return w ? { ouverte: true, titre: w.querySelector('#news-title').textContent, kick: w.querySelector('.news-kick').textContent, bouton: w.querySelector('[data-n="next"]').textContent } : { ouverte: false };
});
/* « revenir » après une mise à jour : on règle ce qui a été vu, puis on recharge la fenêtre */
const relancer = async vu => {
  await principale.evaluate(v => { if (v) localStorage.setItem('verbe.nouveautes', v); else localStorage.removeItem('verbe.nouveautes'); }, vu);
  await principale.reload();
  await pret(principale);
};

test.beforeAll(async () => {
  profil = fs.mkdtempSync(path.join(os.tmpdir(), 'verbe-profil-news-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: require('electron'), args: [RACINE, `--profil=${profil}`], env });
  await expect.poll(() => app.windows().length, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
  principale = app.windows().find(w => !w.url().includes('bulle=1'));
  principale.on('pageerror', e => erreurs.push(e.message));
  await pret(principale);
  await principale.evaluate(() => { window.Verbe.Settings.d.autoPaste = false; window.Verbe.Settings.save(); });
});

test.afterAll(async () => {
  if (app) await app.close().catch(() => {});
  if (profil) fs.rmSync(profil, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
});

test.afterEach(() => { expect(erreurs, 'erreurs JavaScript').toEqual([]); });

test('la page annonce la même version que package.json', async () => {
  expect(await principale.evaluate(() => document.querySelector('#app-version').textContent)).toBe(VERSION);
});

test('une nouvelle installation n’affiche pas de nouveautés', async () => {
  await principale.waitForTimeout(1200);
  expect((await fenetre()).ouverte).toBe(false);
  expect(await principale.evaluate(() => localStorage.getItem('verbe.nouveautes'))).toBe(VERSION);
});

test('après une mise à jour : une nouveauté par page, puis plus jamais pour cette version', async () => {
  await relancer('0.5.1');
  await expect.poll(async () => (await fenetre()).ouverte).toBe(true);
  let f = await fenetre();
  expect(f.kick).toBe(`Nouveau dans Verbe ${VERSION} · 1 / 2`);
  expect(f.titre).toBe('La même voix partout');
  expect(f.bouton).toBe('Suivant');
  await principale.click('#news [data-n="next"]');
  f = await fenetre();
  expect(f.kick).toBe(`Nouveau dans Verbe ${VERSION} · 2 / 2`);
  expect(f.bouton).toBe('C’est parti');
  await principale.click('#news [data-n="next"]');
  expect((await fenetre()).ouverte).toBe(false);
  expect(await principale.evaluate(() => localStorage.getItem('verbe.nouveautes'))).toBe(VERSION);

  await principale.reload();
  await pret(principale);
  await principale.waitForTimeout(1200);
  expect((await fenetre()).ouverte, 'une seule fois par version').toBe(false);
});

test('venant d’une version qui ne notait rien (0.5.1) : les nouveautés depuis la 0.5.0, Échap ferme', async () => {
  await relancer(null);
  await expect.poll(async () => (await fenetre()).ouverte).toBe(true);
  expect((await fenetre()).kick).toMatch(/ · 1 \/ 4$/);
  await principale.keyboard.press('Escape');
  expect((await fenetre()).ouverte).toBe(false);
  expect(await principale.evaluate(() => localStorage.getItem('verbe.nouveautes'))).toBe(VERSION);
});

test('Réglages › Général › « Nouveautés » rouvre la fenêtre', async () => {
  await principale.evaluate(() => { location.hash = '#reglages/general'; });
  await expect(principale.locator('#btn-news')).toBeVisible();
  await principale.click('#btn-news');
  await expect.poll(async () => (await fenetre()).titre).toBe('La même voix partout');
  await principale.waitForTimeout(700); // fin de l'animation d'ouverture
  await principale.screenshot({ path: path.join(os.tmpdir(), 'verbe-nouveautes.png') });
  await principale.click('#news [data-n="skip"]');
  expect((await fenetre()).ouverte).toBe(false);
});
