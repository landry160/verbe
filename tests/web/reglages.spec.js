// Réglages : une section à la fois, en-tête aligné, téléphone, position de la bulle par défaut.
const { test, expect, REGLAGES, ouvrir, rouvrir } = require('./aides');

const SECTIONS = ['transcription', 'micro', 'raccourci', 'texte', 'bulle', 'general'];
const sectionsVisibles = page => page.evaluate(() => [...document.querySelectorAll('#v-reglages .pane')].filter(p => p.offsetParent).map(p => p.dataset.sec));
const resume = (page, sec) => page.evaluate(s => document.querySelector(`[data-sum="${s}"]`).textContent.replace(/\s+/g, ' ').trim(), sec);

test('le logo et le menu sont alignés sur le contenu', async ({ page }) => {
  await ouvrir(page, { hash: '#reglages' });
  for (const [width, height] of [[2560, 1300], [1536, 864]]) {
    await page.setViewportSize({ width, height });
    const a = await page.evaluate(() => {
      const r = s => document.querySelector(s).getBoundingClientRect();
      return { logo: r('.brand').left, gauche: r('.reg').left, menu: r('.tabs').right, droite: r('.reg').right };
    });
    expect.soft(Math.abs(a.logo - a.gauche), `${width} px : logo / contenu`).toBeLessThanOrEqual(1);
    expect.soft(Math.abs(a.menu - a.droite), `${width} px : menu / contenu`).toBeLessThanOrEqual(1);
  }
});

test('une section à la fois, chacune résumée dans la liste', async ({ page }) => {
  await ouvrir(page, { hash: '#reglages' });
  for (const s of SECTIONS) {
    await page.click(`.reg-tab[data-sec="${s}"]`);
    await expect.poll(() => sectionsVisibles(page), { message: s }).toEqual([s]);
  }
  expect(await resume(page, 'transcription')).toBe('Groq · 8 h 00 restantes');
  expect(await resume(page, 'raccourci')).toMatch(/Ctrl\s*Maj\s*L/);
  expect(await resume(page, 'bulle')).toBe('Barres · en bas');
});

test('un lien direct ouvre la bonne section', async ({ page }) => {
  await ouvrir(page, { hash: '#reglages/micro' });
  await expect.poll(() => sectionsVisibles(page)).toEqual(['micro']);
});

test('dans le navigateur, Général dit « dans ce navigateur » (pas « sur cet ordi »)', async ({ page }) => {
  await ouvrir(page, { hash: '#reglages/general' });
  const pane = page.locator('.pane[data-sec="general"]');
  await expect(pane).toBeVisible();
  const texte = await pane.innerText();
  expect(texte).toContain('dans ce navigateur');
  expect(texte).not.toContain('sur cet ordi');
});

test('toucher la forme « Onde » lance l’aperçu tout de suite', async ({ page }) => {
  await ouvrir(page, { hash: '#reglages/bulle' });
  await page.click('[data-setting="islandStyle"] [data-value="onde"]');
  await expect
    .poll(() => page.evaluate(() => ({ etat: window.Verbe.Island.state, forme: window.Verbe.Settings.d.islandStyle })))
    .toEqual({ etat: 'recording', forme: 'onde' });
});

test('sans clé, Réglages s’ouvre sur Transcription', async ({ page }) => {
  await ouvrir(page, { reglages: { ...REGLAGES, keys: { groq: '' } }, avant: () => localStorage.setItem('verbe.section', 'bulle') });
  await page.click('.tab[data-v="reglages"]');
  await expect.poll(() => sectionsVisibles(page)).toEqual(['transcription']);
});

test('sur ordinateur, la liste et la section sont ensemble, sans bouton retour', async ({ page }) => {
  await ouvrir(page, { hash: '#reglages' });
  await expect(page.locator('.reg-list')).toBeVisible();
  await expect.poll(async () => (await sectionsVisibles(page)).length).toBe(1);
  await expect(page.locator('.pane-back:visible')).toHaveCount(0);
});

test('nouvelle installation : la bulle est en bas au centre', async ({ page }) => {
  await ouvrir(page, { reglages: null });
  expect(await page.evaluate(() => window.Verbe.Settings.d.islandPos)).toBe('bottom');
});

test('l’ancien « Centre » passe une fois à « Bas » ; « Centre » choisi ensuite est respecté', async ({ page }) => {
  await ouvrir(page, { reglages: { provider: 'groq', keys: { groq: 'gsk_test' }, islandPos: 'center', scV: 2, fixV: 1 } });
  expect(await page.evaluate(() => window.Verbe.Settings.d.islandPos), 'ancien « Centre »').toBe('bottom');

  await page.evaluate(() => { const S = window.Verbe.Settings; S.d.islandPos = 'center'; S.save(); });
  const plusTard = await rouvrir(page);
  expect(await plusTard.evaluate(() => window.Verbe.Settings.d.islandPos), '« Centre » choisi ensuite').toBe('center');
});

test.describe('sur téléphone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('Réglages ouvre la liste des 6 sections, chacune avec son état', async ({ page }) => {
    await ouvrir(page, { hash: '#reglages' });
    await expect(page.locator('.reg-list')).toBeVisible();
    await expect(page.locator('.reg-tab:visible')).toHaveCount(6);
    expect(await sectionsVisibles(page)).toEqual([]);
    expect(await resume(page, 'raccourci')).toMatch(/Ctrl\s*Maj\s*L/);
    await expect(page.locator('[data-sum="bulle"]')).toBeVisible();
    expect((await page.locator('#t-reg').boundingBox()).height, 'grand titre « Réglages »').toBeGreaterThan(30);
  });

  test('toucher une section l’ouvre ; « ‹ Réglages » et le retour du téléphone ramènent à la liste', async ({ page }) => {
    await ouvrir(page, { hash: '#reglages' });
    await page.click('.reg-tab[data-sec="micro"]');
    await expect(page).toHaveURL(/#reglages\/micro$/);
    await expect.poll(() => sectionsVisibles(page)).toEqual(['micro']);
    await expect(page.locator('.reg-list')).toBeHidden();

    await page.locator('.pane-back:visible').click();
    await expect(page.locator('.reg-list')).toBeVisible();
    expect(await sectionsVisibles(page)).toEqual([]);

    await page.click('.reg-tab[data-sec="texte"]');
    await expect.poll(() => sectionsVisibles(page)).toEqual(['texte']);
    await page.goBack();
    await expect(page.locator('.reg-list')).toBeVisible();
  });

  test('pas de défilement sur le côté', async ({ page }) => {
    await ouvrir(page, { hash: '#reglages/texte' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});
