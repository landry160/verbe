// La bulle ne doit jamais bloquer : ses clics ne dépendent plus d'un crochet sur la souris de Windows
// (il sautait quand l'ordi gelait, et « Terminer » ne répondait plus), le menu de l'icône offre toujours
// une sortie pendant l'écoute, et une bulle plantée est refaite à neuf (micro et Échap rendus).
// Profil à part et faux clavier (--essai-clavier) : aucune vraie touche, aucun vrai raccourci pris à Windows.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');

const RACINE = path.join(__dirname, '..', '..');

test.describe.configure({ mode: 'serial' });

let app, principale, profil;
const erreurs = [];
const pret = page => page.waitForFunction(() => window.Verbe && window.Verbe.Settings);
const bulle = () => app.windows().find(w => w.url().includes('bulle=1') && !w.isClosed());
const souris = () => app.evaluate(() => global.verbeSouris.etat());
const menu = () => app.evaluate(() => global.verbeMaj.menu());
const echapPris = () => app.evaluate(() => global.verbeEssai.raccourcis.has('Escape'));

test.beforeAll(async () => {
  profil = fs.mkdtempSync(path.join(os.tmpdir(), 'verbe-profil-test-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: require('electron'), args: [RACINE, `--profil=${profil}`, '--essai-clavier'], env });
  await expect.poll(() => app.windows().length, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
  principale = app.windows().find(w => !w.url().includes('bulle=1'));
  principale.on('pageerror', e => erreurs.push(`fenêtre principale : ${e.message}`));
  await pret(principale);
  await pret(bulle());
  await principale.evaluate(() => { window.Verbe.Settings.d.autoPaste = false; window.Verbe.Settings.save(); });
});

test.afterAll(async () => {
  if (app) await app.close().catch(() => {});
  if (profil) fs.rmSync(profil, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
});

test.afterEach(() => {
  expect(erreurs, 'erreurs JavaScript').toEqual([]);
});

test('aucun crochet sur la souris de Windows : la bulle ne dépend plus du « forward » d’Electron', async () => {
  const code = fs.readFileSync(path.join(RACINE, 'bureau', 'main.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  expect(code).not.toMatch(/forward\s*:/);
});

test('la pastille reçoit les clics seulement quand le curseur est dessus, et rien quand la bulle est cachée', async () => {
  expect((await souris()).suivi, 'rien ne tourne tant que la bulle est cachée').toBe(false);
  await principale.evaluate(() => { location.hash = '#reglages/bulle'; });
  await principale.click('[data-setting="islandStyle"] button[data-value="onde"]'); // aperçu : la bulle apparaît
  await expect.poll(async () => { const s = await souris(); return s.suivi && !!s.pill; }, { timeout: 6000 }).toBe(true);

  const centre = await app.evaluate(({ BrowserWindow }) => {
    const b = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('bulle=1')).getBounds();
    const p = global.verbeSouris.etat().pill;
    return { x: b.x + p.x + p.w / 2, y: b.y + p.y + p.h / 2, haut: b.y + 2 };
  });
  // la pastille est bien là où la page la dessine
  const vraie = await bulle().evaluate(() => { const r = document.querySelector('#island .isl').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
  expect(Math.abs((await souris()).pill.w - vraie.w)).toBeLessThanOrEqual(2);

  const viser = pt => app.evaluate((_e, p) => { global.verbeCurseur = () => p; global.verbeSouris.tick(); return global.verbeSouris.etat().mouseIn; }, pt);
  expect(await viser({ x: centre.x, y: centre.y }), 'curseur sur la pastille').toBe(true);
  expect(await viser({ x: centre.x, y: centre.haut }), 'curseur dans le vide de la fenêtre, au-dessus').toBe(false);
  expect(await viser({ x: centre.x, y: centre.y }), 'de retour dessus').toBe(true);

  await expect.poll(async () => (await souris()).suivi, { message: 'fin de l’aperçu', timeout: 25_000 }).toBe(false);
  const fin = await souris();
  expect(fin.mouseIn, 'bulle cachée : les clics passent').toBe(false);
  await app.evaluate(() => { delete global.verbeCurseur; });
});

test('pendant l’écoute, le menu de l’icône offre « Terminer » et « Annuler » ; ensuite, « Dicter » revient', async () => {
  expect(await menu()).toContain('Dicter    Ctrl + Maj + L');
  await bulle().evaluate(() => window.verbeDesktop.state('recording'));
  await expect.poll(menu).toEqual(expect.arrayContaining(['Terminer la dictée    Ctrl + Maj + L', 'Annuler la dictée    Échap']));
  expect(await echapPris()).toBe(true);
  await bulle().evaluate(() => window.verbeDesktop.state('idle'));
  await expect.poll(menu).toContain('Dicter    Ctrl + Maj + L');
  expect(await echapPris()).toBe(false);
});

test('une bulle plantée pendant l’écoute est refaite : Échap rendu, menu remis, nouvelle bulle prête', async () => {
  await bulle().evaluate(() => window.verbeDesktop.state('recording'));
  await expect.poll(echapPris).toBe(true);
  const avant = (await souris()).recoveries;
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('bulle=1')).webContents.forcefullyCrashRenderer());
  await expect.poll(async () => (await souris()).recoveries, { timeout: 10_000 }).toBe(avant + 1);
  expect(await echapPris(), 'Échap rendu à Windows').toBe(false);
  expect(await menu()).toContain('Dicter    Ctrl + Maj + L');
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => w.webContents.getURL().includes('bulle=1')).length)).toBe(1);
  await pret(bulle());
  expect(await principale.evaluate(() => window.Verbe.App.state)).toBe('idle');
});
