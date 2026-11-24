// Mes mots (indice pour Whisper, remplacements) et textes tout prêts (Groq simulé).
const { test, expect, REGLAGES, ouvrir, rouvrir, dicter } = require('./aides');

const MOTS = [
  { word: 'SlideFabrik', heard: 'slide fabrique, slide fabric' },
  { word: 'Groq', heard: 'grok' },
  { word: 'Granby', heard: '' },
  { word: 'Intelligence Industrielle', heard: '' },
];
const SIGNATURE = 'Landry T.\nIntelligence Industrielle\n450 555-0123';
const TEXTES = [
  { name: 'signature', text: SIGNATURE },
  { name: 'mon courriel', text: 'landry@exemple.ca' },
];
const AVEC_MOTS = { ...REGLAGES, words: MOTS, snippets: TEXTES };
// le modèle simulé rend la dictée telle quelle : on voit ce qu'il a reçu
const renvoyer = corps => corps.messages[1].content.replace(/<\/?dictee>/g, '').trim();
// La suite d'une dictée, à partir de ce que Whisper a renvoyé : le même chemin que le micro (App.finish),
// sans dépendre du faux micro (les tests qui ont besoin de l'envoi audio dictent pour de vrai).
const finir = (page, brut) =>
  page.evaluate(async t => {
    const A = window.Verbe.App;
    await A.finish(A.newItem({ source: 'micro' }), t, performance.now());
    return A.last && A.last.text;
  }, brut);

test('Mes mots partent à Whisper dans « prompt », entiers et sous la limite', async ({ page, groq }) => {
  await ouvrir(page, { reglages: AVEC_MOTS });
  await dicter(page);
  expect(groq.envois[0].champs.prompt).toBe('SlideFabrik, Groq, Granby, Intelligence Industrielle.');

  // une longue liste : on garde les premiers mots, jamais un mot coupé, et la limite de 224 jetons
  const r = await page.evaluate(() => {
    const S = window.Verbe.Settings;
    S.d.words = Array.from({ length: 300 }, (_, i) => ({ word: `Jargonnerie${i}`, heard: '' }));
    const p = window.Verbe.wordsPrompt();
    const mots = p.replace(/\.$/, '').split(', ');
    const jetons = mots.reduce((n, m) => n + Math.ceil(new TextEncoder().encode(m).length / 2) + 1, 1);
    return { fin: p.slice(-1), mots, jetons, tous: mots.every((m, i) => m === `Jargonnerie${i}`) };
  });
  expect(r.fin).toBe('.');
  expect(r.tous, 'les premiers mots, dans l’ordre, entiers').toBe(true);
  expect(r.mots.length).toBeGreaterThan(10);
  expect(r.mots.length).toBeLessThan(300);
  expect(r.jetons).toBeLessThanOrEqual(224);
});

test('sans mots, aucun « prompt » ; Mistral ne reçoit jamais de « prompt »', async ({ page, groq }) => {
  await ouvrir(page);
  await dicter(page);
  expect(groq.envois[0].champs).not.toHaveProperty('prompt');

  const corps = [];
  await page.context().route('https://api.mistral.ai/v1/audio/transcriptions', route => {
    corps.push(route.request().postDataBuffer().toString('latin1'));
    return route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify({ text: 'Bonjour slide fabrique.' }) });
  });
  const mistral = await rouvrir(page);
  await mistral.evaluate(m => { const S = window.Verbe.Settings; S.d.provider = 'mistral'; S.d.keys.mistral = 'cle-test'; S.d.words = m; S.save(); }, MOTS);
  await dicter(mistral);
  expect(corps).toHaveLength(1);
  expect(corps[0]).toContain('name="model"');
  expect(corps[0]).not.toContain('name="prompt"');
  // les remplacements marchent quand même pour Mistral
  expect(await mistral.evaluate(() => window.Verbe.App.last.text)).toBe('Bonjour SlideFabrik.');
});

