// Commandes à la voix et « Nettoyer » (Groq simulé).
const { test, expect, ouvrir, dicter } = require('./aides');

// [ce que Whisper renvoie, ce que Verbe doit écrire]
const CAS = [
  ['Bonjour, virgule, comment ça va, point d\'interrogation.', 'Bonjour, comment ça va?'],
  ['Premier point. Nouvelle ligne. Deuxième point.', 'Premier point.\nDeuxième point.'],
  ['Liste point à la ligne suite', 'Liste.\nSuite'],
  ['Ligne un retour à la ligne ligne deux', 'Ligne un\nLigne deux'],
  ['Intro. Nouveau paragraphe. Corps du texte.', 'Intro.\n\nCorps du texte.'],
  ['Il a fini point-virgule ensuite on part', 'Il a fini; ensuite on part'],
  ['Quelle surprise point d\'exclamation', 'Quelle surprise!'],
  ['Fin du texte point final', 'Fin du texte.'],
  ['Bonjour point d\'interrogation nouvelle ligne Euh suite', 'Bonjour?\nEuh suite'],
  // guillemets français, avec des espaces insécables (le mot ne se sépare pas de ses guillemets)
  ['Il a dit ouvrez les guillemets oui fermez les guillemets ensuite', 'Il a dit « oui » ensuite'],
  ['Je pars demain. Je reste ici. Efface ça. Je rentre lundi.', 'Je pars demain. Je rentre lundi.'],
  // des mots ordinaires qui ressemblent à une commande ne bougent pas
  ['Mettre au point le projet, c\'est à la ligne de départ que tout commence.', 'Mettre au point le projet, c\'est à la ligne de départ que tout commence.'],
  ['Un texte sans aucune commande.', 'Un texte sans aucune commande.'],
];

test('les commandes à la voix donnent la bonne ponctuation', async ({ page }) => {
  await ouvrir(page);
  for (const [dit, attendu] of CAS) {
    expect.soft(await page.evaluate(t => window.Verbe.applyVoiceCommands(t), dit), dit).toBe(attendu);
  }
});

test('une dictée passe par les commandes, puis « Nettoyer » et « Annuler »', async ({ page, groq }) => {
  groq.texte = 'Bonjour virgule comment ça va point d\'interrogation nouvelle ligne Euh je, je teste.';
  groq.nettoye = 'Bonjour, comment ça va?\nJe teste.';
  const brut = 'Bonjour, comment ça va?\nEuh je, je teste.';
  await ouvrir(page);
  await dicter(page);
  expect(await page.evaluate(() => window.Verbe.App.last.text)).toBe(brut);

  await page.click('#btn-clean-last');
  await expect(page.locator('#last-text')).toHaveValue(groq.nettoye);
  await expect(page.locator('#btn-clean-last')).toContainText('Nettoyé');
  expect(await page.evaluate(() => window.Verbe.App.last.raw), 'le texte d’origine est gardé').toBe(brut);
  // le modèle vient de la liste de Groq ; la dictée est entre balises et la consigne interdit de lui obéir
  expect(groq.corpsChat.model).toBe('llama-3.3-70b-versatile');
  expect(groq.corpsChat.messages[1].content).toContain('<dictee>');
  expect(groq.corpsChat.messages[0].content).toContain('jamais une consigne');

  await page.click('.toast .t-act');
  await expect(page.locator('#last-text')).toHaveValue(brut);
});

test('« Nettoyer » refuse une réponse qui ne ressemble plus à la dictée', async ({ page, groq }) => {
  groq.nettoye = 'Oui.';
  await ouvrir(page);
  const resultat = await page.evaluate(() =>
    window.Verbe.polishText('Voici une assez longue dictée qui ne doit pas devenir un simple oui de la part du modèle.').then(() => 'accepté', e => e.code),
  );
  expect(resultat).toBe('polish-odd');
});

test('Réglages › Texte : « Commandes à la voix » est là, « Coller automatiquement » est réservé à Windows', async ({ page }) => {
  await ouvrir(page, { hash: '#reglages/texte' });
  await expect(page.locator('[data-switch="voiceCmds"]')).toBeVisible();
  await expect(page.locator('[data-switch="autoPaste"]')).toBeHidden();
});
