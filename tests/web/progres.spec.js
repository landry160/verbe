// Progrès (en haut de l'Historique) : mots dictés, temps gagné estimé, série de jours (Groq simulé).
// Le compteur est à part de l'historique (localStorage « verbe.stats ») : une dictée réussie au micro compte une fois.
const { test, expect, ouvrir, rouvrir, dicter } = require('./aides');

const MOTS = 7; // « Bonjour, ceci est un test de Verbe. » (la transcription simulée par défaut)
const stats = page => page.evaluate(() => window.Verbe.Stats.read());
const ligne = page => page.locator('#h-prog-line');

// La clé « AAAA-MM-JJ » d'un jour, calculée dans la page (fuseau de Toronto) ; decalage en jours depuis aujourd'hui.
const jour = (page, decalage) =>
  page.evaluate(n => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, decalage);

test('rien n’est affiché tant qu’aucune dictée n’a réussi', async ({ page }) => {
  await ouvrir(page, { hash: '#historique' });
  await expect(page.locator('#h-list')).toContainText('Aucune dictée'); // l'historique est bien affiché
  await expect(page.locator('#h-prog')).toBeHidden();
  expect((await stats(page)).n).toBe(0);
});

test('après des dictées, les chiffres montent : mots, temps de parole, temps gagné', async ({ page }) => {
  await ouvrir(page, { hash: '#historique' });
  await dicter(page);
  let s = await stats(page);
  expect(s).toMatchObject({ n: 1, w: MOTS });
  expect(s.ms, 'la durée réelle de la dictée').toBeGreaterThan(1000);
  // tout est de cette semaine : une seule mention, sans « au total » en double
  await expect(page.locator('#h-prog')).toBeVisible();
  await expect(ligne(page)).toContainText(`${MOTS} mots dictés`);
  await expect(ligne(page)).not.toContainText('au total');

  await dicter(page);
  s = await stats(page);
  expect(s).toMatchObject({ n: 2, w: 2 * MOTS });
  await expect(ligne(page)).toContainText(`${2 * MOTS} mots dictés`);
  // temps gagné = les mots tapés à 40 mots/min, moins le temps passé à parler
  const p = await page.evaluate(() => window.Verbe.Stats.summary());
  expect(p.gainMs).toBeCloseTo(Math.max(0, (2 * MOTS * 60000) / 40 - s.ms), 0);
  expect(p.gainMs).toBeGreaterThan(0);
  await expect(ligne(page)).toContainText(/≈\s*\d+\s*s\s*gagnées/);
  // l'écran Dicter reste épuré
  await page.evaluate(() => { location.hash = '#dicter'; });
  await expect(page.locator('#v-dicter')).toBeVisible();
  await expect(page.locator('#v-dicter')).not.toContainText('gagné');
});

test('la semaine et le total se distinguent quand des dictées sont plus anciennes', async ({ page }) => {
  await ouvrir(page, {
    hash: '#historique',
    avant: () => localStorage.setItem('verbe.stats', JSON.stringify({ v: 1, n: 40, w: 2000, ms: 15 * 60000, days: { '2026-01-05': [40, 2000, 15 * 60000] } })),
  });
  // déjà là à l'ouverture : 2 000 mots, (2 000 / 40) min − 15 min = 35 min gagnées
  await expect(ligne(page)).toContainText(/2\s000\s*mots dictés au total/);
  await expect(ligne(page)).toContainText(/≈\s*35 min\s*gagnées/);
  await dicter(page);
  expect(await stats(page)).toMatchObject({ n: 41, w: 2000 + MOTS });
  await expect(ligne(page)).toContainText(`${MOTS} mots cette semaine`);
  await expect(ligne(page)).toContainText(/2\s007\s*au total/);
});

