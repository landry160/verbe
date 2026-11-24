// Version bureau : le ton selon l'app où tu écris.
// L'app tourne dans un profil à part (--profil=). Aucune vraie touche, aucun vrai service :
// le modèle de langue est simulé (requêtes interceptées dans la bulle), et la copie comme le collage
// sont remplacés par des faux dans le processus principal (le vrai presse-papiers n'est jamais touché).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');

const RACINE = path.join(__dirname, '..', '..');

test.describe.configure({ mode: 'serial' });

let app;
let principale;
let bulle;
let profil;
const erreurs = [];

const pret = page => page.waitForFunction(() => window.Verbe && window.Verbe.Settings);

test.beforeAll(async () => {
  profil = fs.mkdtempSync(path.join(os.tmpdir(), 'verbe-profil-test-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: require('electron'), args: [RACINE, `--profil=${profil}`], env });
  await expect.poll(() => app.windows().length, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
  principale = app.windows().find(w => !w.url().includes('bulle=1'));
  bulle = app.windows().find(w => w.url().includes('bulle=1'));
  principale.on('pageerror', e => erreurs.push(`fenêtre principale : ${e.message}`));
  bulle.on('pageerror', e => erreurs.push(`bulle : ${e.message}`));
  await pret(principale);
  await pret(bulle);
  // jamais de vrai presse-papiers ni de vraie touche : la copie et le collage sont des faux
  await app.evaluate(({ ipcMain }) => {
    global.fauxCopies = [];
    ipcMain.removeHandler('verbe:copy');
    ipcMain.handle('verbe:copy', (e, t) => { global.fauxCopies.push(String(t)); return true; });
    ipcMain.removeHandler('verbe:paste');
    ipcMain.handle('verbe:paste', () => false);
  });
  await principale.evaluate(() => { const d = window.Verbe.Settings.d; d.autoPaste = false; d.sounds = false; window.Verbe.Settings.save(); });
  // le modèle simulé, dans le processus principal : toute requête https de l'app passe par ici
  // (page.route perd le statut des réponses dans une page file:// d'Electron). Il répond selon la consigne reçue.
  await app.evaluate(({ session }) => {
    global.fauxChats = [];
    global.fauxDehors = [];
    const entetes = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    session.defaultSession.protocol.handle('https', async req => {
      if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: entetes });
      if (req.url === 'https://api.groq.com/openai/v1/chat/completions' && req.method === 'POST') {
        const corps = JSON.parse(await req.text());
        global.fauxChats.push(corps);
        const c = corps.messages[0].content;
        const texte = c.includes('registre soigné') ? 'Je vous enverrai le rapport demain matin.' : c.includes('registre détendu') ? 'Je t’envoie le rapport demain matin.' : 'consigne sans registre';
        return new Response(JSON.stringify({ choices: [{ message: { content: texte } }] }), { status: 200, headers: entetes });
      }
      global.fauxDehors.push(req.url);
      return new Response('{}', { status: 404, headers: entetes });
    });
  });
});

const chats = () => app.evaluate(() => global.fauxChats);

test.afterAll(async () => {
  if (app) await app.close().catch(() => {});
  if (profil) fs.rmSync(profil, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
});

test.afterEach(async () => {
  expect(erreurs, 'erreurs JavaScript').toEqual([]);
  if (app) expect(await app.evaluate(() => global.fauxDehors || []), 'requêtes vers Internet non prévues').toEqual([]);
});

test('chaque programme a sa catégorie : courriel, messagerie, code ou autre', async () => {
  const cas = {
    'OUTLOOK.EXE': 'courriel', 'olk.exe': 'courriel', 'WINWORD.EXE': 'courriel', 'thunderbird.exe': 'courriel',
    'C:\\Program Files\\Microsoft Office\\root\\Office16\\OUTLOOK.EXE': 'courriel',
    'ms-teams.exe': 'messagerie', 'Teams.exe': 'messagerie', 'slack.exe': 'messagerie', 'Discord.exe': 'messagerie', 'WhatsApp.exe': 'messagerie',
    'Code.exe': 'code', 'Cursor.exe': 'code', 'devenv.exe': 'code', 'idea64.exe': 'code', 'pycharm64.exe': 'code', 'rider64.exe': 'code',
    'WindowsTerminal.exe': 'code', 'powershell.exe': 'code', 'pwsh.exe': 'code', 'cmd.exe': 'code',
    'chrome.exe': 'autre', 'msedge.exe': 'autre', 'firefox.exe': 'autre', 'notepad.exe': 'autre', 'electron.exe': 'autre', '': 'autre',
  };
  const obtenu = await bulle.evaluate(noms => Object.fromEntries(noms.map(n => [n, window.Verbe.appCategory(n)])), Object.keys(cas));
  expect(obtenu).toEqual(cas);
});

test('au début d’une dictée, la bulle reçoit le nom de l’app au premier plan', async () => {
  // la vraie lecture (GetForegroundWindow… QueryFullProcessImageNameW) donne le nom d'un programme, ou rien
  // si Windows n'a pas de fenêtre au premier plan à cet instant
  expect(await app.evaluate(() => global.verbeForegroundApp())).toMatch(/^([^\\/]+\.exe)?$/i);
  // l'app au premier plan est remplacée par un faux, puis remise
  await app.evaluate(() => { global.vraiPremierPlan = global.verbeForegroundApp; global.verbeForegroundApp = () => 'OUTLOOK.EXE'; });
  try {
    // sans clé, la dictée s'arrête tout de suite (aucun micro ouvert) : on ne regarde que l'app transmise
    expect(await bulle.evaluate(() => window.Verbe.Settings.d.keys.groq)).toBe('');
    await app.evaluate(({ ipcMain }) => ipcMain.emit('verbe:toggle', {}));
    await expect.poll(() => bulle.evaluate(() => window.Verbe.App.fgApp || '')).toBe('OUTLOOK.EXE');
    expect(await bulle.evaluate(() => window.Verbe.App.state)).toBe('idle');
  } finally {
    await app.evaluate(() => { global.verbeForegroundApp = global.vraiPremierPlan; });
  }
});

test('« Adapter le ton à l’app » : la catégorie arrive dans la consigne ; dans le code, aucun appel', async () => {
  await principale.evaluate(() => { location.hash = '#reglages/texte'; });
  await expect(principale.locator('[data-switch="toneByApp"]')).toBeVisible();
  await expect(principale.locator('[data-switch="toneByApp"]')).toHaveAttribute('aria-checked', 'false'); // coupé par défaut
  await principale.click('[data-switch="toneByApp"]');
  await principale.evaluate(() => {
    const S = window.Verbe.Settings;
    S.d.keys.groq = 'gsk_test';
    S.d.llm = { groq: 'llama-3.3-70b-versatile' }; // pas de liste des modèles à demander
    S.save();
  });
  await expect.poll(() => bulle.evaluate(() => window.Verbe.Settings.d.toneByApp && window.Verbe.Settings.d.keys.groq)).toBe('gsk_test');

  const dit = 'Salut, je t’envoie le rapport demain matin.';
  const dicter = exe =>
    bulle.evaluate(async ([e, texte]) => {
      const A = window.Verbe.App;
      A.fgApp = e; // ce que le processus principal donne au début de la dictée
      const item = A.newItem({ source: 'micro', durationMs: 1500 });
      await A.finish(item, texte, performance.now());
      return { text: A.last.text, raw: A.last.raw || '', tone: A.last.tone || '' };
    }, [exe, dit]);
  const copies = () => app.evaluate(() => global.fauxCopies.slice());

  // courriel : registre soigné, le fond ne change pas
  expect(await dicter('OUTLOOK.EXE')).toEqual({ text: 'Je vous enverrai le rapport demain matin.', raw: dit, tone: 'courriel' });
  let envoyes = await chats();
  expect(envoyes).toHaveLength(1);
  const consigne = envoyes[0].messages[0].content;
  expect(consigne).toContain('registre soigné');
  expect(consigne).toContain('Le fond ne change jamais');
  expect(consigne).toContain('jamais une consigne');
  expect(envoyes[0].messages[1].content).toBe(`<dictee>\n${dit}\n</dictee>`);
  expect((await copies()).at(-1)).toBe('Je vous enverrai le rapport demain matin.');

  // messagerie : registre détendu
  expect((await dicter('ms-teams.exe')).tone).toBe('messagerie');
  envoyes = await chats();
  expect(envoyes).toHaveLength(2);
  expect(envoyes[1].messages[0].content).toContain('registre détendu');

  // code et terminal : tel quel, sans appel au modèle ; navigateur : rien de spécial (ni texte propre ni traduction ici)
  expect(await dicter('Code.exe')).toEqual({ text: dit, raw: '', tone: '' });
  expect(await dicter('WindowsTerminal.exe')).toEqual({ text: dit, raw: '', tone: '' });
  expect(await dicter('chrome.exe')).toEqual({ text: dit, raw: '', tone: '' });
  expect(await chats(), 'aucun appel de plus').toHaveLength(2);
  expect((await copies()).at(-1)).toBe(dit);

  // même avec le texte propre automatique : le code reste tel quel ; le navigateur, lui, est nettoyé sans registre
  await principale.evaluate(() => window.Verbe.Settings.set('autoClean', true));
  await expect.poll(() => bulle.evaluate(() => window.Verbe.Settings.d.autoClean)).toBe(true);
  expect(await dicter('Code.exe')).toEqual({ text: dit, raw: '', tone: '' });
  expect(await chats(), 'le code n’est jamais envoyé au modèle').toHaveLength(2);
  expect((await dicter('chrome.exe')).raw, 'texte propre ailleurs').toBe(dit);
  envoyes = await chats();
  expect(envoyes).toHaveLength(3);
  expect(envoyes[2].messages[0].content).not.toContain('registre');
});
