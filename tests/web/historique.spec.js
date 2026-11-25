// Historique : deux lectures qui se croisent ne remettent jamais une liste périmée.
const { test, expect, ouvrir } = require('./aides');

test('une dictée finie avant que l’historique soit ouvert est quand même gardée (premier démarrage lent)', async ({ page }) => {
  await ouvrir(page);
  const textes = await page.evaluate(async () => {
    const { App, Store } = window.Verbe;
    Store.db = null; Store.opening = null; // comme au tout premier démarrage : la base n'est pas encore ouverte
    const item = App.newItem({ source: 'micro', durationMs: 1000 });
    await App.finish(item, 'Gardée malgré tout.', performance.now());
    return (await Store.all()).map(i => i.text);
  });
  expect(textes).toContain('Gardée malgré tout.');
  await page.evaluate(() => { location.hash = '#historique'; });
  await expect(page.locator('#h-list')).toContainText('Gardée malgré tout.');
});

test('une lecture lente de l’historique ne remet pas une liste périmée (dictée arrivée pendant la lecture)', async ({ page }) => {
  await ouvrir(page);
  const ids = await page.evaluate(async () => {
    const { Store, App, loadHistory } = window.Verbe;
    const vrai = Store.all.bind(Store);
    let premier = true;
    // la première lecture lit la liste, puis tarde à la rendre (une fenêtre qui démarre sous forte charge)
    Store.all = async () => { const r = await vrai(); if (premier) { premier = false; await new Promise(s => setTimeout(s, 400)); } return r; };
    const lente = loadHistory();
    await new Promise(s => setTimeout(s, 50));
    // pendant ce temps, l'autre fenêtre enregistre une dictée et prévient
    await Store.put({ id: 'arrivee-pendant', createdAt: Date.now(), text: 'Arrivée pendant la lecture.', status: 'ok', error: '', source: 'micro', durationMs: 1000, words: 4, hasAudio: false });
    await loadHistory({ quiet: true });
    await lente;
    Store.all = vrai;
    return App.items.map(i => i.id);
  });
  expect(ids).toContain('arrivee-pendant');
  await expect(page.locator('#last-text')).toHaveValue('Arrivée pendant la lecture.');
});
