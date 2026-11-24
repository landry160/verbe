/* ============================================================
   9. Le contrôleur
   ============================================================ */
const App = {
  state: 'idle', items: [], loadState: 'loading', last: null, timer: 0,
  holdActive: false, pendingStop: false, pendingCopy: null, previewing: false,
  get pid() { return Settings.d.provider; },
  needsKey(pid = this.pid) { return PROVIDERS[pid].kind !== 'webspeech' && !(Settings.d.keys[pid] || '').trim(); },

  setState(s) {
    this.state = s;
    const mic = $('#mic'), cap = $('#mic-cap');
    mic.setAttribute('aria-pressed', s === 'recording' ? 'true' : 'false');
    mic.setAttribute('aria-busy', s === 'transcribing' || s === 'starting' ? 'true' : 'false');
    $('#mic-ic').innerHTML = icon(s === 'recording' ? 'square' : s === 'transcribing' || s === 'starting' ? 'loader' : 'mic', 50);
    const labels = { idle: ['Démarrer la dictée', this.needsKey() ? 'Ajoute ta clé pour dicter' : 'Appuie pour dicter'], starting: ['Ouverture du micro', 'Ouverture du micro…'], recording: ['Terminer la dictée', 'Appuie pour terminer'], transcribing: ['Transcription en cours', 'Transcription…'] };
    mic.setAttribute('aria-label', labels[s][0]); cap.textContent = labels[s][1];
    /* le micro flottant (Historique, Réglages) suit le même état */
    const dock = $('#dock');
    dock.setAttribute('aria-pressed', mic.getAttribute('aria-pressed'));
    dock.setAttribute('aria-busy', mic.getAttribute('aria-busy'));
    dock.setAttribute('aria-label', labels[s][0]);
    $('#dock-ic').innerHTML = icon(s === 'recording' ? 'square' : s === 'transcribing' || s === 'starting' ? 'loader' : 'mic', 26);
    if (s !== 'recording') for (const el of [mic, dock]) el.style.setProperty('--lvl', '0');
    document.title = s === 'recording' ? '● Dictée en cours — Verbe' : s === 'transcribing' ? 'Transcription… — Verbe' : 'Verbe — dictée vocale';
    if (IS_BUBBLE) Desktop.state(s); /* la fenêtre principale et le raccourci Échap suivent */
    if (s === 'idle' && this.rewriting) this.dropRewrite(); /* réécriture abandonnée : le presse-papiers revient */
  },

  toggle() {
    if (REMOTE) { Desktop.toggle(); return; }
    if (this.previewing) return;
    if (this.state === 'idle') return this.start();
    if (this.state === 'recording') return this.stop();
    if (this.state === 'transcribing') Toast.show({ type: 'info', text: 'Transcription en cours…', sub: 'Encore un instant.', duration: 1800 });
  },

  async start() {
    if (REMOTE) { if (this.state === 'idle') Desktop.toggle(); return; }
    if (this.state !== 'idle' || this.previewing) return;
    const P = PROVIDERS[this.pid];
    if (P.kind === 'webspeech' && !SR) return this.blocked('Ce navigateur n’a pas de reconnaissance vocale intégrée.', 'Ajoute une clé dans Réglages : Groq est gratuit (clique ici).');
    if (this.needsKey()) return this.blocked(`Il manque ta clé ${P.name}.`, 'Clique ici pour l’ajouter dans Réglages.');
    if (!navigator.mediaDevices?.getUserMedia) return this.blocked('Le micro n’est pas accessible ici.', 'Ouvre Verbe dans Chrome, Edge ou Firefox.', null);
    this.setState('starting'); Island.show('starting');
    Rec.onEnded = () => { if (this.state === 'recording') { Toast.show({ type: 'warn', text: 'Le micro s’est débranché.', sub: 'Je transcris ce qui a été enregistré.' }); this.stop(); } };
    try {
      await Rec.start(P.kind === 'webspeech', txt => Island.caption(txt));
    } catch (e) {
      Rec.release(); this.setState('idle'); this.micError(e); return;
    }
    if (this.state !== 'starting') { Rec.cancel(); return; }
    if (!Mics.labelsOk) Mics.refresh().then(() => { UI.renderMics(); UI.renderChips(); });
    this.setState('recording');
    Island.source = () => (Rec.meter ? Rec.meter.read() : null);
    Island.show('recording', { caption: P.kind === 'webspeech', clock0: Rec.t0, title: this.rewriting ? 'Comment le réécrire ?' : '' });
    if (P.kind === 'webspeech') Island.caption('');
    Sound.play('start');
    clearInterval(this.timer);
    clearInterval(this.silenceT); this.silenceT = setInterval(() => this.checkSilence(), 250);
    if (this.pendingStop) { this.pendingStop = false; this.cancel(true); return; }
    /* Mini-fenêtre : ouverte une fois le micro allumé, encore dans le geste
       qui a lancé la dictée (Chrome laisse environ 5 s). Sinon, tant pis :
       le bouton « Mini-fenêtre » de la page l'ouvre à la main. */
    if (Settings.d.floating && Float.supported && !Float.win) Float.open();
  },

  /* Arrêt automatique (v0.4.6) : sans voix pendant le délai choisi, Verbe s'arrête et libère le micro.
     S'il a entendu quelqu'un, il transcrit et colle comme d'habitude ; sinon il n'envoie rien. */
  checkSilence() {
    if (this.state !== 'recording' || !Rec.active) { clearInterval(this.silenceT); return; }
    const sec = Number(Settings.d.autoStop) || 0;
    if (!sec || now() - Rec.lastVoice < sec * 1000) return;
    clearInterval(this.silenceT);
    const delai = sec >= 60 ? `${sec / 60} min` : `${sec} s`;
    if (Rec.voiced >= VOICE_FRAMES) { this.stop(); return; }
    Rec.cancel(); Island.source = null; this.setState('idle');
    Island.show('warn', { text: 'Je n’ai rien entendu.', hint: `Micro libéré après ${delai} sans voix.`, autoHide: 4200 });
    Sound.play('error');
  },

  blocked(text, hint, action = 'settings') {
    Island.show('error', { text, hint, action }); Sound.play('error');
  },

  micError(e) {
    const n = e && e.name;
    let text = 'Impossible d’ouvrir le micro.', hint = 'Vérifie ton micro, puis réessaie.';
    if (e && e.user) { text = e.user.text; hint = e.user.hint; }
    else if (n === 'NotAllowedError' || n === 'SecurityError') { text = 'Accès au micro refusé.'; hint = 'Autorise le micro avec le cadenas à gauche de l’adresse, puis réessaie.'; }
    else if (n === 'NotFoundError') { text = 'Aucun micro trouvé.'; hint = 'Branche un micro ou un casque.'; }
    else if (n === 'NotReadableError' || n === 'AbortError') { text = 'Le micro est déjà utilisé.'; hint = 'Ferme l’autre app qui s’en sert (Teams, Zoom…).'; }
    console.warn('[Verbe] micro', e);
    Island.show('error', { text, hint }); Sound.play('error');
  },

  cancel(quiet = false) {
    if (this.state !== 'recording' && this.state !== 'starting') return;
    if (REMOTE) { Desktop.cancel(); return; }
    clearInterval(this.timer);
    Rec.cancel(); Island.source = null; this.setState('idle');
    if (quiet) { Island.hide(); Toast.show({ type: 'info', text: 'Maintiens le raccourci pendant que tu parles.', duration: 2600 }); }
    else Island.show('cancelled', { autoHide: 900 });
  },

  async stop() {
    if (this.state !== 'recording') return;
    if (REMOTE) { Desktop.toggle(); return; }
    clearInterval(this.timer);
    this.setState('transcribing');
    const tStop = now();
    Island.show('transcribing'); Sound.play('stop');
    let r;
    try { r = await Rec.stop(); }
    catch (e) { Island.source = null; this.setState('idle'); this.fail(null, e); return; }
    Island.source = null;
    if (!r.speech.ok) {
      this.setState('idle');
      Island.show('warn', { text: 'Aucune voix détectée.', hint: 'Vérifie le micro choisi dans Réglages (clique ici).', action: 'micro', autoHide: 4200 });
      return;
    }
    if (this.rewriting) return this.applyRewrite(r); /* la voix était une consigne de réécriture */
    if (PROVIDERS[this.pid].kind === 'webspeech') {
      const item = this.newItem({ source: 'micro', durationMs: r.durationMs, provider: 'navigateur' });
      return this.finish(item, r.text, tStop);
    }
    const item = this.newItem({ source: 'micro', durationMs: r.durationMs });
    await this.saveItem(item, r.blob); /* l'historique garde l'enregistrement d'origine, silences compris */
    const plan = silenceSpans(Rec.frames), trim = !!plan && plan.gainSec >= TRIM.minGain; /* sinon : envoyé tel quel */
    await this.runTranscription(item, r.blob, { tStop, trim });
  },

  newItem({ source, durationMs = 0, fileName = '', provider }) {
    const pid = provider || this.pid;
    return { id: uid(), createdAt: Date.now(), text: '', status: 'pending', error: '', source, durationMs: Math.round(durationMs), fileName, provider: pid, model: PROVIDERS[pid].kind === 'webspeech' ? 'navigateur' : modelOf(pid), latencyMs: null, words: 0, hasAudio: false };
  },

  async saveItem(item, blob) {
    if (blob && Settings.d.keepAudio && blob.size <= 60e6) {
      try { await Store.putAudio(item.id, blob); item.hasAudio = true; } catch (e) { console.warn('[Verbe] audio non gardé', e); }
    }
    try { await Store.put(item); } catch (e) { console.warn('[Verbe] historique non gardé', e); }
    const i = this.items.findIndex(x => x.id === item.id);
    if (i === -1) this.items.unshift(item); else this.items[i] = item;
    await this.enforceLimits();
    UI.renderHistory();
    if (Desktop) Desktop.notify('history');
  },

  /* « Nettoyer » : texte propre à la demande, avec retour en arrière */
  async cleanItem(id) {
    const item = this.items.find(i => i.id === id);
    if (!item || !item.text || this.cleaning) return;
    if (!polishProvider()) { Toast.show({ type: 'warn', text: 'Le texte propre a besoin d’une clé.', sub: 'Ajoute une clé Groq (gratuite) dans Réglages.', action: { label: 'Réglages', fn: () => { location.hash = '#reglages'; } } }); return; }
    this.cleaning = id; UI.renderLast(); UI.renderHistory();
    const before = item.text;
    try {
      const clean = await polishText(before);
      if (!item.raw) item.raw = before;
      Object.assign(item, { text: clean, words: countWords(clean), cleaned: true });
      await Store.put(item).catch(() => {});
      const copied = await copyText(clean);
      Toast.show({ type: 'ok', text: copied ? 'Texte nettoyé et copié.' : 'Texte nettoyé.', sub: copied ? pasteSub() : '', duration: 7000,
        action: { label: 'Annuler', fn: async () => { Object.assign(item, { text: before, words: countWords(before), cleaned: false }); await Store.put(item).catch(() => {}); UI.renderLast(); UI.renderHistory(); if (Desktop) Desktop.notify('history'); } } });
    } catch (e) {
      console.warn('[Verbe] nettoyage', e);
      Toast.show({ type: 'error', text: e?.user?.text || 'Nettoyage impossible.', sub: e?.user?.hint || 'Réessaie dans un instant.' });
    } finally {
      this.cleaning = null; UI.renderLast(); UI.renderHistory();
      if (Desktop) Desktop.notify('history');
    }
  },

  async enforceLimits() {
    const extra = this.items.slice(MAX_ITEMS);
    for (const it of extra) { try { await Store.del(it.id); } catch (e) { /* ignore */ } }
    this.items = this.items.slice(0, MAX_ITEMS);
    let n = 0;
    for (const it of this.items) {
      if (!it.hasAudio) continue;
      if (++n > MAX_AUDIO) { it.hasAudio = false; try { await Store.delAudio(it.id); await Store.put(it); } catch (e) { /* ignore */ } }
    }
  },

  async runTranscription(item, blob, { tStop = now(), name = '', trim = false } = {}) {
    this.setState('transcribing');
    const pid = this.pid;
    Object.assign(item, { status: 'pending', provider: pid, model: modelOf(pid), error: '' });
    UI.renderHistory();
    try {
      const out = await transcribe(blob, {
        pid, name, durationMs: item.durationMs, trim,
        onProgress: p => { if (p.durationMs) item.durationMs = p.durationMs; Island.setProgress(p); },
      });
      await this.finish(item, out.text, tStop);
    } catch (e) {
      item.status = 'error';
      item.error = e?.user?.text || 'La transcription a échoué.';
      await this.saveItem(item);
      this.setState('idle');
      this.fail(item, e);
    }
  },

  async finish(item, rawText, tStop) {
    let text = cleanTranscript(rawText);
    /* Mes mots d'abord : les commandes et le modèle voient les bons mots. Une dictée qui n'est
       que le nom d'un texte tout prêt donne ce texte tel quel, sans commandes ni modèle. */
    text = fixWords(text);
    const ready = wholeSnippet(text);
    if (ready) text = ready;
    if (text && Settings.d.voiceCmds && !ready) text = applyVoiceCommands(text);
    /* texte propre automatique, « Coller en » et ton selon l'app : un seul appel au modèle ;
       en cas de souci, on garde le texte brut. Le ton suit l'app notée au début de la dictée.
       Le modèle ne voit jamais un texte tout prêt (polishAround laisse les « Insère … » de côté). */
    const plan = text && !ready ? llmPlan(this.fgApp) : null;
    let note = '';
    this.fgApp = '';
    if (plan && !polishProvider() && (plan.lang || plan.tone)) {
      /* pas de modèle de langue (pas de clé) : on colle le texte d'origine et on prévient une seule fois */
      if (!this.llmWarned) {
        this.llmWarned = true;
        const why = plan.lang ? `Pour coller en ${PASTE_LANGS[plan.lang][0]}` : 'Pour adapter le ton';
        if (IS_BUBBLE) note = 'Gardé tel quel : il manque une clé';
        else Toast.show({ type: 'warn', text: 'Texte gardé tel quel.', sub: `${why}, Verbe a besoin d’une clé (Groq est gratuit).`, duration: 7000, action: { label: 'Réglages', fn: () => { location.hash = '#reglages/transcription'; } } });
      }
    } else if (plan && polishProvider()) {
      Island.setRight(plan.lang ? 'Traduction…' : 'Nettoyage…');
      try {
        const out = await polishAround(text, plan);
        item.raw = text; text = out;
        if (plan.lang) item.lang = plan.lang;
        if (plan.tone) item.tone = plan.tone;
      } catch (e) {
        console.warn('[Verbe] nettoyage', e);
        if (IS_BUBBLE && (plan.lang || plan.tone)) note = plan.lang ? 'Gardé tel quel : traduction impossible' : 'Gardé tel quel';
        else Toast.show({ type: 'warn', text: e?.user?.text || (plan.lang ? 'Traduction impossible.' : 'Nettoyage impossible.'), sub: 'Ton texte brut est gardé et copié.' });
      }
    }
    if (!ready) text = insertSnippets(text); /* « Insère ma signature. » dans une dictée plus longue */
    if (!text) {
      item.status = 'error'; item.error = 'Aucune parole reconnue.';
      await this.saveItem(item);
      this.setState('idle');
      Island.show('warn', { text: 'Rien n’a été reconnu.', hint: 'Parle un peu plus près du micro, puis réessaie.', autoHide: 4200 });
      return;
    }
    Object.assign(item, { text, status: 'ok', error: '', words: countWords(text) });
    Stats.add(item); /* progrès : compté une seule fois, avant l'enregistrement qui prévient l'autre fenêtre */
    const copied = Settings.d.autoCopy || IS_BUBBLE ? await copyText(text) : false;
    /* bureau : le texte se colle tout seul dans l'app où tu écrivais */
    const pasted = IS_BUBBLE && copied && Settings.d.autoPaste ? await Desktop.paste({ keep: Settings.d.keepClip !== false }).catch(() => false) : false;
    item.latencyMs = Math.round(now() - tStop);
    await this.saveItem(item);
    this.last = item; UI.renderLast();
    UI.renderChips(); UI.renderQuota(); /* le compteur suit chaque dictée */
    this.setState('idle');
    Island.show('done', { text, copied, pasted, words: item.words, autoHide: copied ? 2600 : 6000, note });
    Sound.play('done');
    this.pendingCopy = Settings.d.autoCopy && !copied ? text : null;
  },

  fail(item, e) {
    console.warn('[Verbe]', e);
    const u = e?.user || { text: 'Quelque chose a mal tourné.', hint: 'Réessaie dans un instant.' };
    let hint = u.hint, action = null;
    if (e?.code === 'key' || e?.code === 'model') action = 'settings';
    /* limite atteinte : on garde « quand réessayer », et on rassure sur l'audio */
    else if (e?.code === 'rate') { if (item?.hasAudio) { hint += ' Ton audio est gardé dans l’historique.'; action = 'history'; } }
    else if (item?.hasAudio) { hint = 'Ton audio est gardé : réessaie depuis l’historique (clique ici).'; action = 'history'; }
    Island.show('error', { text: u.text, hint, action }); Sound.play('error');
  },

  async transcribeFile(file) {
    if (this.state !== 'idle' || this.previewing) { Toast.show({ type: 'info', text: 'Attends la fin de la dictée en cours.', duration: 2400 }); return; }
    const P = PROVIDERS[this.pid];
    if (P.kind === 'webspeech') return this.blocked('Le mode gratuit ne lit pas les fichiers.', 'Ajoute une clé dans Réglages : Groq est gratuit (clique ici).');
    if (this.needsKey()) return this.blocked(`Il manque ta clé ${P.name}.`, 'Clique ici pour l’ajouter dans Réglages.');
    if (!isAudioFile(file)) { Toast.show({ type: 'error', text: 'Ce fichier n’est pas un audio.', sub: 'Formats acceptés : MP3, M4A, WAV, WEBM, OGG, FLAC, vidéo MP4.' }); return; }
    this.setState('transcribing');
    Island.show('transcribing', { label: 'Fichier' });
    const durationMs = await mediaDuration(file);
    const item = this.newItem({ source: 'fichier', durationMs, fileName: file.name });
    await this.saveItem(item, file);
    await this.runTranscription(item, file, { tStop: now(), name: file.name });
  },

  async retry(id) {
    if (this.state !== 'idle') { Toast.show({ type: 'info', text: 'Attends la fin de la dictée en cours.', duration: 2400 }); return; }
    const item = this.items.find(i => i.id === id); if (!item) return;
    const blob = await Store.getAudio(id).catch(() => null);
    if (!blob) { Toast.show({ type: 'error', text: 'L’audio de cette dictée n’est plus disponible.' }); return; }
    if (item.status === 'ok') item.counted = true; /* progrès : une dictée déjà réussie ne compte pas deux fois */
    if (this.needsKey() || PROVIDERS[this.pid].kind === 'webspeech') return this.blocked('Choisis un service avec une clé pour réessayer.', 'Clique ici pour ouvrir Réglages.');
    Island.show('transcribing', { label: 'Nouvel essai' });
    /* dictée au micro : ses silences sont coupés à nouveau (les fichiers importés partent tels quels) */
    await this.runTranscription(item, blob, { tStop: now(), name: item.fileName || '', trim: item.source === 'micro' });
  },

  async remove(id) {
    const i = this.items.findIndex(x => x.id === id); if (i === -1) return;
    const item = this.items[i];
    const blob = item.hasAudio ? await Store.getAudio(id).catch(() => null) : null;
    this.items.splice(i, 1);
    await Store.del(id).catch(() => {});
    if (this.last?.id === id) { this.last = this.items.find(x => x.status === 'ok') || null; UI.renderLast(); }
    UI.renderHistory();
    Toast.show({
      type: 'ok', text: 'Dictée supprimée.', duration: 6000,
      action: { label: 'Annuler', fn: async () => { if (blob) await Store.putAudio(id, blob).catch(() => {}); await Store.put(item).catch(() => {}); this.items.push(item); this.items.sort((a, b) => b.createdAt - a.createdAt); if (!this.last || this.last.createdAt < item.createdAt) { this.last = item.status === 'ok' ? item : this.last; UI.renderLast(); } UI.renderHistory(); } },
    });
  },

  async preview() {
    /* bureau : l'aperçu se joue dans la vraie bulle, à la position choisie */
    if (REMOTE) { if (this.state === 'idle') Desktop.preview(); return; }
    if (this.state !== 'idle' || this.previewing) return;
    this.previewing = true;
    const sim = makeSim();
    Island.source = () => sim.read();
    Island.show('recording', { preview: true });
    await sleep(3400);
    Island.show('transcribing');
    await sleep(1600);
    Island.source = null;
    Island.show('done', { text: 'Voici l’aperçu : ta voix devient du texte, prêt à coller où tu veux.', copied: false, preview: true, words: 13, autoHide: 3600 });
    await sleep(600);
    this.previewing = false;
  },

  /* Bureau, raccourci « Recoller la dernière dictée » : la même dictée, collée là où est le curseur
     (même chemin que le collage automatique : presse-papiers gardé, Ctrl+V, presse-papiers rendu) */
  async repaste() {
    if (!IS_BUBBLE || this.state !== 'idle' || this.previewing) return;
    try { this.items = await Store.all(); } catch (e) { /* on garde la liste connue */ }
    const it = this.items.find(i => i.status === 'ok' && i.text);
    if (!it) { Island.show('warn', { text: 'Rien à recoller pour l’instant.', hint: 'Dicte d’abord un texte.', autoHide: 3600 }); Sound.play('error'); return; }
    const copied = await copyText(it.text);
    const pasted = copied ? await Desktop.paste({ keep: Settings.d.keepClip !== false }).catch(() => false) : false;
    Island.show('done', { text: it.text, copied, pasted, words: it.words || countWords(it.text), autoHide: copied ? 2600 : 6000 });
  },

  /* Bureau, raccourci « Réécrire la sélection » : Verbe copie la sélection, écoute la consigne
     (« plus poli », « en anglais »…), puis colle la version réécrite par-dessus. Refaire le
     raccourci pendant l'écoute l'arrête, comme Ctrl + Maj + L ; Échap annule. */
  async rewriteKey() {
    if (!IS_BUBBLE || this.previewing || this.grabbing) return;
    if (this.state === 'recording' && this.rewriting) return this.stop();
    if (this.state !== 'idle') return;
    /* une clé sert à transcrire la consigne, puis au modèle qui réécrit ; sans elle, on ne touche à rien */
    if (this.needsKey() || !polishProvider()) return this.blocked('La réécriture a besoin d’une clé.', 'Ajoute une clé Groq (gratuite) dans Réglages (clique ici).');
    this.grabbing = true;
    let got;
    try { got = await Desktop.grab(); } catch (e) { got = { ok: false, text: '' }; } finally { this.grabbing = false; }
    if (!got.ok) { Island.show('error', { text: 'Impossible de copier la sélection.', hint: 'Copie-la à la main (Ctrl + C), puis réessaie.' }); Sound.play('error'); return; }
    if (!got.text.trim()) { Island.show('warn', { text: 'Rien n’est sélectionné.', hint: 'Sélectionne du texte, puis refais le raccourci.', autoHide: 4200 }); Sound.play('error'); return; }
    if (this.state !== 'idle') { Desktop.giveBack(got.text); return; } /* une dictée a démarré entre-temps */
    this.rewriting = { text: got.text };
    await this.start();
    if (this.state === 'idle' && this.rewriting) this.dropRewrite(); /* le micro n'a pas pu s'ouvrir */
  },
  dropRewrite() {
    const job = this.rewriting; this.rewriting = null;
    if (job && Desktop) Desktop.giveBack(job.text).catch(() => {});
  },
  async applyRewrite(r) {
    const job = this.rewriting;
    try {
      Island.setRight('Consigne…');
      const said = PROVIDERS[this.pid].kind === 'webspeech' ? r.text : (await transcribe(r.blob, { pid: this.pid, durationMs: r.durationMs })).text;
      const order = cleanTranscript(said);
      if (!order) { this.setState('idle'); Island.show('warn', { text: 'Je n’ai pas compris la consigne.', hint: 'Refais le raccourci et dis, par exemple, « plus poli ».', autoHide: 4200 }); return; }
      Island.setRight('Réécriture…');
      const out = await rewriteText(job.text, order);
      const pasted = await Desktop.pasteText(out).catch(() => false);
      this.rewriting = null; /* le presse-papiers d'avant revient après le collage */
      this.setState('idle');
      Island.show('done', { text: out, copied: true, pasted, sub: pasted ? 'Remplacé par la version réécrite' : '', words: countWords(out), autoHide: pasted ? 2600 : 6000 });
      Sound.play('done');
    } catch (e) {
      this.setState('idle');
      this.fail(null, e);
    }
  },
};
