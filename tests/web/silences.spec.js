// Silences coupés avant l'envoi : le début et la fin muets ne partent pas, une longue pause est raccourcie,
// la voix est toujours gardée. Une dictée sans silence notable part telle quelle (pas ré-encodée).
// Pour faire « silence », on coupe la piste du micro dans la page (elle ne donne plus que du silence).
const { test, expect, REGLAGES, ouvrir, attendreEtat } = require('./aides');

const couperLeSon = page => page.evaluate(() => { window.Verbe.Rec.stream.getAudioTracks()[0].enabled = false; });
const remettreLeSon = page => page.evaluate(() => { window.Verbe.Rec.stream.getAudioTracks()[0].enabled = true; });

/** L'audio d'un envoi : WAV (durée lue dans son en-tête) ou tel quel (nom du fichier envoyé). */
function audioEnvoye(envoi) {
  const corps = envoi.corps, fichier = (corps.toString('latin1').match(/filename="([^"]+)"/) || [])[1];
  const riff = corps.indexOf('RIFF');
  if (riff < 0) return { fichier, wav: false };
  const data = corps.indexOf('data', riff + 12);
  return { fichier, wav: true, sec: corps.readUInt32LE(data + 4) / 32000 }; // 16 kHz, 16 bits, mono
}

test('la découpe : début et fin muets retirés, longue pause raccourcie, voix et courte pause gardées', async ({ page }) => {
  await ouvrir(page);
  const r = await page.evaluate(() => {
    const sr = 16000, morceaux = [[1, 0], [1, 1], [1, 0], [1, 1], [4, 0], [1, 1], [3, 0]]; // [secondes, voix ?]
    const x = new Float32Array(sr * morceaux.reduce((n, [s]) => n + s, 0));
    let o = 0;
    for (const [s, voix] of morceaux) {
      for (let i = 0; i < s * sr; i++) x[o + i] = voix ? 0.3 * Math.sin((2 * Math.PI * 300 * i) / sr) : 0.0005 * Math.sin(i); // silence : bruit très bas (-69 dB)
      o += s * sr;
    }
    // trames de 20 ms : voix (au-dessus de -46 dB) et plus longs passages muets
    const lire = y => {
      const F = 320, db = [];
      for (let f = 0; f + F <= y.length; f += F) { let e = 0; for (let i = 0; i < F; i++) e += y[f + i] * y[f + i]; db.push(20 * Math.log10(Math.sqrt(e / F) + 1e-9)); }
      const voix = db.filter(d => d > -46).length;
      const debut = db.findIndex(d => d > -46) * 0.02, fin = (db.length - 1 - db.map(d => d > -46).lastIndexOf(true)) * 0.02;
      let muet = 0, plusLong = 0;
      for (const d of db) { muet = d > -46 ? 0 : muet + 1; plusLong = Math.max(plusLong, muet); }
      return { voix, debut, fin, plusLongMuet: plusLong * 0.02 };
    };
    const coupe = window.Verbe.trimSilences(x, sr);
    // rien à gagner : 2 s de voix entre deux quarts de seconde muets
    const court = new Float32Array(sr * 2.5);
    for (let i = sr / 4; i < sr * 2.25; i++) court[i] = 0.3 * Math.sin(i / 5);
    return { avant: lire(x), apres: lire(coupe.samples), sec: coupe.sentSec, retire: coupe.removedSec, court: window.Verbe.trimSilences(court, sr) };
  });
  expect(r.apres.voix, 'toute la voix est gardée').toBe(r.avant.voix);
  expect(r.sec).toBeCloseTo(0.4 + 1 + 1 + 1 + 0.7 + 1 + 0.5, 1); // 5,6 s envoyées au lieu de 12
  expect(r.retire).toBeCloseTo(12 - 5.6, 1);
  expect(r.apres.debut).toBeCloseTo(0.4, 1);
  expect(r.apres.fin).toBeCloseTo(0.5, 1);
  expect(r.apres.plusLongMuet, 'la pause d’une seconde est gardée telle quelle, celle de 4 s ramenée sous 1 s').toBeCloseTo(1, 1);
  expect(r.court, 'moins de 2 s à gagner : rien n’est coupé').toBeNull();
});

