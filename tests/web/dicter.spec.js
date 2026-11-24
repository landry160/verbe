// Dicter : le raccourci partout, le micro flottant, Échap, une page qui ne défile pas.
const { test, expect, ouvrir, rouvrir, attendreEtat } = require('./aides');

test('un ancien raccourci Ctrl + V redevient Ctrl + Maj + L, et l’accueil le dit', async ({ page }) => {
  await ouvrir(page, {
    reglages: { provider: 'groq', keys: { groq: 'gsk_test' }, floating: false, shortcut: { ctrl: true, shift: false, alt: false, meta: false, code: 'KeyV', key: 'V' } },
  });
  expect(await page.evaluate(() => window.Verbe.Settings.d.shortcut)).toMatchObject({ ctrl: true, shift: true, code: 'KeyL' });
  await expect(page.locator('.lead')).toContainText(/Ctrl\s*Maj\s*L/);
});

test('Dicter tient dans l’écran sans défiler, même avec une longue dernière dictée', async ({ page }) => {
  await ouvrir(page);
  await page.evaluate(async () => {
    const texte = 'Une longue dictée pour vérifier que la page Dicter ne défile jamais, même quand la dernière dictée prend beaucoup de place. '.repeat(4);
    await window.Verbe.Store.put({ id: 'longue', createdAt: Date.now(), text: texte, status: 'ok', error: '', source: 'micro', durationMs: 34000, fileName: '', provider: 'groq', model: 'whisper-large-v3-turbo', latencyMs: 3900, words: 120, hasAudio: false });
  });
  const verbe = await rouvrir(page);
  // la longue dictée est bien affichée : sinon le test passerait sans rien vérifier
  await expect(verbe.locator('#last-text')).toHaveValue(/^Une longue dictée/);
  for (const [width, height] of [[1536, 730], [1366, 768], [1280, 720], [1920, 1000]]) {
    await verbe.setViewportSize({ width, height });
    await expect
      .poll(() => verbe.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight), { message: `${width} × ${height}` })
      .toBeLessThanOrEqual(1);
  }
});

test('Ctrl + Maj + L démarre et arrête depuis Historique, le curseur dans la recherche', async ({ page, groq }) => {
  await ouvrir(page);
  await expect(page.locator('#dock')).toBeHidden(); // sur Dicter, le gros micro suffit
  await page.click('.tab[data-v="historique"]');
  await expect(page.locator('#dock')).toBeVisible();
  await page.click('#h-search');
  await page.keyboard.press('Control+Shift+KeyL');
  await attendreEtat(page, 'recording');
  await expect(page.locator('#dock')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(1300);
  await page.keyboard.press('Control+Shift+KeyL');
  await attendreEtat(page, 'idle', 12000);
  expect(await page.evaluate(() => window.Verbe.App.last && window.Verbe.App.last.text)).toBe('Bonjour, ceci est un test de Verbe.');
  expect(groq.transcriptions).toBe(1);
  // dans le navigateur, le texte est copié pour Ctrl + V
  expect(await page.evaluate(() => window.__copies)).toContain('Bonjour, ceci est un test de Verbe.');
});

test('Réglages : Ctrl + V est refusé comme raccourci ; Échap annule sans rien envoyer', async ({ page, groq }) => {
  await ouvrir(page, { hash: '#reglages/raccourci' });
  await expect(page.locator('#dock')).toBeVisible();
  await page.click('#btn-sc');
  await page.keyboard.press('Control+KeyV');
  await expect(page.locator('#sc-status')).toContainText('Maj');
  await page.keyboard.press('Escape');
  expect((await page.evaluate(() => window.Verbe.Settings.d.shortcut)).code).toBe('KeyL');

  await page.click('#dock');
  await attendreEtat(page, 'recording');
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape');
  await attendreEtat(page, 'idle', 3000);
  await page.waitForTimeout(600);
  expect(groq.transcriptions, 'aucun audio envoyé après Échap').toBe(0);
});

test('si une extension avale la touche (Bitwarden), le relâchement seul démarre quand même et Verbe le signale', async ({ page }) => {
  await ouvrir(page);
  await page.waitForTimeout(300);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyL', key: 'L', ctrlKey: true, shiftKey: true, bubbles: true })));
  await attendreEtat(page, 'recording');
  await expect(page.locator('.toast')).toContainText('Une extension');
  await page.keyboard.press('Escape');
  await attendreEtat(page, 'idle', 3000);
});

test.describe('sur téléphone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('Dicter et Historique ne défilent pas sur le côté', async ({ page }) => {
    await ouvrir(page);
    for (const vue of ['#dicter', '#historique']) {
      await page.evaluate(h => { location.hash = h; }, vue); // on change de vue dans Verbe, sans quitter la page
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), { message: vue })
        .toBeLessThanOrEqual(0);
    }
  });
});