test('« entendu → écrit » : sans tenir compte des majuscules, sur des mots entiers seulement', async ({ page }) => {
  await ouvrir(page, { reglages: AVEC_MOTS });
  const CAS = [
    ['On ouvre slide fabrique demain.', 'On ouvre SlideFabrik demain.'],
    ['Slide Fabrique, puis SLIDE-FABRIQUE et slide fabric.', 'SlideFabrik, puis SlideFabrik et SlideFabrik.'],
    ['La clé grok et l’API Grok.', 'La clé Groq et l’API Groq.'],
    ['À granby, chez intelligence industrielle.', 'À Granby, chez Intelligence Industrielle.'],
    // des mots proches ne bougent pas
    ['Les slide fabriques et le grokking restent; groky aussi.', 'Les slide fabriques et le grokking restent; groky aussi.'],
    ['Granbyen et supergrok.', 'Granbyen et supergrok.'],
  ];
  for (const [dit, attendu] of CAS) {
    expect.soft(await page.evaluate(t => window.Verbe.fixWords(t), dit), dit).toBe(attendu);
  }
});

test('ordre : mes mots, puis les commandes, puis le texte propre (qui voit les bons mots)', async ({ page, groq }) => {
  groq.texte = 'Slide fabrique virgule c’est prêt avec grok point final';
  groq.nettoye = renvoyer;
  await ouvrir(page, { reglages: { ...AVEC_MOTS, autoClean: true } });
  await dicter(page);
  expect(groq.corpsChats).toHaveLength(1);
  expect(groq.corpsChats[0].messages[1].content).toContain('SlideFabrik, c’est prêt avec Groq.');
  expect(await page.evaluate(() => window.Verbe.App.last.text)).toBe('SlideFabrik, c’est prêt avec Groq.');
});

test('texte tout prêt : une dictée qui n’est que son nom donne le texte tel quel', async ({ page, groq }) => {
  groq.nettoye = renvoyer;
  await ouvrir(page, { reglages: { ...AVEC_MOTS, autoClean: true } });
  expect(await finir(page, 'Signature.')).toBe(SIGNATURE);
  expect(groq.corpsChats, 'le texte tout prêt ne passe pas par le nettoyage').toHaveLength(0);

  const formes = await page.evaluate(() => ['Insère ma signature.', 'insérer la signature', 'Mon courriel', 'Insère mon courriel !'].map(t => window.Verbe.wholeSnippet(t)));
  expect(formes).toEqual([SIGNATURE, SIGNATURE, 'landry@exemple.ca', 'landry@exemple.ca']);
});

test('texte tout prêt : « Insère ma signature. » en phrase à part, dans une dictée plus longue', async ({ page, groq }) => {
  groq.nettoye = renvoyer;
  await ouvrir(page, { reglages: { ...AVEC_MOTS, autoClean: true } });
  expect(await finir(page, 'Merci pour ton aide virgule à demain. Insère ma signature.')).toBe(`Merci pour ton aide, à demain.\n${SIGNATURE}`);
  // le modèle ne voit que la dictée, jamais la phrase « Insère… » ni la signature
  expect(groq.corpsChats).toHaveLength(1);
  expect(groq.corpsChats[0].messages[1].content).not.toMatch(/Insère|Landry/);

  const enLigne = await page.evaluate(() => window.Verbe.insertSnippets('Écris-moi. Insère mon courriel. Bonne journée.'));
  expect(enLigne, 'un texte d’une ligne reste dans la phrase').toBe('Écris-moi. landry@exemple.ca Bonne journée.');
});

test('texte tout prêt : jamais remplacé par surprise dans une phrase normale', async ({ page }) => {
  await ouvrir(page, { reglages: AVEC_MOTS });
  expect(await finir(page, 'Je mets ma signature en bas du courriel.')).toBe('Je mets ma signature en bas du courriel.');

  const PHRASES = [
    'Où est-ce que j’insère ma signature?',
    'Ma signature est trop longue.',
    'Insère ma signature ici. Merci.',
    'Il faut que tu insères ma signature',
    'Envoie-moi ton courriel.',
    'Signature électronique.',
  ];
  for (const t of PHRASES) {
    const r = await page.evaluate(x => ({ seul: window.Verbe.wholeSnippet(x), dedans: window.Verbe.insertSnippets(x) }), t);
    expect.soft(r, t).toEqual({ seul: '', dedans: t });
  }
});

test('Whisper qui recopie la liste de mots sur du silence n’écrit rien', async ({ page, groq }) => {
  groq.texte = 'SlideFabrik, Groq, Granby, Intelligence Industrielle.';
  await ouvrir(page, { reglages: AVEC_MOTS });
  await dicter(page);
  expect(await page.evaluate(() => window.Verbe.App.items[0].status)).toBe('error');
  expect(await page.evaluate(() => window.__copies)).toEqual([]);
});

