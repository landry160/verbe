/* ============================================================
   6. Micro, niveau et enregistrement
   ============================================================ */
const WORKLET_SRC = `class VerbeNiveau extends AudioWorkletProcessor{constructor(){super();this.a=0;this.n=0;this.b=Math.round(sampleRate*0.02)}process(inputs){const c=inputs[0]&&inputs[0][0];if(c){for(let k=0;k<c.length;k++){const v=c[k];this.a+=v*v;if(++this.n>=this.b){this.port.postMessage(Math.sqrt(this.a/this.n));this.a=0;this.n=0}}}return true}}registerProcessor('verbe-niveau',VerbeNiveau);`;
const AudioEngine = {
  ctx: null, workletP: null, restT: 0,
  /* Créer le moteur audio bloque l'écran (~0,4 s la première fois) : on le fait
     d'avance, au repos, et un seul moteur sert à tout (micro, niveau, sons). */
  ensure() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    return this.ctx;
  },
  async getCtx() {
    clearTimeout(this.restT);
    const c = this.ensure();
    if (c.state === 'suspended') { try { await c.resume(); } catch (e) { /* ignore */ } }
    return c;
  },
  worklet(ctx) {
    if (!ctx.audioWorklet) return Promise.reject(new Error('no worklet'));
    /* data: plutôt que blob: — une page ouverte comme fichier (web, bureau) refuse les modules blob */
    if (!this.workletP) this.workletP = ctx.audioWorklet.addModule('data:text/javascript;charset=utf-8,' + encodeURIComponent(WORKLET_SRC));
    return this.workletP;
  },
  prewarm() {
    const go = () => { try { const c = this.ensure(); this.worklet(c).catch(() => {}); this.rest(); } catch (e) { /* le son reste un bonus */ } };
    if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 1500 }); else setTimeout(go, 400);
  },
  /* au repos, le moteur se met en veille : rien ne tourne pour rien en arrière-plan */
  rest() {
    clearTimeout(this.restT);
    this.restT = setTimeout(() => { if (!Rec.active && !Monitor.on && this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); }, 2500);
  },
};

/* Analyse en direct : 13 bandes (120 Hz → 5,2 kHz, échelle log) + niveau RMS */
class Meter {
  constructor(ctx, stream) {
    this.src = ctx.createMediaStreamSource(stream);
    this.an = ctx.createAnalyser();
    this.an.fftSize = 1024; this.an.smoothingTimeConstant = 0.5;
    this.src.connect(this.an);
    this.freq = new Float32Array(this.an.frequencyBinCount);
    this.time = new Float32Array(this.an.fftSize);
    this.bands = new Float32Array(13);
    const bin = ctx.sampleRate / this.an.fftSize;
    this.edges = [];
    for (let k = 0; k <= 13; k++) this.edges.push(Math.max(1, Math.round((120 * Math.pow(5200 / 120, k / 13)) / bin)));
    this.last = { bands: this.bands, level: 0, db: -120 };
  }
  read() {
    this.an.getFloatFrequencyData(this.freq);
    for (let k = 0; k < 13; k++) {
      const a = this.edges[k], b = Math.max(a + 1, this.edges[k + 1]);
      let s = 0; for (let i = a; i < b; i++) s += this.freq[i];
      const db = s / (b - a);
      this.bands[k] = Math.pow(clamp((db + 88) / 56, 0, 1), 1.6) || 0;
    }
    this.an.getFloatTimeDomainData(this.time);
    let s = 0; for (let i = 0; i < this.time.length; i++) s += this.time[i] * this.time[i];
    const db = 20 * Math.log10(Math.sqrt(s / this.time.length) + 1e-9);
    this.last = { bands: this.bands, level: clamp((db + 58) / 46, 0, 1), db };
    return this.last;
  }
  disconnect() { try { this.src.disconnect(); } catch (e) { /* ignore */ } }
}

