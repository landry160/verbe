// Version bureau (Electron, Windows) : la bulle, ses formes, la réparation des réglages, le collage, le presse-papiers.
// L'app tourne dans un profil à part (--profil=) : les vrais réglages ne sont jamais touchés.
// Aucune dictée et aucun collage réel : on ne joue que l'aperçu de la bulle.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');

const RACINE = path.join(__dirname, '..', '..');
const attendre = ms => new Promise(r => setTimeout(r, ms));

test.describe.configure({ mode: 'serial' });

let app;
let principale;
let bulle;
let profil;
const erreurs = [];

const pret = page => page.waitForFunction(() => window.Verbe && window.Verbe.Settings);

// Où est la bulle, par rapport à la zone utile de l'écran (sans la barre des tâches) ?
const infoBulle = () =>
  app.evaluate(({ BrowserWindow, screen }) => {
    const b = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('bulle=1'));
    const r = b.getBounds();
    const zone = screen.getDisplayMatching(r).workArea;
    return { visible: b.isVisible(), x: r.x + r.width / 2 - zone.x, y: r.y + r.height / 2 - zone.y, l: zone.width, h: zone.height };
  });

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

test('l’app tourne dans un profil à part, jamais dans les vrais réglages', async () => {
  expect(await app.evaluate(({ app: a }) => a.getPath('userData'))).toBe(profil);
});

test('la bulle est en bas par défaut, et se place en haut ou au centre aussitôt', async () => {
  expect(await principale.evaluate(() => window.Verbe.Settings.d.islandPos)).toBe('bottom');
  await principale.evaluate(() => { location.hash = '#reglages/bulle'; });
  const placer = async (position, bonne) => {
    await principale.click(`[data-setting="islandPos"] button[data-value="${position}"]`);
    await expect.poll(async () => { const i = await infoBulle(); return i.visible && bonne(i); }, { message: position, timeout: 6000 }).toBe(true);
    return infoBulle();
  };
  const bas = await placer('bottom', i => i.y > i.h * 0.7);
  expect(Math.abs(bas.x - bas.l / 2), 'centrée horizontalement').toBeLessThan(2);
  await placer('top', i => i.y < i.h * 0.3);
  await placer('center', i => Math.abs(i.y - i.h / 2) < i.h * 0.1);
  await expect.poll(async () => (await infoBulle()).visible, { message: 'fin de l’aperçu', timeout: 25_000 }).toBe(false);
});

test('les formes Onde, Points et Barres passent dans la bulle', async () => {
  await expect(principale.locator('#style-label')).toBeVisible(); // le choix de la forme existe dans le bureau
  for (const forme of ['onde', 'points', 'barres']) {
    await principale.click(`[data-setting="islandStyle"] button[data-value="${forme}"]`);
    await expect
      .poll(async () => (await bulle.evaluate(() => window.Verbe.Settings.d.islandStyle)) === forme && (await infoBulle()).visible, { message: forme, timeout: 6000 })
      .toBe(true);
  }
  await expect.poll(async () => (await infoBulle()).visible, { message: 'fin de l’aperçu', timeout: 25_000 }).toBe(false);
});

test('dans le bureau, Général dit « sur cet ordi » (pas « dans ce navigateur »)', async () => {
  await principale.evaluate(() => { location.hash = '#reglages/general'; });
  const pane = principale.locator('.pane[data-sec="general"]');
  await expect(pane).toBeVisible();
  const texte = await pane.innerText();
  expect(texte).toContain('sur cet ordi');
  expect(texte).not.toContain('dans ce navigateur');
});

