// Version bureau : la bulle fait la dictée, la fenêtre principale montre le compte (Historique) à jour.
// Profil à part (--profil=) ; ni vraie touche, ni vrai presse-papiers : la copie et le collage sont remplacés
// par des faux dans le processus principal, et la dictée part du texte déjà « transcrit » (aucun service appelé).
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
const copies = [];

const pret = page => page.waitForFunction(() => window.Verbe && window.Verbe.Settings && window.Verbe.Stats);

test.beforeAll(async () => {
  profil = fs.mkdtempSync(path.join(os.tmpdir(), 'verbe-profil-progres-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: require('electron'), args: [RACINE, `--profil=${profil}`], env });
  await expect.poll(() => app.windows().length, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
  principale = app.windows().find(w => !w.url().includes('bulle=1'));
  bulle = app.windows().find(w => w.url().includes('bulle=1'));
  principale.on('pageerror', e => erreurs.push(`fenêtre principale : ${e.message}`));
  bulle.on('pageerror', e => erreurs.push(`bulle : ${e.message}`));
  await pret(principale);
  await pret(bulle);
  // faux presse-papiers et faux collage : rien ne sort vers Windows
  await app.evaluate(({ ipcMain }) => {
    global.__copiesTest = [];
    ipcMain.removeHandler('verbe:copy');
    ipcMain.handle('verbe:copy', (e, texte) => { global.__copiesTest.push(String(texte)); return true; });
    ipcMain.removeHandler('verbe:paste');
    ipcMain.handle('verbe:paste', () => false);
  });
  await principale.evaluate(() => { window.Verbe.Settings.d.autoPaste = false; window.Verbe.Settings.d.sounds = false; window.Verbe.Settings.save(); });
});

test.afterAll(async () => {
  if (app) await app.close().catch(() => {});
  if (profil) fs.rmSync(profil, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
});

test.afterEach(() => {
  expect(erreurs, 'erreurs JavaScript').toEqual([]);
});

/** Une dictée réussie dans la bulle : le texte arrive comme s'il venait du service, puis le chemin normal (compte, historique, copie). */
const dicteeDansLaBulle = (texte, durationMs) =>
  bulle.evaluate(async ([t, ms]) => {
    const { App } = window.Verbe;
    const item = App.newItem({ source: 'micro', durationMs: ms });
    await App.finish(item, t, performance.now());
    return item.words;
  }, [texte, durationMs]);

test('la fenêtre principale affiche le compte après des dictées faites dans la bulle', async () => {
  await principale.evaluate(() => { location.hash = '#historique'; });
  await expect(principale.locator('#v-historique')).toBeVisible();
  await expect(principale.locator('#h-prog'), 'rien avant la première dictée').toBeHidden();

  // la bulle relit les réglages (collage coupé) avant de dicter
  await expect.poll(() => bulle.evaluate(() => window.Verbe.Settings.d.autoPaste)).toBe(false);

  expect(await dicteeDansLaBulle('Un deux trois quatre cinq six sept huit', 2000)).toBe(8);
  await expect(principale.locator('#h-prog-line')).toContainText('8 mots dictés');
  await expect(principale.locator('#h-list')).toContainText('Un deux trois');

  // une deuxième : le compte de la bulle s'ajoute, rien n'est écrasé
  expect(await dicteeDansLaBulle('Neuf dix onze douze', 1000)).toBe(4);
  await expect(principale.locator('#h-prog-line')).toContainText('12 mots dictés');
  expect(await principale.evaluate(() => window.Verbe.Stats.read())).toMatchObject({ n: 2, w: 12, ms: 3000 });
  // la copie est passée par le faux presse-papiers
  copies.push(...(await app.evaluate(() => global.__copiesTest)));
  expect(copies).toHaveLength(2);
});