function pickMime() {
  if (!window.MediaRecorder) return '';
  for (const m of ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm']) {
    if (MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return '';
}

/* Mode gratuit : la reconnaissance vocale du navigateur (Web Speech API) */
function freeError(code) {
  if (code === 'not-allowed' || code === 'service-not-allowed') return userError('mic-denied', 'Accès au micro refusé.', 'Autorise le micro avec le cadenas à gauche de l’adresse.');
  if (code === 'network') return userError('network', 'Le mode gratuit a besoin d’Internet.', 'Chrome envoie l’audio à Google pour le reconnaître.');
  if (code === 'audio-capture') return userError('no-mic', 'Aucun micro détecté.', 'Branche un micro ou un casque.');
  if (code === 'language-not-supported') return userError('lang', 'Cette langue n’est pas offerte par le navigateur.', 'Choisis une autre langue dans Réglages.');
  return userError('free', 'La reconnaissance du navigateur a échoué.', 'Ajoute une clé Groq (gratuite) pour plus de fiabilité.');
}
class FreeRecognizer {
  constructor(lang, onPartial) { this.lang = lang; this.onPartial = onPartial; this.finals = []; this.interim = ''; this.running = false; this.err = null; this.local = false; }
  async start(track) {
    /* même règle que le micro : la reconnaissance part de la fenêtre active */
    const W = activeWin(), C = W.SpeechRecognition || W.webkitSpeechRecognition || SR;
    const r = this.r = new C();
    r.lang = this.lang; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
    if (Settings.d.freeLocal && 'processLocally' in r && typeof C.available === 'function') {
      try { if ((await C.available({ langs: [this.lang], processLocally: true })) === 'available') { r.processLocally = true; this.local = true; } } catch (e) { /* cloud */ }
    }
    r.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) this.finals.push(res[0].transcript.trim()); else interim += res[0].transcript;
      }
      this.interim = interim.trim();
      this.onPartial?.(this.text());
    };
    r.onerror = e => { if (e.error !== 'no-speech' && e.error !== 'aborted') this.err = e.error; };
    r.onend = () => {
      if (this.running && !this.err) { try { r.start(track); } catch (e) { try { r.start(); } catch (e2) { /* fin */ } } }
      else this._ended?.();
    };
    this.running = true;
    await new Promise((res, rej) => {
      const t = setTimeout(res, 1500);
      r.onstart = () => { clearTimeout(t); res(); };
      try { r.start(track); } catch (e) { try { r.start(); } catch (e2) { clearTimeout(t); rej(e2); } }
    });
    if (this.err) throw freeError(this.err);
  }
  text() { return [...this.finals, this.interim].join(' ').replace(/\s+/g, ' ').trim(); }
  async stop() {
    this.running = false;
    await new Promise(res => { this._ended = res; setTimeout(res, 2500); try { this.r.stop(); } catch (e) { res(); } });
    const txt = this.text();
    if (this.err && !txt) throw freeError(this.err);
    return txt;
  }
  abort() { this.running = false; try { this.r.abort(); } catch (e) { /* ignore */ } }
}

