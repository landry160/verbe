// « Ce qu'il te reste » : estimation par Verbe, chiffres de Groq, alerte quand ça baisse, limite atteinte.
const { test, expect, REGLAGES, ouvrir, attendreEtat, dicter } = require('./aides');

const lire = page =>
  page.evaluate(() => {
    const t = s => document.querySelector(s).textContent.replace(/\s+/g, ' ').trim();
    return {
      corps: document.querySelector('#quota-body').innerText.replace(/\s+/g, ' ').trim(), // innerText : garde les espaces entre les lignes
      source: t('#quota-src'),
      resume: t('[data-sum="transcription"]'),
      pastille: t('#chips .chip'),
      alerte: document.querySelector('#chips .chip').classList.contains('warn'),
    };
  });
// dicter avec le micro flottant, comme une personne dans Réglages
const parLeMicroFlottant = page => ({ demarrer: () => page.click('#dock'), arreter: () => page.click('#dock') });

test('au départ, Verbe estime ; après une dictée, une requête et au moins 10 s d’audio en moins', async ({ page }) => {
  await ouvrir(page, { hash: '#reglages/transcription' });
  const q = await lire(page);
  expect(q.corps).toMatch(/2 000 requêtes sur 2 000/);
  expect(q.corps).toMatch(/8 h 00 d’audio sur 8 h 00/);
  expect(q.source).toMatch(/Estimé par Verbe/);
  expect(q.resume).toMatch(/^Groq · .*restantes$/);

  await dicter(page, parLeMicroFlottant(page));
  await expect.poll(async () => (await lire(page)).corps).toMatch(/1 999 requêtes/);
  expect((await lire(page)).corps).toMatch(/7 h 59 d’audio/);
});

test('quand les en-têtes de Groq sont lisibles (app bureau), ses chiffres passent avant l’estimation', async ({ page, groq }) => {
  groq.entetes = {
    'x-ratelimit-limit-requests': '2000',
    'x-ratelimit-remaining-requests': '1712',
    'x-ratelimit-reset-requests': '3h12m5s',
    'access-control-expose-headers': 'x-ratelimit-limit-requests, x-ratelimit-remaining-requests, x-ratelimit-reset-requests',
  };
  await ouvrir(page, { hash: '#reglages/transcription' });
  await dicter(page, parLeMicroFlottant(page));
  await expect.poll(async () => (await lire(page)).corps).toMatch(/1 712 requêtes sur 2 000/);
  const q = await lire(page);
  expect(q.source).toMatch(/Selon Groq \(forfait gratuit\)/);
  expect(q.source).toMatch(/Remise à zéro des requêtes dans 3 h 1\d/);
  expect(q.pastille, 'rien sur Dicter tant qu’il en reste assez').not.toMatch(/restantes/);
});

test('sous 15 % d’audio, la pastille de Dicter prévient', async ({ page }) => {
  await ouvrir(page, {
    avant: () => {
      const maintenant = Date.now();
      const journal = [];
      for (let i = 0; i < 30; i++) journal.push([maintenant - 300000 - i * 2400000, 'groq', 850]); // 7 h 05 envoyées en 24 h
      localStorage.setItem('verbe.usage', JSON.stringify(journal));
    },
  });
  const q = await lire(page);
  expect(q.pastille).toBe('Groq · 55 min d’audio restantes');
  expect(q.alerte).toBe(true);
});

test('limite atteinte : Verbe dit quand réessayer et garde l’audio', async ({ page, groq }) => {
  groq.statut = 429;
  groq.entetes = { 'retry-after': '1800', 'access-control-expose-headers': 'retry-after' };
  await ouvrir(page, { hash: '#reglages/transcription' });
  await page.click('#dock');
  await attendreEtat(page, 'recording');
  await page.waitForTimeout(1200);
  await page.click('#dock');
  await page.waitForFunction(() => window.Verbe.Island.state === 'error', null, { timeout: 12000 });
  const d = await page.evaluate(() => window.Verbe.Island.data);
  expect(d.text).toMatch(/Limite atteinte chez Groq/);
  expect(d.hint).toMatch(/Réessaie dans 30 min\. Ton audio est gardé/);
});

test('OpenAI est payé à l’usage : pas de plafond affiché', async ({ page }) => {
  await ouvrir(page, { hash: '#reglages/transcription', reglages: { ...REGLAGES, provider: 'openai', keys: { openai: 'sk-test' } } });
  expect((await lire(page)).source).toMatch(/payé à l’usage/);
});
