// Version bureau : Mes mots et les textes tout prêts réglés dans la fenêtre principale servent dans la bulle,
// qui transcrit et colle. Profil à part (--profil=) ; aucune dictée, aucun collage réel.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');

const RACINE = path.join(__dirname, '..', '..');

test.describe.configure({ mode: 'serial' });

let app;
let principale;
let bulle;
let profil;
const erreurs = [];

const pret = page => page.waitForFunction(() => window.Verbe && window.Verbe.Settings);

test.beforeAll(async () => {
  profil = fs.mkdtempSync(path.join(os.tmpdir(), 'verbe-profil-test-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; // sinon Electron démarre comme un simple Node
  app = await electron.launch({ executablePath: require('electron'), args: [RACINE, `--profil=${profil}`], env });
  await expect.poll(() => app.windows().length, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
  principale = app.windows().find(w => !w.url().includes('bulle=1'));
  bulle = app.windows().find(w => w.url().includes('bulle=1'));
  principale.on('pageerror', e => erreurs.push(`fenêtre principale : ${e.message}`));
  bulle.on('pageerror', e => erreurs.push(`bulle : ${e.message}`));
  await pret(principale);
  await pret(bulle);
  // sécurité : jamais de collage automatique pendant les tests
  await principale.evaluate(() => { window.Verbe.Settings.d.autoPaste = false; window.Verbe.Settings.save(); });
});

test.afterAll(async () => {
  if (app) await app.close().catch(() => {});
  if (profil) fs.rmSync(profil, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
});

test.afterEach(() => {
  expect(erreurs, 'erreurs JavaScript').toEqual([]);
});

test('Mes mots et un texte tout prêt, réglés dans la fenêtre, servent dans la bulle', async () => {
  await principale.evaluate(() => { location.hash = '#reglages/texte'; });
  await principale.click('#btn-word-add');
  await principale.locator('#words-list .m-word').fill('SlideFabrik');
  await principale.locator('#words-list .m-heard').fill('slide fabrique');
  await principale.click('#btn-snip-add');
  await principale.locator('#snips-list .m-name').fill('signature');
  await principale.locator('#snips-list .m-text').fill('Landry\nVerbe');
  await principale.locator('#snips-list .m-text').blur(); // « change » enregistre tout de suite

  await expect
    .poll(() => bulle.evaluate(() => ({ mots: window.Verbe.Settings.d.words, textes: window.Verbe.Settings.d.snippets })))
    .toEqual({ mots: [{ word: 'SlideFabrik', heard: 'slide fabrique' }], textes: [{ name: 'signature', text: 'Landry\nVerbe' }] });
  expect(await bulle.evaluate(() => window.Verbe.fixWords('On ouvre slide fabrique.'))).toBe('On ouvre SlideFabrik.');
  expect(await bulle.evaluate(() => window.Verbe.wholeSnippet('Insère ma signature.'))).toBe('Landry\nVerbe');
  expect(await bulle.evaluate(() => window.Verbe.wordsPrompt())).toBe('SlideFabrik.');
});
