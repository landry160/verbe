/* ============================================================
   2. Services de transcription
   Prix vérifiés en novembre 2026 (voir PROJET.md pour les sources).
   ============================================================ */
const PROVIDERS = {
  groq: {
    name: 'Groq', label: 'Groq · recommandé', kind: 'openai',
    url: 'https://api.groq.com/openai/v1/audio/transcriptions', test: 'https://api.groq.com/openai/v1/models',
    model: 'whisper-large-v3-turbo', models: ['whisper-large-v3-turbo', 'whisper-large-v3'],
    keyUrl: 'https://console.groq.com/keys', keyHint: 'gsk_…', keyCta: 'Obtenir une clé gratuite', maxBytes: 24e6,
    note: 'Le plus rapide. Gratuit jusqu’à 8 h d’audio par jour.',
  },
  openai: {
    name: 'OpenAI', label: 'OpenAI', kind: 'openai',
    url: 'https://api.openai.com/v1/audio/transcriptions', test: 'https://api.openai.com/v1/models',
    model: 'gpt-transcribe', models: ['gpt-transcribe', 'gpt-4o-mini-transcribe'],
    keyUrl: 'https://platform.openai.com/api-keys', keyHint: 'sk-…', keyCta: 'Obtenir une clé', maxBytes: 24e6,
    note: 'Très précis. Environ 0,27 $ US par heure d’audio, sans forfait gratuit.',
  },
  mistral: {
    name: 'Mistral', label: 'Mistral · Voxtral', kind: 'openai',
    url: 'https://api.mistral.ai/v1/audio/transcriptions', test: 'https://api.mistral.ai/v1/models',
    model: 'voxtral-mini-transcribe-3', models: ['voxtral-mini-transcribe-3', 'voxtral-small-transcribe-3', 'voxtral-mini-latest'],
    keyUrl: 'https://console.mistral.ai/api-keys', keyHint: '', keyCta: 'Obtenir une clé', maxBytes: 24e6,
    note: 'Fort en français. Environ 0,21 $ US par heure d’audio.',
  },
  gemini: {
    name: 'Gemini', label: 'Google Gemini', kind: 'gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta/models/', test: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
    model: 'gemini-flash-latest', models: ['gemini-flash-latest', 'gemini-flash-lite-latest'],
    keyUrl: 'https://aistudio.google.com/apikey', keyHint: 'AIza…', keyCta: 'Obtenir une clé gratuite', maxBytes: 14e6,
    note: 'Clé gratuite dans Google AI Studio (forfait gratuit limité : Google peut alors utiliser l’audio pour s’améliorer). Avec Google AI Pro, tu as aussi 10 $ US de crédits par mois.',
  },
  navigateur: {
    name: 'Navigateur', label: 'Navigateur · gratuit, sans clé', kind: 'webspeech',
    note: 'Gratuit, sans clé, dans Chrome et Edge. Moins précis, peu de ponctuation, et ne lit pas les fichiers.',
  },
};
const modelOf = pid => (Settings.d.models[pid] || '').trim() || PROVIDERS[pid].model;

/* ============================================================
   2 bis. Ce qu'il reste avant la limite du service (v0.4)
   Groq renvoie ses compteurs dans chaque réponse (requêtes par jour), mais
   ne les laisse pas lire par une page web : l'app bureau les rend lisibles.
   Sinon, Verbe compte ce que cet appareil a envoyé sur les dernières 24 h
   et le compare aux limites publiées (console.groq.com/docs/rate-limits,
   vérifiées le 23 nov. 2026 : forfait gratuit, Whisper).
   ============================================================ */
