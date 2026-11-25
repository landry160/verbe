/* ============================================================
   7. L'île : l'indicateur animé
   ============================================================ */
function makeSim() {
  /* Signal « parole » de synthèse pour l'aperçu : syllabes de 120–280 ms */
  const syl = []; let t = 0.2;
  while (t < 5) { const d = 0.12 + Math.random() * 0.16; syl.push([t, d, 0.55 + Math.random() * 0.45]); t += d + (Math.random() < 0.18 ? 0.3 + Math.random() * 0.3 : 0.03 + Math.random() * 0.07); }
  const bands = new Float32Array(13), shape = Array.from({ length: 13 }, (_, k) => Math.exp(-k / 6) * (0.85 + 0.3 * Math.random()));
  const t0 = now();
  return {
    read() {
      const s = (now() - t0) / 1000; let env = 0;
      for (const [a, d, amp] of syl) if (s >= a && s <= a + d) env = Math.max(env, amp * Math.sin(Math.PI * (s - a) / d));
      for (let k = 0; k < 13; k++) bands[k] = clamp(env * shape[k] * (0.75 + 0.35 * Math.random()), 0, 1);
      return { bands, level: env * 0.95, db: -60 + env * 40 };
    },
  };
}

/* Marque Verbe (barres en V) pour l'état « Prêt » de la mini-fenêtre */
const MARK_SVG = `<svg class="isl-mark" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="islmk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#AF6318"/><stop offset="1" stop-color="#8A4418"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#islmk)"/><g stroke="#fff" stroke-width="5.2" stroke-linecap="round"><path d="M17 18v28"/><path d="M24.5 25v21"/><path d="M32 32v14"/><path d="M39.5 25v21"/><path d="M47 18v28"/></g></svg>`;
const STOP_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="3" fill="currentColor"/></svg>';
const SPIN_SVG = '<svg class="spin" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="2.5"/><path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="#E9A35F" stroke-width="2.5" stroke-linecap="round"/></svg>';

