// Tests de Verbe.
// - « web » : la page servie comme sur GitHub Pages, dans Chromium, avec un faux micro et Groq simulé.
// - « bureau » : l'app Electron (Windows seulement), dans un profil à part.
// Sur un autre système que Windows, le projet « bureau » n'existe pas : le demander fait échouer la commande
// au lieu de passer sans rien tester.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { defineConfig } = require('@playwright/test');

const PORT = Number(process.env.VERBE_PORT || 4173);

// La « voix » du faux micro : des « syllabes » (250 ms de son, 120 ms de pause, hauteur qui change),
// rejouées en boucle. Les bips du faux micro par défaut sont trop courts pour la détection de voix de
// Verbe (160 ms au moins), et un son continu est effacé par l'anti-bruit de Chrome au bout d'une seconde.
function voixDeTest() {
  const fichier = path.join(os.tmpdir(), 'verbe-voix-de-test-syllabes.wav');
  if (fs.existsSync(fichier)) return fichier;
  const taux = 16000;
  const n = taux * 3;
  const son = Buffer.alloc(n * 2);
  const hauteurs = [220, 330, 440, 550, 300, 410];
  const syllabe = 0.25 * taux, pause = 0.12 * taux, fondu = 0.01 * taux;
  for (let i = 0; i < n; i++) {
    const k = Math.floor(i / (syllabe + pause)), t = i % (syllabe + pause);
    const enveloppe = t >= syllabe ? 0 : Math.min(1, t / fondu, (syllabe - t) / fondu);
    son.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hauteurs[k % hauteurs.length] * i) / taux) * 0.3 * enveloppe * 32767), i * 2);
  }
  const entete = Buffer.alloc(44);
  entete.write('RIFF', 0);
  entete.writeUInt32LE(36 + son.length, 4);
  entete.write('WAVE', 8);
  entete.write('fmt ', 12);
  entete.writeUInt32LE(16, 16); // taille du bloc « fmt »
  entete.writeUInt16LE(1, 20); // PCM
  entete.writeUInt16LE(1, 22); // mono
  entete.writeUInt32LE(taux, 24);
  entete.writeUInt32LE(taux * 2, 28); // octets par seconde
  entete.writeUInt16LE(2, 32); // octets par échantillon
  entete.writeUInt16LE(16, 34); // bits par échantillon
  entete.write('data', 36);
  entete.writeUInt32LE(son.length, 40);
  const provisoire = `${fichier}.${process.pid}`;
  fs.writeFileSync(provisoire, Buffer.concat([entete, son]));
  try {
    fs.renameSync(provisoire, fichier);
  } catch {
    fs.rmSync(provisoire, { force: true }); // un autre processus l'a écrit en même temps
  }
  return fichier;
}

const web = {
  name: 'web',
  testDir: 'tests/web',
  use: {
    browserName: 'chromium',
    channel: 'chromium', // Chromium complet (nouveau mode sans fenêtre) : le « headless shell » plante au rechargement d'une page qui a ouvert son audio
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    locale: 'fr-CA',
    timezoneId: 'America/Toronto',
    permissions: ['microphone'],
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-audio-capture=${voixDeTest()}`,
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
};

const bureau = { name: 'bureau', testDir: 'tests/bureau' };

module.exports = defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI, // un test.only oublié fait échouer la CI
  retries: 0, // un test instable se corrige ; on ne le rejoue pas en espérant qu'il passe
  timeout: 60_000,
  expect: { timeout: 8_000 },
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  use: { trace: 'retain-on-failure' },
  projects: process.platform === 'win32' ? [web, bureau] : [web],
  webServer: {
    command: `node tests/serveur.mjs ${PORT}`,
    url: `http://localhost:${PORT}/app/verbe.html`,
    reuseExistingServer: !process.env.CI,
  },
});