test('Réglages › Texte : ajouter, modifier, retirer ; une ligne vide est ignorée ; tout est gardé', async ({ page }) => {
  await ouvrir(page, { hash: '#reglages/texte' });
  const mots = page.locator('#words-list .mrow');
  const textes = page.locator('#snips-list .mrow');
  await expect(mots).toHaveCount(0);

  await page.click('#btn-word-add');
  await mots.nth(0).locator('.m-word').fill('SlideFabrik');
  await mots.nth(0).locator('.m-heard').fill('slide fabrique');
  await page.click('#btn-word-add');
  await mots.nth(1).locator('.m-word').fill('Groq');
  await page.click('#btn-word-add'); // ligne laissée vide
  await expect(mots).toHaveCount(3);
  await page.click('#btn-word-add'); // une ligne vide attend déjà : pas de quatrième
  await expect(mots).toHaveCount(3);

  await page.click('#btn-snip-add');
  await textes.nth(0).locator('.m-name').fill('signature');
  await textes.nth(0).locator('.m-text').fill('Landry\nVerbe');

  await mots.nth(0).locator('.m-word').fill('SlideFabriK'); // modifier
  await mots.nth(1).locator('[data-rm]').click(); // retirer « Groq »
  await expect(mots).toHaveCount(2);

  const garde = () => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('verbe.reglages.v1')); return { words: s.words, snippets: s.snippets }; });
  await expect.poll(garde).toEqual({
    words: [{ word: 'SlideFabriK', heard: 'slide fabrique' }],
    snippets: [{ name: 'signature', text: 'Landry\nVerbe' }],
  });

  const plusTard = await rouvrir(page, '#reglages/texte');
  await expect(plusTard.locator('#words-list .mrow')).toHaveCount(1);
  await expect(plusTard.locator('#words-list .m-word')).toHaveValue('SlideFabriK');
  await expect(plusTard.locator('#words-list .m-heard')).toHaveValue('slide fabrique');
  await expect(plusTard.locator('#snips-list .m-text')).toHaveValue('Landry\nVerbe');
  expect(await plusTard.evaluate(() => window.Verbe.fixWords('slide fabrique'))).toBe('SlideFabriK');

  // tout retirer : les listes se vident
  await plusTard.locator('#words-list [data-rm]').click();
  await plusTard.locator('#snips-list [data-rm]').click();
  await expect.poll(() => plusTard.evaluate(() => { const s = JSON.parse(localStorage.getItem('verbe.reglages.v1')); return [s.words, s.snippets]; })).toEqual([[], []]);
});

test.describe('sur téléphone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('Mes mots et Textes tout prêts ne débordent pas', async ({ page }) => {
    const longs = {
      ...AVEC_MOTS,
      words: [...MOTS, { word: 'Anticonstitutionnellement-Supercalifragilistique', heard: 'anti constitutionnellement super cali fragilistique' }],
      snippets: [...TEXTES, { name: 'adresse du bureau', text: '1234, rue Principale Ouest, bureau 567, Granby (Québec) J2G 0A0 — entrée par la porte arrière' }],
    };
    await ouvrir(page, { hash: '#reglages/texte', reglages: longs });
    await expect(page.locator('#words-list .mrow')).toHaveCount(5);
    await expect(page.locator('#snips-list .mrow')).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const depasse = await page.evaluate(() =>
      [...document.querySelectorAll('#mots-group input, #mots-group textarea, #mots-group button')]
        .filter(el => { const r = el.getBoundingClientRect(); return r.left < 0 || r.right > window.innerWidth; }).length,
    );
    expect(depasse).toBe(0);
    // dans chaque ligne, les champs et le bouton « Retirer » restent dans la ligne et ne se chevauchent pas
    const chevauche = await page.evaluate(() => {
      const fautes = [];
      for (const row of document.querySelectorAll('#mots-group .mrow')) {
        const r = row.getBoundingClientRect(), enfants = [...row.children].map(e => e.getBoundingClientRect());
        enfants.forEach((a, i) => {
          if (a.left < r.left - 1 || a.right > r.right + 1) fautes.push(`hors de la ligne : ${row.children[i].className}`);
          enfants.slice(i + 1).forEach(b => {
            if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) fautes.push(`chevauchement dans « ${row.querySelector('input').value} »`);
          });
        });
      }
      return fautes;
    });
    expect(chevauche).toEqual([]);
  });
});