const LIMITS = {
  groq: { free: { rpd: 2000, asd: 28800, ash: 7200 }, dev: { rpd: 200000, asd: 4000000, ash: 400000 }, minSec: 10 },
};
const PRICE_H = { openai: 0.27, mistral: 0.21 }; /* $ US par heure d'audio, comme dans les notes des services */
const DAY_MS = 86400000, HOUR_MS = 3600000;
function parseDur(s) { /* « 2m59.56s », « 1h2m », « 120ms » → millisecondes */
  let ms = 0;
  String(s || '').replace(/([\d.]+)(ms|h|m|s)/g, (_, n, u) => { ms += +n * { ms: 1, s: 1000, m: 60000, h: 3600000 }[u]; return ''; });
  return ms;
}
function fmtAudio(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')}` : m ? `${m} min` : `${sec} s`;
}
function fmtWait(ms) {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')}`;
}
const nf0 = new Intl.NumberFormat('fr-CA');
const Quota = {
  read(k, def) { try { return JSON.parse(localStorage.getItem(k) || 'null') || def; } catch (e) { return def; } },
  write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* stockage plein ou bloqué : ce n'est qu'un compteur */ } },
  /* un envoi réussi : Groq compte au moins 10 s par requête */
  add(pid, sec) {
    const s = Math.max(LIMITS[pid]?.minSec || 0, sec || 0), now = Date.now();
    const log = this.read('verbe.usage', []).filter(e => now - e[0] < DAY_MS);
    log.push([now, pid, Math.round(s * 10) / 10]);
    this.write('verbe.usage', log.slice(-5000));
  },
  used(pid, win) {
    const now = Date.now(); let req = 0, sec = 0;
    for (const [t, p, s] of this.read('verbe.usage', [])) if (p === pid && now - t < win) { req++; sec += s; }
    return { req, sec };
  },
  /* la limite glisse sur 24 h : chaque envoi revient 24 h après. Le plus ancien encore compté revient le premier. */
  next(pid) {
    const now = Date.now(); let first = null;
    for (const e of this.read('verbe.usage', [])) if (e[1] === pid && now - e[0] < DAY_MS && (!first || e[0] < first[0])) first = e;
    return first && { at: first[0] + DAY_MS, sec: first[2] };
  },
  /* les compteurs officiels, quand la réponse les laisse lire */
  fromHeaders(pid, h) {
    const lim = Number(h.get('x-ratelimit-limit-requests')), rem = h.get('x-ratelimit-remaining-requests');
    if (!lim || rem == null) return;
    const all = this.read('verbe.quota', {});
    all[pid] = { at: Date.now(), limit: lim, remaining: Number(rem), resetAt: Date.now() + parseDur(h.get('x-ratelimit-reset-requests')) };
    this.write('verbe.quota', all);
  },
  view(pid) {
    const P = PROVIDERS[pid];
    if (!P || P.kind === 'webspeech') return { kind: 'free' };
    const day = this.used(pid, DAY_MS);
    if (PRICE_H[pid]) return { kind: 'paid', day, cost: (day.sec / 3600) * PRICE_H[pid] };
    const L = LIMITS[pid];
    if (!L) return { kind: 'unknown', day };
    const api = this.read('verbe.quota', {})[pid], fresh = !!api && Date.now() - api.at < DAY_MS;
    const plan = fresh && api.limit >= 100000 ? 'dev' : 'free', lim = L[plan];
    const req = fresh ? { left: Math.max(0, api.remaining), limit: api.limit } : { left: Math.max(0, lim.rpd - day.req), limit: lim.rpd };
    const audio = { left: Math.max(0, lim.asd - day.sec), limit: lim.asd };
    const hourLeft = Math.max(0, lim.ash - this.used(pid, HOUR_MS).sec);
    const fr = Math.min(req.left / req.limit, audio.left / audio.limit, hourLeft / lim.ash);
    const byAudio = audio.left / audio.limit <= req.left / req.limit;
    const short = byAudio ? `${fmtAudio(audio.left)} d’audio` : `${nf0.format(req.left)} requêtes`;
    const tiny = byAudio ? `${fmtAudio(audio.left)} restantes` : `${nf0.format(req.left)} requêtes`; /* pour la colonne des sections */
    return { kind: 'limits', plan, req, audio, hourLeft, ash: lim.ash, api: fresh ? api : null, low: fr < 0.15, empty: fr <= 0, short, tiny, day, next: this.next(pid) };
  },
};
const srLang = () => ({ fr: 'fr-CA', en: 'en-CA' }[Settings.d.lang] || navigator.language || 'fr-CA');

/* Progrès (en haut de l'Historique) : un compteur à part, car l'historique ne garde que 100 dictées.
   Une dictée au micro réussie compte une seule fois : ni « Nettoyer », ni une retranscription, ni un fichier.
   Forme : { v, n (dictées), w (mots), ms (temps de parole), days: { 'AAAA-MM-JJ': [n, w, ms] } } */
const STATS_KEY = 'verbe.stats';
const TYPING_WPM = 40; /* hypothèse : vitesse de frappe au clavier */
const dayKey = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const Stats = {
  read() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(STATS_KEY) || 'null'); } catch (e) { s = null; }
    if (!s || typeof s !== 'object' || !(s.n >= 0)) s = { v: 1, n: 0, w: 0, ms: 0, days: {} };
    if (!s.days || typeof s.days !== 'object') s.days = {};
    return s;
  },
  write(s) {
    for (const k of Object.keys(s.days).sort().slice(0, -400)) delete s.days[k]; /* les jours suffisent pour la semaine et la série */
    try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch (e) { /* stockage bloqué : ce n'est qu'un compteur */ }
  },
  bump(s, it) {
    const k = dayKey(it.createdAt || Date.now()), d = s.days[k] || [0, 0, 0], ms = Math.max(0, Math.round(it.durationMs || 0));
    s.n++; s.w += it.words; s.ms += ms;
    s.days[k] = [d[0] + 1, d[1] + it.words, d[2] + ms];
  },
  /* relu juste avant d'écrire : la bulle et la fenêtre principale (bureau) partagent ce compteur */
  add(item) {
    if (!item || item.counted || item.source !== 'micro' || item.status !== 'ok' || !item.words) return false;
    item.counted = true;
    const s = this.read(); this.bump(s, item); this.write(s);
    return true;
  },
  /* la première fois : on part des dictées déjà gardées dans l'historique */
  seed(items) {
    try { if (localStorage.getItem(STATS_KEY) != null) return; } catch (e) { return; }
    const s = this.read();
    for (const it of items) if (it.status === 'ok' && it.source === 'micro' && it.words) this.bump(s, it);
    this.write(s);
  },
  summary(at = Date.now()) {
    const s = this.read(), d = new Date(at);
    const monday = dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)));
    let week = 0;
    for (const [k, v] of Object.entries(s.days)) if (k >= monday) week += v[1] || 0;
    /* série : jours de suite avec au moins une dictée, jusqu'à aujourd'hui (ou hier) */
    let streak = 0;
    const c = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (!s.days[dayKey(c)]) c.setDate(c.getDate() - 1);
    while (s.days[dayKey(c)]) { streak++; c.setDate(c.getDate() - 1); }
    return { n: s.n, words: s.w, week, ms: s.ms, gainMs: Math.max(0, (s.w / TYPING_WPM) * 60000 - s.ms), streak };
  },
};
