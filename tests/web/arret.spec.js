// Arrêt automatique quand on ne parle plus : le micro est libéré pour les autres apps.
// Le faux micro joue un son continu ; pour faire « silence », on coupe la piste du micro dans la page
// (une piste coupée ne donne plus que du silence), puis on attend le délai choisi.
const { test, expect, REGLAGES, ouvrir, attendreEtat } = require('./aides');

const couperLeSon = page => page.evaluate(() => {
  window.__piste = window.Verbe.Rec.stream.getAudioTracks()[0];
  window.__piste.enabled = false;
});
const micLibere = page => page.evaluate(() => window.Verbe.Rec.stream === null && window.__piste.readyState === 'ended');

test('par défaut : arrêt après 20 s de silence, réglable dans Réglages › Micro', async ({ page }) => {
  await ouvrir(page, { hash: '#reglages/micro' });
  expect(await page.evaluate(() => window.Verbe.Settings.d.autoStop)).toBe('20');
  await expect(page.locator('[data-setting="autoStop"] button[aria-pressed="true"]')).toHaveText('20 s');
  await page.click('[data-setting="autoStop"] button[data-value="60"]');
  expect(await page.evaluate(() => window.Verbe.Settings.d.autoStop)).toBe('60');
  await expect(page.locator('[data-sum="micro"]')).toContainText('arrêt après 1 min');
});

test('on a parlé puis plus rien : Verbe s’arrête, transcrit, copie et libère le micro', async ({ page, groq }) => {
  await ouvrir(page, { reglages: { ...REGLAGES, autoStop: '2' } }); // 2 s pour le test (l'écran propose 10 s à 1 min)
  await page.evaluate(() => window.Verbe.App.toggle());
  await attendreEtat(page, 'recording');
  // de la « voix » : on attend qu'elle soit vraiment entendue (pas un délai fixe, qui échoue sous forte charge)
  await page.waitForFunction(() => window.Verbe.Rec.voiced >= 8, null, { timeout: 8000 });
  await couperLeSon(page);
  await attendreEtat(page, 'idle', 12000); // personne n'a appuyé sur le raccourci
  expect(groq.transcriptions).toBe(1);
  expect(await page.evaluate(() => window.Verbe.App.last && window.Verbe.App.last.text)).toBe('Bonjour, ceci est un test de Verbe.');
  expect(await page.evaluate(() => window.__copies)).toContain('Bonjour, ceci est un test de Verbe.');
  expect(await micLibere(page)).toBe(true);
});

test('rien entendu du tout : Verbe s’arrête sans rien envoyer et le dit', async ({ page, groq }) => {
  await ouvrir(page, { reglages: { ...REGLAGES, autoStop: '1' } });
  await page.evaluate(() => window.Verbe.App.toggle());
  await attendreEtat(page, 'recording');
  await couperLeSon(page);
  await page.evaluate(() => { window.Verbe.Rec.voiced = 0; }); // oublie le son entendu avant la coupure
  await attendreEtat(page, 'idle', 6000);
  expect(await micLibere(page)).toBe(true);
  await page.waitForTimeout(500);
  expect(groq.transcriptions, 'aucun audio envoyé').toBe(0);
  const ile = await page.evaluate(() => window.Verbe.Island.data);
  expect(ile.text).toBe('Je n’ai rien entendu.');
  expect(ile.hint).toBe('Micro libéré après 1 s sans voix.');
});

test('« Jamais » : Verbe continue d’écouter, même en silence', async ({ page, groq }) => {
  await ouvrir(page, { reglages: { ...REGLAGES, autoStop: '0' } });
  await page.evaluate(() => window.Verbe.App.toggle());
  await attendreEtat(page, 'recording');
  await couperLeSon(page);
  await page.waitForTimeout(2500);
  expect(await page.evaluate(() => window.Verbe.App.state)).toBe('recording');
  expect(groq.transcriptions).toBe(0);
  await page.keyboard.press('Escape');
  await attendreEtat(page, 'idle', 3000);
});