test('une dictée suivie de silence : l’audio envoyé est bien plus court, le texte arrive, l’historique garde l’original', async ({ page, groq }) => {
  await ouvrir(page, { reglages: { ...REGLAGES, autoStop: '4' } });
  await page.evaluate(() => window.Verbe.App.toggle());
  await attendreEtat(page, 'recording');
  await page.waitForTimeout(1200); // de la « voix »
  await couperLeSon(page);
  await attendreEtat(page, 'idle', 15000); // l'arrêt automatique, après 4 s sans voix
  const item = await page.evaluate(() => window.Verbe.App.last);
  expect(item.text).toBe('Bonjour, ceci est un test de Verbe.');
  expect(groq.envois).toHaveLength(1);
  const envoye = audioEnvoye(groq.envois[0]);
  expect(envoye.wav, 'ré-encodé en WAV après la coupe').toBe(true);
  expect(item.durationMs / 1000).toBeGreaterThan(5);
  expect(envoye.sec, 'la voix est envoyée').toBeGreaterThan(1);
  expect(envoye.sec, 'le silence de la fin ne part pas').toBeLessThan(item.durationMs / 1000 - 3);

  // « Retranscrire » : l'historique a gardé l'enregistrement d'origine ; ses silences sont coupés à nouveau
  const garde = await page.evaluate(async id => { const b = await window.Verbe.Store.getAudio(id); return { type: b.type, taille: b.size }; }, item.id);
  expect(garde.type).not.toBe('audio/wav');
  await page.evaluate(id => window.Verbe.App.retry(id), item.id);
  await expect.poll(() => groq.envois.length).toBe(2);
  await attendreEtat(page, 'idle', 12000);
  expect(audioEnvoye(groq.envois[1]).sec).toBeCloseTo(envoye.sec, 1);
});

test('une longue pause au milieu est raccourcie, la voix des deux côtés part', async ({ page, groq }) => {
  await ouvrir(page, { reglages: { ...REGLAGES, autoStop: '0' } });
  await page.evaluate(() => window.Verbe.App.toggle());
  await attendreEtat(page, 'recording');
  await page.waitForTimeout(1200);
  await couperLeSon(page);
  await page.waitForTimeout(3500); // une longue pause
  await remettreLeSon(page);
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.Verbe.App.stop());
  await attendreEtat(page, 'idle', 12000);
  const item = await page.evaluate(() => window.Verbe.App.last);
  expect(item.text).toBe('Bonjour, ceci est un test de Verbe.');
  const envoye = audioEnvoye(groq.envois[0]);
  expect(envoye.wav).toBe(true);
  expect(envoye.sec, 'les deux bouts de voix sont là').toBeGreaterThan(2.2);
  expect(envoye.sec, 'la pause de 3,5 s est ramenée à moins d’une seconde').toBeLessThan(item.durationMs / 1000 - 2.5);
});

test('« Ce qu’il te reste » compte l’audio envoyé, pas le silence coupé', async ({ page, groq }) => {
  test.setTimeout(90_000);
  await ouvrir(page, { reglages: { ...REGLAGES, autoStop: '4' } });
  await page.evaluate(() => window.Verbe.App.toggle());
  await attendreEtat(page, 'recording');
  await page.waitForTimeout(11500); // plus de 10 s de voix : au-dessus du minimum que Groq compte par requête
  await couperLeSon(page);
  await attendreEtat(page, 'idle', 15000);
  const envoye = audioEnvoye(groq.envois[0]);
  const { duree, journal } = await page.evaluate(() => ({ duree: window.Verbe.App.last.durationMs / 1000, journal: JSON.parse(localStorage.getItem('verbe.usage')) }));
  expect(envoye.wav).toBe(true);
  expect(journal).toHaveLength(1);
  expect(journal[0][1]).toBe('groq');
  expect(journal[0][2], 'le compteur suit l’audio envoyé').toBeCloseTo(envoye.sec, 0);
  expect(journal[0][2], 'les 4 s de silence de la fin ne sont pas comptées').toBeLessThan(duree - 3);
});

test('une dictée sans silence notable part telle quelle, sans être ré-encodée', async ({ page, groq }) => {
  await ouvrir(page);
  await page.evaluate(() => window.Verbe.App.toggle());
  await attendreEtat(page, 'recording');
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.Verbe.App.stop());
  await attendreEtat(page, 'idle', 12000);
  const envoye = audioEnvoye(groq.envois[0]);
  expect(envoye.wav).toBe(false);
  expect(envoye.fichier).toBe('audio.webm');
  expect(await page.evaluate(() => window.Verbe.App.last.text)).toBe('Bonjour, ceci est un test de Verbe.');
});
