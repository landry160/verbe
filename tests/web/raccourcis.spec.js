// Recoller la dernière dictée et Réécrire la sélection : des raccourcis globaux, qui n'existent que dans la
// version bureau. Dans le navigateur, leurs réglages sont cachés (le bouton Copier fait déjà le travail).
const { test, expect, ouvrir } = require('./aides');

test('dans le navigateur, Recoller et Réécrire n’apparaissent pas dans Réglages › Raccourci', async ({ page }) => {
  await ouvrir(page, { hash: '#reglages/raccourci' });
  const pane = page.locator('.pane[data-sec="raccourci"]');
  await expect(pane).toBeVisible();
  await expect(page.locator('#sc-actions')).toBeAttached(); // présent dans la page, mais caché
  await expect(page.locator('#sc-actions')).toBeHidden();
  const texte = await pane.innerText();
  expect(texte).toContain('Démarrer et arrêter la dictée');
  expect(texte).not.toMatch(/Recoller|Réécrire/);
  expect(await page.locator('[data-sum="raccourci"]').textContent()).not.toMatch(/Recoller|Réécrire/);
});

test('dans le navigateur, le raccourci de la dictée se change toujours, sans être gêné par ceux du bureau', async ({ page }) => {
  await ouvrir(page, { hash: '#reglages/raccourci' });
  await page.click('#btn-sc');
  // Ctrl + Maj + 9 est la combinaison proposée pour Recoller dans le bureau : ici, elle est libre
  await page.keyboard.press('Control+Shift+Digit9');
  await expect(page.locator('#sc-status')).toHaveText('Raccourci enregistré.');
  expect(await page.evaluate(() => window.Verbe.Settings.d.shortcut.code)).toBe('Digit9');
});