const Rec = {
  active: false, stream: null, meter: null, node: null, mr: null, chunks: [], mime: '', t0: 0,
  frames: [], fallback: 0, free: null, onEnded: null, realm: null, voiced: 0, lastVoice: 0,
  async open() {
    const id = Settings.d.micId;
    const base = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
    /* Chrome n'ouvre le micro que pour la fenêtre qui a le focus : si la
       dictée part d'un clic dans la mini-fenêtre, on le demande par elle. */
    const W = activeWin(), md = W.navigator.mediaDevices;
    this.realm = W;
    try {
      return await md.getUserMedia({ audio: id && id !== 'default' ? { ...base, deviceId: { exact: id } } : base });
    } catch (e) {
      if ((e.name === 'OverconstrainedError' || e.name === 'NotFoundError') && id && id !== 'default') {
        Settings.set('micId', 'default');
        Toast.show({ type: 'warn', text: 'Le micro choisi est introuvable.', sub: 'Verbe utilise le micro par défaut.' });
        return await md.getUserMedia({ audio: base });
      }
      throw e;
    }
  },
  async start(useFree, onPartial) {
    /* v0.2 : le micro et le moteur audio s'ouvrent en même temps, et
       l'enregistrement part dès que le micro répond (rien n'est perdu
       pendant que l'analyse du niveau se prépare). */
    const ctxP = AudioEngine.getCtx();
    this.stream = await this.open();
    const track = this.stream.getAudioTracks()[0];
    track.addEventListener('ended', () => this.onEnded?.());
    if (!useFree) {
      this.mime = pickMime(); this.chunks = [];
      this.mr = new MediaRecorder(this.stream, this.mime ? { mimeType: this.mime, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 });
      this.mr.ondataavailable = e => { if (e.data && e.data.size) this.chunks.push(e.data); };
      this.mr.start(1000);
    }
    this.t0 = now();
    const ctx = await ctxP;
    this.meter = new Meter(ctx, this.stream);
    this.frames = []; this.voiced = 0; this.lastVoice = now();
    try {
      await AudioEngine.worklet(ctx);
      this.node = new AudioWorkletNode(ctx, 'verbe-niveau', { numberOfInputs: 1, numberOfOutputs: 0 });
      this.node.port.onmessage = e => this.frame(20 * Math.log10(e.data + 1e-9));
      this.meter.src.connect(this.node);
    } catch (e) {
      this.node = null;
      this.fallback = setInterval(() => { if (this.meter) this.frame(this.meter.read().db); }, 20);
    }
    if (useFree) {
      this.free = new FreeRecognizer(srLang(), onPartial);
      await this.free.start(track);
      this.t0 = now();
    }
    this.active = true;
  },
  frame(db) {
    this.frames.push(db);
    if (db > VOICE_DB) { this.voiced++; this.lastVoice = now(); }
  },
  async stop() {
    const durationMs = now() - this.t0;
    let blob = null, text = '', speech = { ok: true, measured: false };
    try {
      if (this.mr) {
        if (this.mr.state !== 'inactive') await new Promise(res => { this.mr.onstop = res; try { this.mr.stop(); } catch (e) { res(); } });
        blob = new Blob(this.chunks, { type: (this.mr.mimeType || this.mime || 'audio/webm').split(';')[0] });
      }
      if (this.free) text = await this.free.stop();
    } finally {
      speech = analyzeSpeech(this.frames);
      this.release();
    }
    return { blob, text, durationMs, speech };
  },
  cancel() {
    try { if (this.mr && this.mr.state !== 'inactive') { this.mr.ondataavailable = null; this.mr.stop(); } } catch (e) { /* ignore */ }
    this.free?.abort();
    this.release();
  },
  release() {
    clearInterval(this.fallback); this.fallback = 0;
    try { this.node?.port && (this.node.port.onmessage = null); this.node?.disconnect(); } catch (e) { /* ignore */ }
    this.meter?.disconnect();
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null; this.meter = null; this.node = null; this.mr = null; this.free = null; this.active = false; this.realm = null;
    AudioEngine.rest();
  },
};

/* Liste des micros + détection d'un casque branché */
const Mics = {
  list: [], labelsOk: false, ready: false,
  clean(label) { return String(label || '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').replace(/^(Default|Par défaut|Communications)\s*-\s*/i, '').trim(); },
  async refresh() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      this.list = all.filter(d => d.kind === 'audioinput');
      this.labelsOk = this.list.some(d => d.label);
    } catch (e) { this.list = []; }
    this.ready = true;
    return this.list;
  },
  name(id) {
    const d = this.list.find(x => x.deviceId === id) || (id === 'default' ? this.list.find(x => x.deviceId === 'default') : null);
    if (!id || id === 'default') return d && d.label ? `Par défaut (${this.clean(d.label)})` : 'Micro par défaut';
    return d ? (this.clean(d.label) || 'Micro') : 'Micro débranché';
  },
  async onChange() {
    const before = new Map(this.list.map(d => [d.deviceId, d]));
    await this.refresh();
    const virt = id => id === 'default' || id === 'communications';
    const added = this.list.filter(d => !before.has(d.deviceId) && !virt(d.deviceId) && d.label);
    const sel = Settings.d.micId;
    const lostSel = sel && sel !== 'default' && before.has(sel) && !this.list.some(d => d.deviceId === sel);
    if (lostSel && !Rec.active) {
      Settings.set('micId', 'default');
      Toast.show({ type: 'warn', text: `« ${this.clean(before.get(sel).label)} » est débranché.`, sub: 'Verbe utilise maintenant le micro par défaut.' });
    } else if (added.length) {
      const d = added[0];
      Toast.show({
        type: 'info', text: `Nouveau micro : ${this.clean(d.label)}`, sub: 'Veux-tu dicter avec lui ?', duration: 10000,
        action: { label: 'Utiliser', fn: () => { Settings.set('micId', d.deviceId); UI.renderMics(); UI.renderChips(); Toast.show({ type: 'ok', text: `Micro choisi : ${this.clean(d.label)}` }); } },
      });
    }
    UI.renderMics(); UI.renderChips();
  },
};