test('des réglages abîmés (Ctrl + Maj + K, collage coupé) sont réparés une seule fois', async () => {
  await principale.evaluate(() =>
    localStorage.setItem('verbe.reglages.v1', JSON.stringify({
      provider: 'groq', keys: { groq: 'cle-de-test' }, scV: 2, islandPos: 'bottom', autoPaste: false,
      shortcut: { ctrl: true, shift: true, alt: false, meta: false, code: 'KeyK', key: 'K' },
    })),
  );
  await principale.reload();
  await pret(principale);
  const d = await principale.evaluate(() => {
    const r = window.Verbe.Settings.d;
    return { raccourci: r.shortcut.code, collage: r.autoPaste, position: r.islandPos, cle: r.keys.groq, fixV: JSON.parse(localStorage.getItem('verbe.reglages.v1')).fixV };
  });
  expect(d).toEqual({ raccourci: 'KeyL', collage: true, position: 'bottom', cle: 'cle-de-test', fixV: 1 });

  // un choix fait après la réparation est respecté (et on recoupe le collage pour la suite des tests)
  await principale.evaluate(() => { window.Verbe.Settings.d.autoPaste = false; window.Verbe.Settings.save(); });
  await principale.reload();
  await pret(principale);
  expect(await principale.evaluate(() => window.Verbe.Settings.d.autoPaste)).toBe(false);
});

test('le collage passe par SendInput (user32), sans lancer PowerShell ni aucun programme', async () => {
  expect(await app.evaluate(() => global.verbePingKeyer())).toBe('pong');
  expect(fs.readFileSync(path.join(RACINE, 'bureau/main.js'), 'utf8')).not.toMatch(/child_process/);
});

test('après un collage, le presse-papiers d’avant revient, sauf si on a recopié entre-temps', async () => {
  // le presse-papiers de la personne qui lance les tests, remis tel quel à la fin
  const avant = await app.evaluate(({ clipboard }) => {
    const image = clipboard.readImage();
    return { formats: clipboard.availableFormats(), text: clipboard.readText(), html: clipboard.readHTML(), rtf: clipboard.readRTF(), image: image.isEmpty() ? '' : image.toDataURL() };
  });
  test.skip(avant.formats.some(f => /FileName|FileGroupDescriptor|HDROP|uri-list/i.test(f)), 'des fichiers sont copiés : on ne touche pas au presse-papiers');
  const lire = () => app.evaluate(({ clipboard }) => ({ texte: clipboard.readText(), html: clipboard.readHTML() }));
  try {
    // 1. collage normal : ce qu'on avait copié revient une seconde après
    await app.evaluate(({ clipboard }) => {
      clipboard.writeText('Ce que tu avais copié');
      global.verbeClipboard.save();
      clipboard.writeText('Texte dicté');
      global.verbeClipboard.restore('Texte dicté');
    });
    expect((await lire()).texte).toBe('Texte dicté');
    await expect.poll(async () => (await lire()).texte, { timeout: 4000 }).toBe('Ce que tu avais copié');

    // 2. la mise en forme revient aussi
    await app.evaluate(({ clipboard }) => {
      clipboard.write({ text: 'Gras', html: '<b>Gras</b>' });
      global.verbeClipboard.save();
      clipboard.writeText('Dicté 2');
      global.verbeClipboard.restore('Dicté 2');
    });
    await expect.poll(async () => (await lire()).html, { timeout: 4000 }).toMatch(/<b>Gras<\/b>/);

    // 3. une copie faite entre-temps est respectée
    await app.evaluate(({ clipboard }) => {
      clipboard.writeText('Ancien');
      global.verbeClipboard.save();
      clipboard.writeText('Dicté 3');
      global.verbeClipboard.restore('Dicté 3');
    });
    await attendre(300);
    await app.evaluate(({ clipboard }) => clipboard.writeText('Nouvelle copie'));
    await attendre(1500);
    expect((await lire()).texte).toBe('Nouvelle copie');
  } finally {
    await app.evaluate(({ clipboard, nativeImage }, a) => {
      const contenu = {};
      if (a.text) contenu.text = a.text;
      if (a.html) contenu.html = a.html;
      if (a.rtf) contenu.rtf = a.rtf;
      if (a.image) contenu.image = nativeImage.createFromDataURL(a.image);
      if (Object.keys(contenu).length) clipboard.write(contenu);
      else clipboard.clear();
    }, avant);
  }
});
