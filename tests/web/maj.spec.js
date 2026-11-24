// Mises à jour automatiques : propres à la version bureau. La version web est toujours à jour :
// rien ne doit en apparaître dans le navigateur, ni sur ordinateur ni sur téléphone.
const { test, expect, ouvrir } = require('./aides');

for (const [nom, taille] of [['ordinateur', { width: 1440, height: 900 }], ['téléphone', { width: 390, height: 844 }]]) {
  test(`version web (${nom}) : rien sur les mises à jour dans Réglages › Général`, async ({ page }) => {
    await page.setViewportSize(taille);
    await ouvrir(page, { hash: '#reglages/general' });
    const pane = page.locator('.pane[data-sec="general"]');
    await expect(pane).toBeVisible();
    await expect(page.locator('#maj-row')).toBeHidden();
    await expect(page.locator('#maj-switch')).toBeHidden();
    await expect(page.locator('#maj-redemarrer')).toBeHidden();
    const texte = await page.locator('body').innerText();
    expect(texte).not.toMatch(/mises? à jour/i);
    expect(texte).not.toContain('Redémarrer');
    expect(texte).not.toContain('Vérifier maintenant');
    expect(await page.evaluate(() => typeof window.verbeDesktop)).toBe('undefined');
  });
}
