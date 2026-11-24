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

/* la liste de la page : ce qui est nouveau depuis une version (côté bureau) */
const depuis = v => principale.evaluate(x => window.Verbe.News.since(x).map(n => n.title), v);

test('après une mise à jour : une nouveauté par page, puis plus jamais pour cette version', async () => {
  const attendus = await principale.evaluate(() => window.Verbe.NOUVEAUTES.filter(n => n.v === window.Verbe.VERSION).map(n => n.title));
  expect(attendus.length, 'la version a ses nouveautés').toBeGreaterThan(0);
  const avant = await principale.evaluate(() => window.Verbe.NOUVEAUTES.find(n => n.v !== window.Verbe.VERSION)?.v || '0.5.0');
  await relancer(avant);
  await expect.poll(async () => (await fenetre()).ouverte).toBe(true);
  for (let i = 0; i < attendus.length; i++) {
    const f = await fenetre();
    expect(f.kick).toBe(attendus.length > 1 ? `Nouveau dans Verbe ${VERSION} · ${i + 1} / ${attendus.length}` : `Nouveau dans Verbe ${VERSION}`);
    expect(f.titre).toBe(attendus[i]);
    expect(f.bouton).toBe(i === attendus.length - 1 ? 'C’est parti' : 'Suivant');
    await principale.click('#news [data-n="next"]');
  }
  expect((await fenetre()).ouverte).toBe(false);
  expect(await principale.evaluate(() => localStorage.getItem('verbe.nouveautes'))).toBe(VERSION);

  await principale.reload();
  await pret(principale);
  await principale.waitForTimeout(1200);
  expect((await fenetre()).ouverte, 'une seule fois par version').toBe(false);
});

test('venant d’une version qui ne notait rien (0.5.1) : les nouveautés depuis la 0.5.0, Échap ferme', async () => {
  const n = (await depuis('0.5.0')).length;
  await relancer(null);
  await expect.poll(async () => (await fenetre()).ouverte).toBe(true);
  expect((await fenetre()).kick).toMatch(new RegExp(` · 1 / ${n}$`));
  await principale.keyboard.press('Escape');
  expect((await fenetre()).ouverte).toBe(false);
  expect(await principale.evaluate(() => localStorage.getItem('verbe.nouveautes'))).toBe(VERSION);
});

test('Réglages › Général › « Nouveautés » rouvre la fenêtre', async () => {
  const premier = await principale.evaluate(() => window.Verbe.NOUVEAUTES.find(n => n.v === window.Verbe.VERSION).title);
  await principale.evaluate(() => { location.hash = '#reglages/general'; });
  await expect(principale.locator('#btn-news')).toBeVisible();
  await principale.click('#btn-news');
  await expect.poll(async () => (await fenetre()).titre).toBe(premier);
  await principale.waitForTimeout(700); // fin de l'animation d'ouverture
  await principale.screenshot({ path: path.join(os.tmpdir(), 'verbe-nouveautes.png') });
  await principale.keyboard.press('Escape'); // une seule page : pas de « Passer »
  expect((await fenetre()).ouverte).toBe(false);
});

test('une nouvelle installation fermée aussitôt ouverte ne prend pas la suivante pour une mise à jour', async () => {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'verbe-profil-news2-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const lancer = async () => {
    const a = await electron.launch({ executablePath: require('electron'), args: [RACINE, `--profil=${p}`], env });
    await expect.poll(() => a.windows().length, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
    const w = a.windows().find(x => !x.url().includes('bulle=1'));
    await pret(w);
    return { a, w };
  };
  try {
    let { a, w } = await lancer();
    await w.evaluate(() => window.Verbe.Settings.save()); // des réglages enregistrés, puis fermé tout de suite
    await a.close();
    ({ a, w } = await lancer());
    await w.waitForTimeout(1200);
    expect(await w.evaluate(() => !!document.querySelector('#news')), 'pas de fenêtre des Nouveautés').toBe(false);
    await a.close();
  } finally {
    fs.rmSync(p, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
});