const Island = {
  state: 'hidden', data: {}, source: null, raf: 0, lastT: 0, hideTimer: 0, offTimer: 0,
  W: 0, H: 0, dpr: 1, levels: new Float32Array(26), lvl: 0, phase: [0, 0, 0],
  lastRects: [], blocks: null, morph: null, progress: null, clock0: 0, win: window,
  /* l'île est dans la mini-fenêtre plutôt que dans la page */
  get inPip() { return this.win !== window; },
  init() {
    this.root = $('#island'); this.shell = $('#isl'); this.l = $('#isl-l'); this.t = $('#isl-t'); this.s = $('#isl-s'); this.r = $('#isl-r');
    this.cap = $('#isl-cap'); this.act = $('#isl-act'); this.canvas = $('#isl-cv'); this.g = this.canvas.getContext('2d');
    /* Redimensionner un canevas l'efface : on note le changement et on
       l'applique au début de l'image suivante, juste avant de redessiner.
       (frame() vérifie aussi la taille : l'observateur de la page ne voit
       plus le canevas quand il vit dans la mini-fenêtre.) */
    new ResizeObserver(() => { this.dirty = true; this.loop(); }).observe(this.canvas);
    this.setPos(Settings.d.islandPos);
    if (IS_BUBBLE) {
      this.root.classList.add('bulle', 'pip'); /* même mise en page que la mini-fenêtre */
      /* la fenêtre laisse passer les clics, sauf sur la pastille : la page dit où elle est, l'app regarde
         où est le curseur (v0.6.4 : plus de suivi de la souris de Windows, qui sautait quand l'ordi gelait) */
      let last = '';
      this.tellPill = () => {
        const r = this.shell.getBoundingClientRect();
        const box = this.root.hidden || !r.width || !r.height ? null : { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
        const k = JSON.stringify(box);
        if (k !== last) { last = k; Desktop.pill?.(box); }
      };
      new ResizeObserver(() => this.tellPill()).observe(this.shell);
      new ResizeObserver(() => this.tellPill()).observe(document.documentElement);
    }
  },
  setPos(p) { this.root.dataset.pos = p; },
  /* Déplace l'île dans une autre fenêtre (la mini-fenêtre, ou la page au retour) */
  moveTo(w) {
    if (this.raf) { try { this.win.cancelAnimationFrame(this.raf); } catch (e) { /* fenêtre fermée */ } this.raf = 0; }
    this.win = w;
    const pip = w !== window, R = this.root;
    R.classList.toggle('pip', pip);
    w.document.body.append(R);
    this.dirty = true;
    const live = this.state === 'starting' || this.state === 'recording' || this.state === 'transcribing';
    if (live) this.show(this.state, Object.assign({}, this.data, { autoHide: 0 })); /* l'écoute continue, sans à-coup */
    else if (pip) this.show('ready');
    else if (this.state === 'ready') { this.state = 'hidden'; R.dataset.state = 'hidden'; R.hidden = true; R.classList.remove('on'); }
    else if (this.state !== 'hidden') this.hide();
    this.loop();
  },
  resize() {
    const r = this.canvas.getBoundingClientRect(), dpr = Math.min(2, this.win.devicePixelRatio || 1);
    if (!r.width || !r.height) return;
    this.W = r.width; this.H = r.height; this.dpr = dpr;
    this.canvas.width = Math.round(r.width * dpr); this.canvas.height = Math.round(r.height * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  },
  show(state, data = {}) {
    clearTimeout(this.hideTimer); clearTimeout(this.offTimer);
    const prev = this.state;
    this.state = state; this.data = data;
    const R = this.root;
    R.hidden = false; R.dataset.state = state;
    this.shell.setAttribute('role', state === 'error' ? 'alert' : 'status');
    this.shell.classList.toggle('has-cap', state === 'recording' && !!data.caption);
    this.shell.classList.remove('shake');
    this.cap.hidden = !(state === 'recording' && data.caption);
    if (this.cap.hidden) this.cap.textContent = '';
    this.r.textContent = '';
    this.t.className = 'isl-t'; this.s.className = 'isl-s';
    this.t.textContent = ''; this.s.textContent = '';
    this.shell.style.setProperty('--glow', '0');
    this.progress = null;
    /* chrono tenu par l'animation : il avance même si l'onglet Verbe est en arrière-plan */
    if (state !== 'recording') this.clock0 = 0; else if (prev !== 'recording') this.clock0 = data.clock0 || now();
    if (state === 'ready') {
      this.l.innerHTML = MARK_SVG;
      this.t.textContent = 'Prêt à dicter';
      this.s.textContent = COARSE.matches ? 'Touche le micro, parle, puis colle.' : `Clique le micro, parle, puis colle avec ${pasteHint()}.`;
      this.r.textContent = COARSE.matches ? '' : UI.scLabel().join(' ');
    }
    if (state === 'starting') { this.l.innerHTML = '<span class="dot"></span>'; this.t.textContent = 'Ouverture du micro…'; }
    if (state === 'recording') {
      this.l.innerHTML = '<span class="dot"></span>';
      if (prev !== 'recording') {
        this.levels.fill(0); this.lvl = 0;
        this.t.textContent = data.preview ? 'Aperçu' : data.title || 'À l’écoute';
        this.t.classList.add('intro');
        clearTimeout(this.introTimer);
        this.introTimer = setTimeout(() => this.t.classList.remove('intro'), 750);
      }
      this.r.textContent = '0:00';
    }
    if (state === 'transcribing') {
      this.l.innerHTML = `<svg class="spin" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="2.5"/><path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="#E9A35F" stroke-width="2.5" stroke-linecap="round"/></svg>`;
      this.r.textContent = data.label || '';
      this.startMorph(prev === 'recording');
      this.shell.setAttribute('aria-label', 'Transcription en cours');
    } else this.shell.removeAttribute('aria-label');
    if (state === 'done') {
      this.l.innerHTML = `<span class="okc"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg></span>`;
      const words = String(data.text || '').split(/\s+/).filter(Boolean).slice(0, 14);
      this.t.innerHTML = words.map((w, i) => `<span class="w" style="--i:${i}">${esc(w)}</span>`).join(' ');
      this.s.textContent = data.note ? data.note : data.preview ? 'Aperçu : rien n’a été copié' : data.sub ? data.sub : data.pasted ? pastedLine() : data.copied ? copiedLine() : (COARSE.matches ? 'Touche ici pour copier le texte' : 'Clique ici pour copier le texte');
      this.s.classList.add('fade');
      this.r.textContent = data.words ? plural(data.words, 'mot', 'mots') : '';
    }
    if (state === 'warn' || state === 'error') {
      this.l.innerHTML = state === 'warn'
        ? `<span class="warnc">${icon('alert', 17)}</span>`
        : `<span class="errc"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 7v6"/><path d="M12 17h.01"/></svg></span>`;
      this.t.textContent = data.text || ''; this.s.textContent = data.hint || '';
      if (state === 'error') { void this.shell.offsetWidth; this.shell.classList.add('shake'); }
    }
    if (state === 'cancelled') { this.l.innerHTML = `<span class="xc">${icon('x', 16)}</span>`; this.t.textContent = 'Dictée annulée'; }
    this.shell.title = state === 'ready' ? 'Clique pour dicter' : state === 'recording' ? 'Clique pour terminer' : state === 'done' && !data.preview ? 'Clique pour copier' : (state === 'error' || state === 'warn') ? 'Clique pour fermer' : '';
    /* bouton de la mini-fenêtre : micro quand elle attend, carré pendant l'écoute */
    const act = this.act;
    if (state === 'ready' || state === 'recording') {
      const rec = state === 'recording';
      act.innerHTML = rec ? STOP_SVG.replace(/16/g, '20') : icon('mic', 26);
      act.setAttribute('aria-label', rec ? 'Terminer la dictée' : 'Démarrer la dictée');
    } else if (state === 'starting' || state === 'transcribing') {
      act.innerHTML = SPIN_SVG;
      act.setAttribute('aria-label', state === 'starting' ? 'Ouverture du micro' : 'Transcription en cours');
    }
    if ((this.inPip || IS_BUBBLE) && state === 'transcribing') this.l.innerHTML = '';
    act.tabIndex = this.inPip && (state === 'ready' || state === 'recording') ? 0 : -1;
    if (IS_BUBBLE) {
      Desktop.bubble(Settings.d.islandPos || 'center');
      /* la bulle ne prend pas le clavier : un message s'efface tout seul */
      if ((state === 'error' || state === 'warn') && !data.autoHide) data.autoHide = 6500;
    }
    this.place();
    this.win.requestAnimationFrame(() => { R.classList.add('on'); this.dirty = true; this.tellPill?.(); });
    if (IS_BUBBLE) { clearTimeout(this.pillT); this.pillT = setTimeout(() => this.tellPill?.(), 450); } /* après l'animation d'entrée */
    this.loop();
    if (data.autoHide) this.hideTimer = setTimeout(() => this.hide(), data.autoHide);
  },
  /* Sur Dicter, au centre, la pastille se pose à la place du libellé sous le
     micro : elle ne cache plus le micro. Ailleurs, le CSS la pose en bas. */
  place() {
    const R = this.root;
    if (this.miroir && this.state !== 'hidden') {
      const a = document.body.dataset.view === 'dicter' ? $('#mic') : $('#dock'), r = a.getBoundingClientRect();
      R.classList.add('under-mic');
      R.style.setProperty('--isl-top', `${Math.round(r.top + r.height / 2 - 26)}px`);
      return;
    }
    /* fenêtre principale du bureau : toujours sous le micro sur Dicter (la bulle, elle, suit la position choisie) */
    const under = !this.inPip && !IS_BUBBLE && this.state !== 'hidden' && document.body.dataset.view === 'dicter' && (R.dataset.pos === 'center' || REMOTE);
    R.classList.toggle('under-mic', under);
    document.body.classList.toggle('isl-under-mic', under);
    if (under) R.style.setProperty('--isl-top', `${Math.round($('#mic-cap').getBoundingClientRect().top - 6)}px`);
  },
  hide() {
    clearTimeout(this.hideTimer);
    /* dans la mini-fenêtre, l'île ne disparaît pas : elle se remet en attente */
    if (this.inPip) { if (this.state !== 'ready') this.show('ready'); return; }
    if (this.state === 'hidden') return;
    this.state = 'hidden';
    document.body.classList.remove('isl-under-mic');
    this.root.classList.remove('on');
    this.offTimer = setTimeout(() => {
      if (this.state !== 'hidden') return;
      this.root.hidden = true; this.root.dataset.state = 'hidden';
      if (IS_BUBBLE) { this.tellPill?.(); Desktop.bubble(false); }
    }, 320);
  },
  setRight(txt) { if (this.r.textContent !== txt) this.r.textContent = txt; },
  setSub(txt) { this.s.textContent = txt; },
  caption(text) {
    if (this.state !== 'recording' || this.cap.hidden) return;
    const t = String(text || '').trim();
    this.cap.textContent = t.length > 54 ? '…' + t.slice(-54) : (t || 'Parle, je t’écoute…');
  },
  setProgress(p) {
    if (this.state !== 'transcribing') return;
    if (p.stage === 'decode') { this.setRight('Lecture…'); return; }
    if (p.total > 1) { this.progress = p.done / p.total; this.setRight(`${Math.min(p.done + 1, p.total)}/${p.total}`); }
  },

  /* l'animation suit la fenêtre qui affiche l'île : quand l'onglet Verbe est
     caché, ses images s'arrêtent, mais pas celles de la mini-fenêtre */
  loop() { if (!this.raf) this.raf = this.win.requestAnimationFrame(t => this.frame(t)); },
  frame(t) {
    this.raf = 0;
    const st = this.state;
    if (st !== 'recording' && st !== 'transcribing' && st !== 'starting') return;
    /* deux fenêtres = deux horloges d'images : on borne l'écart au changement */
    const dt = clamp((t - (this.lastT || t)) / 1000, 0, 0.05); this.lastT = t;
    const g = this.g;
    const cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    if (this.dirty || !this.W || Math.abs(cw - this.W) >= 1 || Math.abs(ch - this.H) >= 1) { this.dirty = false; this.resize(); }
    if (st === 'recording' && this.clock0) this.setRight(fmtClock(now() - this.clock0));
    if (this.W && this.H) {
      g.clearRect(0, 0, this.W, this.H);
      if (st === 'recording') { this.sample(); this.drawVoice(t / 1000, dt); }
      if (st === 'transcribing') this.drawTranscribing(t / 1000);
      if (this.hole) g.clearRect(this.W / 2 - this.hole / 2, 0, this.hole, this.H);
    }
    this.loop();
  },
  sample() {
    const src = this.source ? this.source() : null;
    const bands = src?.bands, level = src?.level || 0;
    this.lvl += (level - this.lvl) * (level > this.lvl ? 0.5 : 0.12);
    const glow = (this.lvl * 0.9).toFixed(3);
    this.shell.style.setProperty('--glow', glow);
    /* l'anneau du gros micro et du micro flottant bat au rythme de la voix */
    if (!this.data.preview) for (const el of this.halos || (this.halos = [$('#mic'), $('#dock')])) el.style.setProperty('--lvl', glow);
    /* bureau : la bulle envoie la voix à la fenêtre principale, qui montre la même pastille (v0.5.2) */
    if (IS_BUBBLE && Desktop?.levels && src && !this.data.preview) {
      const t = now();
      if (t - (this.sentT || 0) > 33) { this.sentT = t; Desktop.levels({ bands: bands ? Array.from(bands) : [], level }); }
    }
    const N = this.levels.length, half = N / 2;
    for (let i = 0; i < N; i++) {
      const k = i < half ? half - 1 - i : i - half; /* basses au centre, aigus aux bords */
      let target = bands ? bands[Math.min(bands.length - 1, k)] : 0;
      target = Math.max(target, this.lvl * (1 - k / half) * 0.85);
      const c = this.levels[i];
      this.levels[i] = c + (target - c) * (target > c ? 0.55 : 0.16);
    }
  },
  palette(g) {
    const gr = g.createLinearGradient(0, 0, this.W, 0);
    gr.addColorStop(0, '#E39A55'); gr.addColorStop(0.5, '#F7D1A8'); gr.addColorStop(1, '#E39A55');
    return gr;
  },
  drawVoice(time, dt) {
    /* mêmes formes partout, comme sur les images des Réglages : en ligne ;
       dans la mini-fenêtre et la bulle, de part et d’autre du micro rond */
    const style = Settings.d.islandStyle;
    if (style === "onde") return this.drawWave(time, dt);
    if (style === "points") return this.drawDots(time);
    return this.drawBars(time);
  },
  /* largeur laissée libre au milieu pour le micro rond (mini-fenêtre, bulle) */
  get hole() { return IS_BUBBLE || this.miroir ? 58 : this.inPip ? 86 : 0; }, /* la bulle fine : un trou plus petit autour du micro */
  drawBars(time) {
    const g = this.g, W = this.W, H = this.H, N = this.levels.length, gap = 3, half = N / 2;
    const mid = Math.max(gap, this.hole), side = (W - mid) / 2;
    const bw = Math.max(2, Math.min(5, (side - gap * (half - 1)) / half)), sideW = half * bw + (half - 1) * gap, minH = 4;
    g.fillStyle = this.palette(g);
    const still = REDUCED.matches;
    for (let i = 0; i < N; i++) {
      const idle = still ? 0.02 : 0.035 + 0.028 * Math.sin(time * 3.1 + i * 0.55);
      const v = Math.min(1, Math.max(this.levels[i], idle));
      /* deux moitiés symétriques de part et d’autre du centre : basses au milieu */
      const x = i < half ? W / 2 - mid / 2 - sideW + i * (bw + gap) : W / 2 + mid / 2 + (i - half) * (bw + gap);
      const h = minH + (H - minH) * v, y = (H - h) / 2;
      g.beginPath(); g.roundRect(x, y, bw, h, bw / 2); g.fill();
      this.lastRects[i] = { x, y, w: bw, h };
    }
  },
  drawWave(time, dt) {
    const g = this.g, W = this.W, H = this.H, A = (H / 2 - 3) * (0.12 + 0.88 * clamp(this.lvl * 1.5, 0, 1));
    const layers = [[1.25, 2.2, 2.2, 0.95], [1.9, -3.1, 1.6, 0.55], [2.8, 4.3, 1.2, 0.35]];
    const sp = REDUCED.matches ? 0.2 : 1, hole = this.hole;
    /* avec un micro au centre : une onde de chaque côté, qui s’éteint contre le micro */
    const parts = hole ? [[0, W / 2 - hole / 2], [W / 2 + hole / 2, W]] : [[0, W]];
    g.strokeStyle = this.palette(g); g.lineCap = "round";
    layers.forEach(([f, speed, lw, alpha], k) => {
      this.phase[k] += dt * speed * sp * (1 + this.lvl * 1.6);
      g.globalAlpha = alpha; g.lineWidth = lw;
      for (const [a, b] of parts) {
        g.beginPath();
        for (let x = a; x <= b; x += 2) {
          const env = Math.pow(Math.sin(Math.PI * (x - a) / (b - a)), 2);
          const y = H / 2 + A * env * Math.sin(2 * Math.PI * f * (x / W) * (hole ? 2 : 1) + this.phase[k]) * (1 - k * 0.22);
          if (x === a) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
      }
    });
    g.globalAlpha = 1;
  },
  /* Points : de vrais ronds qui dansent et grossissent avec la voix */
  drawDots(time) {
    const g = this.g, W = this.W, H = this.H, hole = this.hole, still = REDUCED.matches, step = 19;
    const fills = ["#E39A55", "#F7D1A8", "#EDAF73", "#F7D1A8", "#E39A55"];
    /* sans micro au centre : 5 points ; avec : 3 de chaque côté, en miroir */
    const pos = [];
    if (!hole) for (let i = 0; i < 5; i++) pos.push([W / 2 + (i - 2) * step, Math.abs(i - 2), i]);
    else for (let i = 0; i < 3; i++) { const d = hole / 2 + 14 + i * step; pos.push([W / 2 - d, i, i], [W / 2 + d, i, i + 2]); }
    for (const [cx, rank, c] of pos) {
      const v = Math.min(1, (this.levels[13 + Math.min(12, rank * 2)] || 0) * 1.3);
      const r = 3.5 + 3.5 * v;
      const amp = still ? 0 : 2 + (H / 2 - r - 3) * v;
      const cy = H / 2 + Math.sin(time * 7 + c * 1.3) * amp;
      g.fillStyle = fills[c % fills.length]; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    }
  },
  makeBlocks() {
    /* deux « lignes de texte » en blocs arrondis : la voix devient des mots */
    const W = this.W, H = this.H, rows = [{ y: H / 2 - 8, max: W }, { y: H / 2 + 3, max: W * 0.62 }], out = [];
    this.blocksW = W;
    let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (const r of rows) {
      let x = 0;
      while (x < r.max - 10) {
        let w = 12 + rnd() * 28; if (x + w > r.max) w = r.max - x;
        if (w < 8) break;
        out.push({ x, y: r.y, w, h: 6 }); x += w + 6;
      }
    }
    return out;
  },
  startMorph(fromRecording) {
    if (!this.W) this.resize();
    this.blocks = this.makeBlocks();
    const fromBars = fromRecording && Settings.d.islandStyle === 'barres' && this.lastRects.length && !REDUCED.matches;
    if (!fromBars) { this.morph = { t0: now(), from: null }; return; }
    const N = this.lastRects.length, B = this.blocks.length, totalW = this.blocks.reduce((s, b) => s + b.w, 0);
    const counts = this.blocks.map(b => Math.max(1, Math.floor((N * b.w) / totalW)));
    let sum = counts.reduce((a, b) => a + b, 0);
    while (sum > N) { const j = counts.indexOf(Math.max(...counts)); counts[j]--; sum--; }
    for (let j = 0; sum < N; j = (j + 1) % B) { counts[j]++; sum++; }
    const target = [];
    this.blocks.forEach((b, j) => { for (let s = 0; s < counts[j]; s++) target.push({ x: b.x + (s * b.w) / counts[j], y: b.y, w: b.w / counts[j] + 0.6, h: b.h }); });
    this.morph = { t0: now(), from: this.lastRects.slice(0, N).map(r => ({ ...r })), target };
  },
  drawTranscribing(time) {
    const g = this.g, W = this.W, H = this.H, blocks = this.blocks || (this.blocks = this.makeBlocks());
    const m = this.morph, dur = 560, t = m ? clamp((now() - m.t0) / dur, 0, 1) : 1, e = easeOut(t);
    const pal = this.palette(g);
    if (m && m.from && t < 1) {
      g.fillStyle = pal;
      g.globalAlpha = t < 0.82 ? 1 : 1 - (t - 0.82) / 0.18;
      m.from.forEach((f, i) => {
        const b = m.target[i]; if (!b) return;
        const x = lerp(f.x, b.x, e), y = lerp(f.y, b.y, e), w = lerp(f.w, b.w, e), h = lerp(f.h, b.h, e);
        g.beginPath(); g.roundRect(x, y, w, h, Math.min(w, h) / 2); g.fill();
      });
      if (t > 0.62) {
        g.globalAlpha = (t - 0.62) / 0.38; g.fillStyle = 'rgba(255,255,255,.2)';
        for (const b of blocks) { g.beginPath(); g.roundRect(b.x, b.y, b.w, b.h, 3); g.fill(); }
      }
      g.globalAlpha = 1;
      return;
    }
    /* état stable : lignes de texte avec un reflet cuivré qui passe */
    const bl = Math.abs((this.blocksW || 0) - W) > 1 ? (this.blocks = this.makeBlocks()) : blocks;
    const appear = m && !m.from ? clamp((now() - m.t0) / 420, 0, 1) : 1;
    g.beginPath();
    bl.forEach((b, i) => {
      const k = clamp(appear * bl.length * 1.4 - i, 0, 1), w = b.w * easeOut(k);
      if (w > 0.5) g.roundRect(b.x, b.y, w, b.h, 3);
    });
    g.fillStyle = 'rgba(255,255,255,.2)'; g.fill();
    if (!REDUCED.matches) {
      g.save(); g.clip();
      const sx = ((time % 1.35) / 1.35) * (W + 160) - 80, gr = g.createLinearGradient(sx - 70, 0, sx + 70, 0);
      gr.addColorStop(0, 'rgba(247,209,168,0)'); gr.addColorStop(0.5, 'rgba(247,209,168,.95)'); gr.addColorStop(1, 'rgba(247,209,168,0)');
      g.fillStyle = gr; g.fillRect(0, 0, W, H); g.restore();
    }
    if (this.progress != null) {
      g.fillStyle = 'rgba(255,255,255,.12)'; g.beginPath(); g.roundRect(0, H - 3, W, 3, 1.5); g.fill();
      g.fillStyle = pal; g.beginPath(); g.roundRect(0, H - 3, Math.max(3, W * this.progress), 3, 1.5); g.fill();
    }
  },
};

/* ============================================================
   7 bis. La mini-fenêtre flottante (Document Picture-in-Picture)
   Une petite fenêtre que Chrome et Edge gardent par-dessus les autres
   onglets et apps. L'île y déménage : même animation, mêmes états.
   Le site ne peut pas choisir sa position (règle du navigateur) :
   Chrome la rouvre là où l'utilisateur l'a glissée la dernière fois.
   ============================================================ */
const Float = {
  win: null, opening: null, prefer: null, /* prefer : forcer la fenêtre active (tests) */
  get supported() { return !Desktop && !!window.documentPictureInPicture && !COARSE.matches; },
  /* Doit être appelée pendant un geste (clic, touche) : sinon Chrome refuse. */
  open() {
    if (this.win) return Promise.resolve(this.win);
    if (this.opening) return this.opening;
    if (!this.supported) return Promise.resolve(null);
    let p;
    try { p = window.documentPictureInPicture.requestWindow({ width: 400, height: 96 }); }
    catch (e) { return Promise.resolve(null); }
    this.opening = p.then(
      w => { this.opening = null; this.attach(w); return w; },
      e => { this.opening = null; console.info('[Verbe] mini-fenêtre non ouverte :', e && e.name); return null; },
    );
    return this.opening;
  },
  close() { try { this.win?.close(); } catch (e) { /* déjà fermée */ } },
  attach(w) {
    this.win = w;
    const d = w.document;
    d.documentElement.lang = 'fr-CA';
    d.documentElement.style.colorScheme = 'dark';
    this.syncTheme();
    for (const n of document.head.querySelectorAll('style, link[rel="stylesheet"]')) d.head.append(n.cloneNode(true));
    d.title = 'Verbe';
    d.body.className = 'pipdoc';
    /* petit relais exécuté dans la mini-fenêtre : Chrome ne laisse
       ramener l'onglet Verbe au premier plan que depuis elle */
    const s = d.createElement('script');
    s.textContent = 'window.verbeFocusOpener = function () { try { opener && opener.focus(); } catch (e) {} };';
    d.head.append(s);
    Island.moveTo(w);
    w.addEventListener('keydown', onKeyDown, true);
    w.addEventListener('keyup', onKeyUp, true);
    w.addEventListener('blur', onWinBlur);
    w.addEventListener('focus', onWinFocus);
    w.addEventListener('pagehide', () => this.detach(w), { once: true });
    UI.renderChips();
    if (!Settings.d.floatTip) {
      Settings.set('floatTip', true);
      Toast.show({ type: 'info', text: 'Mini-fenêtre ouverte.', sub: 'Glisse-la où tu veux, par exemple en bas au centre : Chrome la rouvrira au même endroit.', duration: 9000 });
    }
  },
  detach(w) {
    if (this.win !== w) return;
    const fromPip = Rec.realm === w;
    this.win = null;
    Island.moveTo(window);
    /* un micro ouvert par la mini-fenêtre s'éteint avec elle :
       on transcrit ce qui a déjà été dit plutôt que de le perdre */
    if (fromPip && App.state === 'recording') {
      Rec.onEnded = null;
      Toast.show({ type: 'info', text: 'Mini-fenêtre fermée.', sub: 'Je transcris ce que tu as déjà dit.' });
      App.stop();
    } else if (fromPip && App.state === 'starting') App.cancel();
    UI.renderChips();
  },
  syncTheme() {
    if (!this.win) return;
    const t = document.documentElement.dataset.theme, h = this.win.document.documentElement;
    if (t) h.dataset.theme = t; else delete h.dataset.theme;
  },
  focusMain() { try { this.win?.verbeFocusOpener?.(); } catch (e) { /* ignore */ } },
};

/* La fenêtre qui a le focus : Chrome n'ouvre le micro et n'écrit dans le
   presse-papiers que pour elle. Hors focus, on retombe sur la page. */
function activeWin() {
  const w = Float.win;
  if (!w || w.closed) return window;
  if (Float.prefer === 'pip') return w;
  if (Float.prefer === 'page') return window;
  try { if (w.document.hasFocus() && !document.hasFocus()) return w; } catch (e) { /* ignore */ }
  return window;
}
