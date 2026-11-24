/* Traitement du signal : logique pure (ni page, ni réglage), testée avec Vitest (tests/unit). */

/** WAV PCM 16 bits mono : 16 000 échantillons/s × 2 octets = 32 ko/s ≈ 1,9 Mo/min */
export function encodeWav(samples: Float32Array, sr: number): Blob {
  const n = samples.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0, o = 44; i < n; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/** Découpe un long audio en morceaux d'environ 5 min, en coupant dans le passage
    le plus silencieux (énergie moyenne sur 300 ms) autour de chaque cible. */
export function splitAtSilences(x: Float32Array, sr: number, targetSec = 300, windowSec = 25): Float32Array[] {
  const total = x.length, target = targetSec * sr;
  if (total <= target * 1.2) return [x];
  const F = Math.round(sr * 0.02), nF = Math.floor(total / F), e = new Float32Array(nF);
  for (let f = 0; f < nF; f++) { let s = 0; const o = f * F; for (let i = 0; i < F; i++) { const v = x[o + i]; s += v * v; } e[f] = s / F; }
  const W = 15, cuts = [0];
  let pos = 0;
  while (total - pos > target * 1.2) {
    const ideal = (pos + target) / F, span = (windowSec * sr) / F;
    const lo = Math.max(Math.floor(pos / F) + 1, Math.floor(ideal - span)), hi = Math.min(nF - W, Math.ceil(ideal + span));
    let best = Math.round(ideal), bestV = Infinity;
    for (let f = lo; f <= hi; f++) {
      let s = 0; for (let k = 0; k < W; k++) s += e[f + k];
      if (s < bestV) { bestV = s; best = f + (W >> 1); }
    }
    const cut = best * F;
    if (cut <= pos || cut >= total) break;
    cuts.push(cut); pos = cut;
  }
  cuts.push(total);
  const parts: Float32Array[] = [];
  for (let i = 0; i < cuts.length - 1; i++) parts.push(x.subarray(cuts[i], cuts[i + 1]));
  return parts;
}

/** Y a-t-il de la voix ? Une trame de 20 ms compte si elle dépasse -46 dBFS.
    Il en faut 8 (160 ms) : ça évite d'envoyer du silence, sur lequel Whisper
    « hallucine » des phrases comme « Sous-titrage Société Radio-Canada ». */
export const VOICE_DB = -46, VOICE_FRAMES = 8;

export interface Parole { ok: boolean; measured: boolean; speechMs?: number; maxDb?: number }

export function analyzeSpeech(frames: ArrayLike<number>): Parole {
  if (frames.length < 5) return { ok: true, measured: false };
  let n = 0, max = -200;
  for (let i = 0; i < frames.length; i++) { const d = frames[i]; if (d > VOICE_DB) n++; if (d > max) max = d; }
  return { ok: n >= VOICE_FRAMES, measured: true, speechMs: n * 20, maxDb: max };
}

/** Silences coupés avant l'envoi. Avec l'arrêt automatique, une dictée finit par 10 s à 1 min
    de silence : on ne l'envoie pas (moins de temps compté chez le service, réponse plus rapide,
    et Whisper n'invente pas de phrases sur le vide). Voix = trame au-dessus de VOICE_DB, comme
    pour l'arrêt automatique. On garde 0,4 s avant la première voix et 0,5 s après la dernière ;
    une pause de plus de 2 s est ramenée à 0,7 s ; entre deux voix plus proches, rien n'est touché.
    Moins de 2 s à gagner : l'audio part tel quel, sans être ré-encodé. */
export const TRIM = { lead: 0.4, tail: 0.5, maxPause: 2, keepPause: 0.7, minGain: 2 };

export interface PlanSilences { spans: [number, number][]; totalSec: number; keptSec: number; gainSec: number }

/** frames : niveaux en dB par trame de step secondes → passages à garder, en secondes (null : aucune voix) */
export function silenceSpans(frames: ArrayLike<number>, step = 0.02): PlanSilences | null {
  const total = frames.length * step, isl: [number, number][] = [];
  let a = -1, b = -1;
  for (let i = 0; i < frames.length; i++) {
    if (!(frames[i] > VOICE_DB)) continue;
    if (a < 0) a = i;
    else if ((i - b - 1) * step > TRIM.maxPause) { isl.push([a, b]); a = i; }
    b = i;
  }
  if (a < 0) return null;
  isl.push([a, b]);
  const half = TRIM.keepPause / 2;
  const spans = isl.map(([i, j], k): [number, number] => [
    Math.max(0, i * step - (k ? half : TRIM.lead)),
    Math.min(total, (j + 1) * step + (k < isl.length - 1 ? half : TRIM.tail)),
  ]);
  const keptSec = spans.reduce((n, [x, y]) => n + y - x, 0);
  return { spans, totalSec: total, keptSec, gainSec: total - keptSec };
}

/** x : échantillons → { samples, sentSec, removedSec }, ou null s'il n'y a pas assez à gagner */
export function trimSilences(x: Float32Array, sr: number): { samples: Float32Array; sentSec: number; removedSec: number } | null {
  const F = Math.round(sr * 0.02), nF = Math.ceil(x.length / F), db = new Float32Array(nF);
  for (let f = 0; f < nF; f++) {
    const o = f * F, m = Math.min(F, x.length - o); let s = 0;
    for (let i = 0; i < m; i++) { const v = x[o + i]; s += v * v; }
    db[f] = 20 * Math.log10(Math.sqrt(s / m) + 1e-9);
  }
  const plan = silenceSpans(db, F / sr);
  if (!plan || plan.gainSec < TRIM.minGain) return null;
  const parts = plan.spans.map(([a, b]) => x.subarray(Math.round(a * sr), Math.min(x.length, Math.round(b * sr))));
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0)), fade = Math.round(sr * 0.005);
  let o = 0;
  parts.forEach((p, k) => { /* fondu de 5 ms à chaque raccord : pas de clic */
    out.set(p, o);
    for (let i = 0; i < fade && i < p.length; i++) {
      if (k) out[o + i] *= i / fade;
      if (k < parts.length - 1) out[o + p.length - 1 - i] *= i / fade;
    }
    o += p.length;
  });
  return { samples: out, sentSec: out.length / sr, removedSec: (x.length - out.length) / sr };
}