test('une dictée ratée ne compte pas ; réussie au nouvel essai, elle compte une fois, et une retranscription ne recompte pas', async ({ page, groq }) => {
  await ouvrir(page, { hash: '#historique' });
  groq.statut = 429; // le service refuse
  await dicter(page);
  groq.statut = 200;
  groq.texte = ''; // rien de reconnu
  await dicter(page);
  expect(await page.evaluate(() => window.Verbe.App.items.map(i => i.status))).toEqual(['error', 'error']);
  expect((await stats(page)).n).toBe(0);
  await expect(page.locator('#h-prog')).toBeHidden();

  // la dictée refusée, réessayée depuis son audio gardé : elle compte, une fois
  groq.texte = 'Un deux trois quatre cinq.';
  const refusee = await page.evaluate(() => window.Verbe.App.items.filter(i => i.hasAudio).pop().id); // la plus ancienne
  await page.click(`[data-retry="${refusee}"]`);
  await expect.poll(() => stats(page)).toMatchObject({ n: 1, w: 5 });
  await expect(ligne(page)).toContainText('5 mots dictés');

  // « Retranscrire » une dictée réussie ne la compte pas deux fois
  await page.evaluate(() => window.Verbe.App.items.find(i => i.status === 'ok').id).then(id => page.click(`[data-retry="${id}"]`));
  await expect.poll(() => groq.transcriptions).toBe(4);
  await page.waitForFunction(() => window.Verbe.App.state === 'idle');
  expect(await stats(page)).toMatchObject({ n: 1, w: 5 });

  // une dictée réussie gardée par une version d'avant (sans la marque « comptée ») ne compte pas non plus
  const ancienne = await page.evaluate(async () => {
    const it = window.Verbe.App.items.find(i => i.status === 'ok');
    delete it.counted;
    await window.Verbe.Store.put(it);
    return it.id;
  });
  await page.click(`[data-retry="${ancienne}"]`);
  await expect.poll(() => groq.transcriptions).toBe(5);
  await page.waitForFunction(() => window.Verbe.App.state === 'idle');
  expect(await stats(page)).toMatchObject({ n: 1, w: 5 });
});

test('« Nettoyer » ne compte pas la dictée deux fois', async ({ page, groq }) => {
  groq.nettoye = 'Bonjour, voici enfin un texte bien plus long et nettoyé.';
  await ouvrir(page);
  await dicter(page);
  expect(await stats(page)).toMatchObject({ n: 1, w: MOTS });
  await page.click('#btn-clean-last');
  await expect(page.locator('#last-text')).toHaveValue(groq.nettoye);
  expect(await page.evaluate(() => window.Verbe.App.last.words)).toBe(10); // le texte a bien changé de longueur
  expect(await stats(page)).toMatchObject({ n: 1, w: MOTS });
  // et « Annuler » non plus
  await page.click('.toast .t-act');
  await expect(page.locator('#last-text')).not.toHaveValue(groq.nettoye);
  expect(await stats(page)).toMatchObject({ n: 1, w: MOTS });
});

test('les chiffres sont gardés à la réouverture, même quand les dictées ont quitté l’historique', async ({ page }) => {
  await ouvrir(page, { hash: '#historique' });
  await dicter(page);
  await dicter(page);
  const avant = await stats(page);
  // l'historique ne garde que 100 dictées : le compteur ne doit pas en dépendre
  await page.evaluate(async () => { for (const it of window.Verbe.App.items) await window.Verbe.Store.del(it.id); });
  const verbe = await rouvrir(page, '#historique');
  await expect(verbe.locator('#h-list')).toContainText('Aucune dictée');
  await expect(ligne(verbe)).toContainText(`${2 * MOTS} mots dictés`);
  expect(await stats(verbe)).toEqual(avant);
});

