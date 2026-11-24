import { describe, expect, test } from 'vitest';
import { TRIM, VOICE_DB, analyzeSpeech, encodeWav, silenceSpans, splitAtSilences, trimSilences } from '@lib/audio';

const SR = 16000;
/** son synthétique : une suite de [secondes, voix ?] → échantillons (voix = sinus de 220 Hz) */
function son(parts: [number, boolean][]): Float32Array {
  const n = parts.reduce((s, [sec]) => s + Math.round(sec * SR), 0), x = new Float32Array(n);
  let o = 0;
  for (const [sec, voix] of parts) {
    const m = Math.round(sec * SR);
    if (voix) for (let i = 0; i < m; i++) x[o + i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / SR);
    o += m;
  }
  return x;
}
const trames = (silence: number, voix: number, apres: number) => [
  ...Array(silence).fill(-90), ...Array(voix).fill(-20), ...Array(apres).fill(-90),
];

describe('détection de voix', () => {
  test('trop court pour juger : on laisse passer', () => {
    expect(analyzeSpeech([-90, -90, -90, -90])).toEqual({ ok: true, measured: false });
  });
  test('8 trames de voix (160 ms) suffisent, 7 non', () => {
    expect(analyzeSpeech(trames(20, 8, 20)).ok).toBe(true);
    expect(analyzeSpeech(trames(20, 7, 20)).ok).toBe(false);
  });
  test('le seuil est -46 dB', () => {
    expect(VOICE_DB).toBe(-46);
    expect(analyzeSpeech(Array(30).fill(-45)).ok).toBe(true);
    expect(analyzeSpeech(Array(30).fill(-47)).ok).toBe(false);
  });
});

describe('silences coupés', () => {
  test('aucune voix : rien à garder', () => {
    expect(silenceSpans(Array(100).fill(-90))).toBeNull();
  });
  test('garde 0,4 s avant la voix et 0,5 s après', () => {
    const plan = silenceSpans(trames(100, 50, 100))!; // 2 s de silence, 1 s de voix, 2 s de silence
    expect(plan.spans).toHaveLength(1);
    expect(plan.spans[0][0]).toBeCloseTo(2 - TRIM.lead, 5);
    expect(plan.spans[0][1]).toBeCloseTo(3 + TRIM.tail, 5);
  });
  test('une longue pause est ramenée à 0,7 s, la voix des deux côtés reste', () => {
    const x = son([[1, false], [1, true], [4, false], [1, true], [3, false]]); // 10 s
    const r = trimSilences(x, SR)!;
    expect(r).not.toBeNull();
    // 0,4 + 1 + 0,7 + 1 + 0,5 = 3,6 s (à une trame près)
    expect(r.sentSec).toBeCloseTo(3.6, 1);
    expect(r.removedSec).toBeCloseTo(10 - 3.6, 1);
    expect(r.samples.length).toBe(Math.round(r.sentSec * SR));
  });
  test('moins de 2 s à gagner : l\'audio part tel quel (null)', () => {
    expect(trimSilences(son([[0.5, false], [2, true], [1, false]]), SR)).toBeNull();
  });
});

describe('longs audios', () => {
  test('un audio court reste entier', () => {
    const x = new Float32Array(SR * 10);
    expect(splitAtSilences(x, SR)).toEqual([x]);
  });
  test('12 minutes : coupées en morceaux d\'environ 5 min, sans perdre un échantillon', () => {
    const x = son([[300, true], [1, false], [300, true], [1, false], [118, true]]);
    const parts = splitAtSilences(x, SR);
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(parts.reduce((n, p) => n + p.length, 0)).toBe(x.length);
    for (const p of parts.slice(0, -1)) expect(p.length / SR).toBeLessThanOrEqual(330);
  });
});

test('WAV 16 bits mono : en-tête juste et taille', async () => {
  const x = son([[0.5, true]]);
  const wav = new Uint8Array(await encodeWav(x, SR).arrayBuffer());
  const v = new DataView(wav.buffer);
  expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
  expect(String.fromCharCode(...wav.slice(8, 12))).toBe('WAVE');
  expect(v.getUint32(24, true)).toBe(SR); // fréquence
  expect(v.getUint16(22, true)).toBe(1); // mono
  expect(wav.length).toBe(44 + x.length * 2);
});
