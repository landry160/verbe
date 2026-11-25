// Verbe installable (téléphone, ordi) : la fiche de l'app, le service qui la garde pour le hors connexion,
// le bouton « Installer » et la marche à suivre sur iPhone.
const { test, expect, ouvrir } = require('./aides');

test.use({ serviceWorkers: 'allow' });

test('la fiche de l’app est complète et ses icônes existent', async ({ page, request }) => {
  await ouvrir(page);
  const lien = await page.locator('link[rel="manifest"]').getAttribute('href');
  const fiche = await (await request.get('/app/' + lien)).json();
  expect(fiche.short_name).toBe('Verbe');
  expect(fiche.display).toBe('standalone');
  expect(fiche.start_url).toContain('verbe.html');
  const tailles = fiche.icons.map(i => `${i.sizes} ${i.purpose}`);
  expect(tailles).toEqual(expect.arrayContaining(['192x192 any', '512x512 any', '512x512 maskable']));
  for (const src of [...fiche.icons.map(i => i.src), await page.locator('link[rel="apple-touch-icon"]').getAttribute('href')]) {
    const r = await request.get('/app/' + src);
    expect(r.status(), src).toBe(200);
    expect(r.headers()['content-type']).toBe('image/png');
    expect((await r.body()).length, src).toBeGreaterThan(1000);
  }
});

test('Verbe s’ouvre sans réseau une fois visité', async ({ page, context }) => {
  await ouvrir(page);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });
  await context.setOffline(true);
  try {
    const onglet = await context.newPage(); // « revenir plus tard » : un nouvel onglet, la page déjà ouverte reste
    await onglet.goto('/app/verbe.html#dicter');
    await onglet.waitForFunction(() => window.Verbe && window.Verbe.App);
    await expect(onglet.locator('#app-version')).toHaveText(await page.evaluate(() => window.Verbe.VERSION));
    // la police aussi vient de la copie gardée
    expect(await onglet.evaluate(async () => (await fetch('fonts/inter-latin.woff2')).ok)).toBe(true);
  } finally {
    await context.setOffline(false);
  }
});

test('le service ne touche jamais aux appels de transcription', async ({ page }) => {
  await ouvrir(page);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });
  const sw = await (await page.request.get('/app/sw.js')).text();
  expect(sw).toMatch(/origin !== self\.location\.origin\) return/);
  const gardes = await page.evaluate(async () => (await (await caches.open('verbe-v1')).keys()).map(r => new URL(r.url).pathname));
  expect(gardes).toContain('/app/verbe.html');
  expect(gardes.every(p => p.startsWith('/app/'))).toBe(true);
});

test('le navigateur propose l’installation : le bouton apparaît et ouvre la fenêtre d’installation', async ({ page }) => {
  await ouvrir(page, { hash: '#reglages/general' });
  await expect(page.locator('#install-row')).toBeHidden(); // rien tant que le navigateur ne la propose pas
  await page.evaluate(() => {
    const e = new Event('beforeinstallprompt', { cancelable: true });
    window.__invite = 0;
    e.prompt = () => { window.__invite++; };
    e.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(e);
  });
  await expect(page.locator('#install-row')).toBeVisible();
  await page.locator('#btn-install').click();
  await expect.poll(() => page.evaluate(() => window.__invite)).toBe(1);
  await expect(page.locator('#install-row')).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(page.locator('.toast').filter({ hasText: 'Verbe est installé' })).toBeVisible();
});

test('déjà installé (ouvert depuis l’icône) : plus rien sur l’installation', async ({ page }) => {
  await ouvrir(page, { hash: '#reglages/general' });
  // ouverture depuis l'icône : un nouvel onglet où la page se voit en « display-mode: standalone »
  const onglet = await page.context().newPage();
  await onglet.addInitScript(() => {
    const vrai = window.matchMedia.bind(window);
    window.matchMedia = q => (q === '(display-mode: standalone)' ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : vrai(q));
  });
  await onglet.goto('/app/verbe.html#reglages/general');
  await onglet.waitForFunction(() => window.Verbe && window.Verbe.App);
  await onglet.evaluate(() => {
    const e = new Event('beforeinstallprompt', { cancelable: true });
    e.prompt = () => {};
    e.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(e);
  });
  await expect(onglet.locator('#install-row')).toBeHidden();
});

test('de retour sur le site après la 0.6.0 : la fenêtre des Nouveautés annonce l’installation, et rien de propre à Windows', async ({ page }) => {
  await ouvrir(page, { avant: () => localStorage.setItem('verbe.nouveautes', '0.6.0') });
  await expect(page.locator('#news')).toBeVisible();
  await expect(page.locator('#news-title')).toHaveText('Verbe s’installe sur ton téléphone');
  await expect(page.locator('#news .news-dots i')).toHaveCount(1); // pas « L’historique toujours à jour » (0.6.1, Windows)
  await page.locator('#news [data-n="next"]').click();
  await expect(page.locator('#news')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('verbe.nouveautes'))).toBe(await page.evaluate(() => window.Verbe.VERSION));
});

test.describe('sur iPhone', () => {
  test.use({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
  });

  test('la marche à suivre dans Safari est affichée, sans bouton qui ne ferait rien', async ({ page }) => {
    await ouvrir(page, { hash: '#reglages/general' });
    await expect(page.locator('#install-row')).toBeVisible();
    await expect(page.locator('#install-help')).toContainText('Sur l’écran d’accueil');
    await expect(page.locator('#btn-install')).toBeHidden();
  });
});
