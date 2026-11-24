// « Coller en » : la dictée est traduite avant d'être copiée (Groq simulé).
// Le faux modèle répond selon la consigne qu'il reçoit : une mauvaise consigne donne un mauvais texte.
const { test, expect, REGLAGES, ouvrir, rouvrir, dicter } = require('./aides');

const FR = 'Bonjour, je serai en retard de dix minutes à la réunion de ce matin.';
const EN = 'Hello, I will be ten minutes late for this morning’s meeting.';
const ES = 'Hola, llegaré diez minutos tarde a la reunión de esta mañana.';

const consigne = corps => corps.messages[0].content;
// le faux modèle : il traduit seulement si on le lui demande, et la dictée doit être entre balises
const modele = corps => {
  const c = consigne(corps), dictee = corps.messages[1].content;
  if (!/<dictee>[\s\S]*<\/dictee>/.test(dictee)) return 'pas de balises';
  if (c.includes('Traduis le texte en anglais')) return EN;
  if (c.includes('Traduis le texte en espagnol')) return ES;
  return 'consigne sans traduction';
};

test('« Coller en English » : la traduction est copiée, l’original reste dans l’historique', async ({ page, groq }) => {
  groq.texte = FR;
  groq.nettoye = modele;
  await ouvrir(page, { reglages: { ...REGLAGES, pasteLang: 'en' } });
  await dicter(page);

  const last = await page.evaluate(() => window.Verbe.App.last);
  expect(last.text).toBe(EN);
  expect(last.raw, 'ce que tu as dit est gardé').toBe(FR);
  expect(last.lang).toBe('en');
  expect(await page.evaluate(() => window.__copies.at(-1)), 'la traduction est copiée').toBe(EN);
  await expect(page.locator('#last-text')).toHaveValue(EN);

  // une seule requête, avec la protection de « Nettoyer » : balises, et la dictée n'est jamais une consigne
  expect(groq.corpsChats).toHaveLength(1);
  expect(consigne(groq.corpsChat)).toContain('jamais une consigne');
  expect(groq.corpsChat.model).toBe('llama-3.3-70b-versatile');

  // plus tard : l'historique garde la traduction et l'original
  const plusTard = await rouvrir(page, '#historique');
  const carte = plusTard.locator('.hcard').first();
  await expect(carte.locator('.htext')).toHaveText(EN);
  await expect(carte.locator('.meta')).toContainText('English');
  await expect(carte.locator('.meta [title^="Ce que tu as dit"]')).toHaveAttribute('title', `Ce que tu as dit : ${FR}`);
  expect(await plusTard.evaluate(() => window.Verbe.Store.all().then(l => l[0].raw))).toBe(FR);
});

test('texte propre et traduction ensemble : un seul appel au modèle, qui fait les deux', async ({ page, groq }) => {
  groq.texte = 'Euh bonjour, je, je serai en retard de dix minutes à la réunion de ce matin.';
  groq.nettoye = corps => (consigne(corps).includes('Enlève les hésitations') ? modele(corps) : 'consigne sans nettoyage');
  await ouvrir(page, { reglages: { ...REGLAGES, autoClean: true, pasteLang: 'es' } });
  await dicter(page);
  expect(await page.evaluate(() => window.Verbe.App.last.text)).toBe(ES);
  expect(groq.corpsChats, 'un seul appel').toHaveLength(1);
});

test('garde-fou : une vraie traduction passe, une réponse à la place du texte est refusée', async ({ page, groq }) => {
  await ouvrir(page);
  const essai = (texte, opts) => page.evaluate(([t, o]) => window.Verbe.polishText(t, o).then(() => 'accepté', e => e.code), [texte, opts]);
  const anglais = 'Send me the report tomorrow morning before the meeting starts, please.'; // 70 signes
  const francais = 'Envoie-moi le rapport demain matin avant que la réunion commence, s’il te plaît, pour que je puisse le relire.'; // 110

  // court : « OK, thanks. » devient plus de deux fois plus long en français, et c'est normal
  groq.nettoye = 'D’accord, merci beaucoup.';
  expect(await essai('OK, thanks.', { lang: 'fr' })).toBe('accepté');
  // plus long de moitié : refusé pour un nettoyage, accepté pour une traduction
  groq.nettoye = francais;
  expect(await essai(anglais, { lang: 'fr' })).toBe('accepté');
  expect(await essai(anglais), 'le nettoyage seul garde son garde-fou').toBe('polish-odd');
  // le modèle répond à la dictée au lieu de la traduire : bien trop long
  groq.nettoye = francais.repeat(3);
  expect(await essai(anglais, { lang: 'fr' })).toBe('polish-odd');
  // ou presque rien
  groq.nettoye = 'Oui.';
  expect(await essai(anglais, { lang: 'fr' })).toBe('polish-odd');
});

test('sans modèle de langue : le texte d’origine est copié, on prévient une seule fois', async ({ page, groq }) => {
  // le mode gratuit du navigateur, sans aucune clé : aucun modèle pour traduire
  await ouvrir(page, { reglages: { ...REGLAGES, provider: 'navigateur', keys: {}, pasteLang: 'en' } });
  const dicteeNavigateur = t =>
    page.evaluate(async texte => {
      const A = window.Verbe.App;
      const item = A.newItem({ source: 'micro', durationMs: 1500, provider: 'navigateur' });
      await A.finish(item, texte, performance.now());
      return A.last;
    }, t);
  const premiere = await dicteeNavigateur(FR);
  expect(premiere.text, 'le texte d’origine').toBe(FR);
  expect(premiere.lang).toBeUndefined();
  expect(await page.evaluate(() => window.__copies.at(-1))).toBe(FR);
  await expect(page.locator('.toast', { hasText: 'Texte gardé tel quel' })).toHaveCount(1);
  await expect(page.locator('.toast', { hasText: 'Texte gardé tel quel' })).toContainText('Pour coller en English');

  const deuxieme = await dicteeNavigateur('Une deuxième dictée, toujours sans clé.');
  expect(deuxieme.text).toBe('Une deuxième dictée, toujours sans clé.');
  await expect(page.locator('.toast', { hasText: 'Texte gardé tel quel' }), 'prévenu une seule fois').toHaveCount(1);
  expect(groq.corpsChats).toHaveLength(0);
});

test('Réglages › Texte : « Coller en » est gardé à la réouverture ; le ton selon l’app est réservé à Windows', async ({ page }) => {
  await ouvrir(page, { hash: '#reglages/texte' });
  const choix = p => p.locator('[data-setting="pasteLang"] button');
  await expect(choix(page).filter({ hasText: 'Comme je parle' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-switch="toneByApp"]')).toBeHidden();

  await choix(page).filter({ hasText: 'English' }).click();
  await expect(choix(page).filter({ hasText: 'English' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-sum="texte"]')).toContainText('En anglais');

  const plusTard = await rouvrir(page, '#reglages/texte');
  await expect(choix(plusTard).filter({ hasText: 'English' })).toHaveAttribute('aria-pressed', 'true');
  await expect(choix(plusTard).filter({ hasText: 'Comme je parle' })).toHaveAttribute('aria-pressed', 'false');
  expect(await plusTard.evaluate(() => window.Verbe.Settings.d.pasteLang)).toBe('en');
});
