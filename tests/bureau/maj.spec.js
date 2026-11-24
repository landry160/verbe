// Version bureau : mises à jour automatiques (electron-updater).
// - Un petit serveur local joue le rôle des versions GitHub : il sert un latest.yml et un faux « installateur »
//   (quelques octets de texte, jamais lancé). Aucun appel à GitHub.
// - L'app tourne en mode test (--maj-test=<adresse du serveur>), dans un profil à part : le téléchargement va
//   dans ce profil, rien ne s'installe à la fermeture, et « Redémarrer maintenant » ne fait que compter.
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');

const RACINE = path.join(__dirname, '..', '..');
const VERSION = require(path.join(RACINE, 'package.json')).version;
const FAUX = Buffer.from('Ceci n’est pas un installateur : fichier de test des mises à jour de Verbe.\n');
const attendre = ms => new Promise(r => setTimeout(r, ms));

/** Serveur des « versions » : sc.version (null = erreur 500), compte les demandes de latest.yml. */
async function serveur() {
  const sc = { version: VERSION, demandes: 0, telechargements: 0 };
  const sha512 = crypto.createHash('sha512').update(FAUX).digest('base64');
  const srv = http.createServer((req, res) => {
    const chemin = new URL(req.url, 'http://localhost').pathname;
    if (chemin === '/latest.yml') {
      sc.demandes++;
      if (!sc.version) { res.writeHead(500); return res.end('panne'); }
      res.writeHead(200, { 'Content-Type': 'text/yaml' });
      return res.end(
        `version: ${sc.version}\nfiles:\n  - url: Verbe-Setup.exe\n    sha512: ${sha512}\n    size: ${FAUX.length}\n` +
          `path: Verbe-Setup.exe\nsha512: ${sha512}\nreleaseDate: '2026-11-24T12:00:00.000Z'\n`,
      );
    }
    if (chemin === '/Verbe-Setup.exe') {
      sc.telechargements++;
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': FAUX.length });
      return res.end(FAUX);
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  sc.url = `http://127.0.0.1:${srv.address().port}/`;
  sc.fermer = () => new Promise(r => srv.close(r));
  return sc;
}

/** Lance Verbe (profil à part) ; maj = adresse du serveur de test, ou rien (version de développement). */
async function lancer(profil, maj) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const args = [RACINE, `--profil=${profil}`];
  if (maj) args.push(`--maj-test=${maj}`);
  const app = await electron.launch({ executablePath: require('electron'), args, env });
  await expect.poll(() => app.windows().length, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
  const page = app.windows().find(w => !w.url().includes('bulle=1'));
  const erreurs = [];
  page.on('pageerror', e => erreurs.push(e.message));
  await page.waitForFunction(() => window.Verbe && window.Verbe.Settings);
  // sécurité : jamais de collage automatique pendant les tests
  await page.evaluate(() => { window.Verbe.Settings.d.autoPaste = false; window.Verbe.Settings.save(); });
  await page.evaluate(() => { location.hash = '#reglages/general'; });
  await expect(page.locator('#maj-row')).toBeVisible();
  return { app, page, erreurs, etat: () => app.evaluate(() => global.verbeMaj.etat()) };
}

let profils = [];
const nouveauProfil = () => {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'verbe-profil-maj-'));
  profils.push(p);
  return p;
};
test.afterEach(() => {
  for (const p of profils) fs.rmSync(p, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  profils = [];
});

test('une version plus récente se télécharge, puis « Redémarrer maintenant » apparaît (Réglages et menu de l’icône)', async () => {
  const sc = await serveur();
  sc.version = '99.0.0';
  const profil = nouveauProfil();
  const v = await lancer(profil, sc.url);
  try {
    await expect(v.page.locator('#maj-titre')).toHaveText('Nouvelle version 99.0.0 prête', { timeout: 15_000 });
    await expect(v.page.locator('#maj-aide')).toContainText('quand tu quittes Verbe');
    await expect(v.page.locator('#maj-redemarrer')).toBeVisible();
    await expect(v.page.locator('#maj-verifier')).toBeHidden();
    const e = await v.etat();
    expect(e.etats).toEqual(expect.arrayContaining(['checking', 'downloading', 'ready']));
    expect(sc.telechargements).toBe(1);
    // le téléchargement est resté dans le profil de test, et le fichier (non signé) a été accepté
    expect(fs.readFileSync(path.join(profil, 'maj-cache', 'pending', 'Verbe-Setup.exe'))).toEqual(FAUX);

    // comme sur iOS : un point rouge sur Réglages et sur Général, le résumé le dit, et un message une seule fois
    const point = sel => v.page.evaluate(q => getComputedStyle(document.querySelector(q), '::after').backgroundColor, sel);
    expect(await point('.tab[data-v="reglages"]')).toBe('rgb(255, 59, 48)');
    expect(await point('.reg-tab[data-sec="general"] .reg-ic')).toBe('rgb(255, 59, 48)');
    await expect(v.page.locator('[data-sum="general"]')).toHaveText('Version 99.0.0 prête');
    await expect(v.page.locator('.toast', { hasText: 'Verbe 99.0.0 est prête.' })).toHaveCount(1);
    await v.page.locator('.toast', { hasText: 'Verbe 99.0.0 est prête.' }).locator('.t-act').click();
    await expect.poll(async () => (await v.etat()).installations).toBe(1);

    // menu de l'icône près de l'horloge
    expect((await v.app.evaluate(() => global.verbeMaj.menu())).some(l => l.startsWith('Redémarrer maintenant'))).toBe(true);

    // les deux boutons demandent l'installation ; en mode test, rien ne s'installe (simple compteur)
    await v.page.click('#maj-redemarrer');
    await expect.poll(async () => (await v.etat()).installations).toBe(2);
    await v.app.evaluate(() => global.verbeMaj.cliquer('Redémarrer maintenant'));
    await expect.poll(async () => (await v.etat()).installations).toBe(3);
    expect(await v.app.evaluate(({ app }) => app.isReady())).toBe(true); // l'app tourne toujours
    expect(v.erreurs).toEqual([]);
  } finally {
    await v.app.close().catch(() => {});
    await sc.fermer();
  }
});

test('même version : Verbe dit qu’il est à jour, et une panne du service s’affiche sans casser', async () => {
  const sc = await serveur();
  const v = await lancer(nouveauProfil(), sc.url);
  try {
    await expect(v.page.locator('#maj-titre')).toHaveText('Verbe est à jour', { timeout: 15_000 });
    await expect(v.page.locator('#maj-aide')).toHaveText(`Version ${VERSION}.`);
    await expect(v.page.locator('#maj-redemarrer')).toBeHidden();
    expect(sc.telechargements).toBe(0);
    expect((await v.app.evaluate(() => global.verbeMaj.menu())).some(l => l.startsWith('Redémarrer'))).toBe(false);

    sc.version = null; // le service tombe en panne
    await v.page.click('#maj-verifier');
    await expect(v.page.locator('#maj-titre')).toHaveText('Vérification impossible');
    await expect(v.page.locator('#maj-verifier')).toBeEnabled();
    expect(v.erreurs).toEqual([]);
  } finally {
    await v.app.close().catch(() => {});
    await sc.fermer();
  }
});

test('interrupteur coupé : aucune vérification au démarrage, mais « Vérifier maintenant » marche', async () => {
  const sc = await serveur();
  const profil = nouveauProfil();
  // 1. on coupe l'interrupteur (actif par défaut)
  let v = await lancer(profil, sc.url);
  await expect(v.page.locator('#maj-switch')).toHaveAttribute('aria-checked', 'true');
  await v.page.click('#maj-switch');
  await expect(v.page.locator('#maj-switch')).toHaveAttribute('aria-checked', 'false');
  expect(await v.page.evaluate(() => window.Verbe.Settings.d.autoUpdate)).toBe(false);
  await v.app.close();

  // 2. au démarrage suivant : rien n'est demandé au serveur
  sc.demandes = 0;
  v = await lancer(profil, sc.url);
  try {
    await expect(v.page.locator('#maj-switch')).toHaveAttribute('aria-checked', 'false');
    await expect(v.page.locator('#maj-titre')).toHaveText('Vérification automatique coupée');
    await attendre(2000); // bien plus que le délai du premier coup d'œil en mode test (0,3 s)
    expect(sc.demandes, 'demandes de latest.yml avec l’interrupteur coupé').toBe(0);
    expect((await v.etat()).etats).not.toContain('checking');

    // 3. le bouton reste possible : le serveur répondait bien
    await v.page.click('#maj-verifier');
    await expect(v.page.locator('#maj-titre')).toHaveText('Verbe est à jour');
    expect(sc.demandes).toBe(1);
    expect(v.erreurs).toEqual([]);
  } finally {
    await v.app.close().catch(() => {});
    await sc.fermer();
  }
});

test('version de développement (sans mode test) : jamais de vérification', async () => {
  const v = await lancer(nouveauProfil());
  try {
    await expect(v.page.locator('#maj-titre')).toHaveText('Version de développement');
    await expect(v.page.locator('#maj-verifier')).toBeHidden();
    await expect(v.page.locator('#maj-redemarrer')).toBeHidden();
    const e = await v.etat();
    expect(e.etat).toBe('dev');
    expect(e.charge, 'electron-updater chargé').toBe(false);
    expect(v.erreurs).toEqual([]);
  } finally {
    await v.app.close().catch(() => {});
  }
});