test('la première fois, le compteur part de l’historique déjà gardé (dictées au micro réussies seulement)', async ({ page }) => {
  await ouvrir(page, { hash: '#historique' });
  await page.evaluate(async () => {
    const base = { error: '', provider: 'groq', model: 'whisper-large-v3-turbo', latencyMs: 900, hasAudio: false, fileName: '' };
    const t = Date.now();
    await window.Verbe.Store.put({ ...base, id: 'ok1', createdAt: t - 3000, text: 'Un deux trois quatre cinq six', status: 'ok', source: 'micro', durationMs: 3000, words: 6 });
    await window.Verbe.Store.put({ ...base, id: 'ok2', createdAt: t - 2000, text: 'Sept huit neuf', status: 'ok', source: 'micro', durationMs: 2000, words: 3 });
    await window.Verbe.Store.put({ ...base, id: 'rate', createdAt: t - 1000, text: '', status: 'error', error: 'Limite atteinte.', source: 'micro', durationMs: 4000, words: 0 });
    await window.Verbe.Store.put({ ...base, id: 'fichier', createdAt: t, text: 'Une réunion entière transcrite depuis un fichier', status: 'ok', source: 'fichier', durationMs: 3600000, words: 7, fileName: 'reunion.m4a' });
    localStorage.removeItem('verbe.stats'); // comme avant cette version
  });
  const verbe = await rouvrir(page, '#historique');
  await expect(ligne(verbe)).toContainText('9 mots dictés');
  expect(await stats(verbe)).toMatchObject({ n: 2, w: 9, ms: 5000 });
});

test.describe('sur téléphone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('la ligne tient sur deux lignes au plus, sans déborder ; l’aide s’ouvre d’un toucher', async ({ page }) => {
    await ouvrir(page, { hash: '#historique' });
    const [auj, hier, avantHier, vieux] = [await jour(page, 0), await jour(page, -1), await jour(page, -2), await jour(page, -30)];
    // de gros chiffres et une série de 3 jours : le cas le plus long à afficher
    const semaine = await page.evaluate(
      j => {
        const days = { [j.vieux]: [3000, 90000, 8 * 3600000], [j.avantHier]: [400, 5000, 1200000], [j.hier]: [300, 5000, 1200000], [j.auj]: [300, 23456, 1200000] };
        localStorage.setItem('verbe.stats', JSON.stringify({ v: 1, n: 4000, w: 123456, ms: 9 * 3600000, days }));
        // la semaine commence le lundi : calculée ici à part, pour ne pas dépendre du jour où le test tourne
        const d = new Date();
        d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        const lundi = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const n = Object.entries(days).filter(([k]) => k >= lundi).reduce((t, [, v]) => t + v[1], 0);
        return new Intl.NumberFormat('fr-CA').format(n);
      },
      { auj, hier, avantHier, vieux },
    );
    const verbe = await rouvrir(page, '#historique');
    const l = ligne(verbe);
    await expect(l).toContainText(new RegExp(`${semaine.replace(/\s/g, '\\s')}\\s*mots cette semaine`));
    await expect(l).toContainText(/123\s456\s*au total/);
    await expect(l).toContainText('3 jours de suite');
    await expect(l).toContainText(/≈\s*42 h 26\s*gagnées/);
    const mesure = await l.evaluate(el => {
      const r = el.getBoundingClientRect(), lh = parseFloat(getComputedStyle(el).lineHeight);
      return { hauteur: r.height, lh, droite: r.right, largeur: document.documentElement.clientWidth, deborde: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    expect(mesure.lh).toBeGreaterThan(10);
    expect(mesure.hauteur, 'deux lignes au plus').toBeLessThanOrEqual(2 * mesure.lh + 1);
    expect(mesure.droite).toBeLessThanOrEqual(mesure.largeur);
    expect(mesure.deborde).toBeLessThanOrEqual(0);
    // l'explication du calcul, en petit texte, d'un toucher
    await expect(verbe.locator('#h-prog .help')).toBeHidden();
    await l.tap();
    await expect(verbe.locator('#h-prog .help')).toBeVisible();
    await expect(verbe.locator('#h-prog .help')).toContainText('40 mots par minute');
    expect(await verbe.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});
