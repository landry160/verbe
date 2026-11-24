/* ============================================================
   11. Événements
   ============================================================ */
/* { ctrl, shift, code: 'KeyL' } → « Control+Shift+L » (format Electron) */
function toAccel(sc) {
  const named = { Space: 'Space', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: '\'', Comma: ',', Period: '.', Slash: '/', Enter: 'Enter', Backspace: 'Backspace', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };
  const c = sc.code || '';
  const k = c.startsWith('Key') ? c.slice(3) : c.startsWith('Digit') ? c.slice(5) : c.startsWith('Numpad') ? 'num' + c.slice(6).toLowerCase() : /^F\d+$/.test(c) ? c : named[c] || sc.key;
  return [sc.ctrl && 'Control', sc.alt && 'Alt', sc.shift && 'Shift', sc.meta && 'Super', k].filter(Boolean).join('+');
}
function matchShortcut(e, sc) {
  return e.code === sc.code && !!e.ctrlKey === !!sc.ctrl && !!e.shiftKey === !!sc.shift && !!e.altKey === !!sc.alt && !!e.metaKey === !!sc.meta;
}
/* Clavier et focus : les mêmes écouteurs servent la page et la mini-fenêtre */
function onKeyDown(e) {
  if (Capture.active) { Capture.onKey(e); return; }
  if (e.key === 'Escape') {
    if (App.state === 'recording' || App.state === 'starting') { e.preventDefault(); App.cancel(); return; }
    if (Island.state === 'done' || Island.state === 'error' || Island.state === 'warn') { Island.hide(); return; }
  }
  if (matchShortcut(e, Settings.d.shortcut)) {
    e.preventDefault(); e.stopPropagation();
    lastScDown = now();
    if (e.repeat) return;
    if (Settings.d.mode === 'hold') { if (App.state === 'idle') { App.holdActive = true; App.start(); } }
    else App.toggle();
  }
}
/* Une extension (Bitwarden prend Ctrl+Maj+L par défaut) peut avaler
   l'appui de la touche avant la page : seul le relâchement nous arrive.
   Dans ce cas, on démarre quand même et on explique une seule fois. */
let lastScDown = -1e9;
function stolenShortcut(e) {
  const sc = Settings.d.shortcut;
  if (Settings.d.mode === 'hold' || Capture.active || e.code !== sc.code) return false;
  if (now() - lastScDown < 1500) return false;
  if (!!e.ctrlKey !== !!sc.ctrl || !!e.shiftKey !== !!sc.shift || !!e.altKey !== !!sc.alt || !!e.metaKey !== !!sc.meta) return false;
  lastScDown = now();
  App.toggle();
  if (!Settings.d.conflictTip) {
    Settings.set('conflictTip', true);
    Toast.show({ type: 'warn', text: `Une extension utilise aussi ${UI.scLabel().join(' + ')}.`, sub: 'Verbe a quand même réagi. Pour que ce soit instantané, change le raccourci de l’extension dans chrome://extensions/shortcuts (Bitwarden, souvent).', duration: 12000 });
  }
  return true;
}
function holdRelease() {
  if (!App.holdActive) return;
  App.holdActive = false;
  if (App.state === 'recording') App.stop(); else if (App.state === 'starting') App.pendingStop = true;
}
function onKeyUp(e) {
  if (stolenShortcut(e)) { e.preventDefault(); return; }
  if (Settings.d.mode !== 'hold' || !App.holdActive) return;
  const sc = Settings.d.shortcut;
  if (e.code === sc.code || (sc.ctrl && e.key === 'Control') || (sc.shift && e.key === 'Shift') || (sc.alt && e.key === 'Alt') || (sc.meta && e.key === 'Meta')) holdRelease();
}
/* Perdre le focus relâche « maintenir pour parler », sauf s'il passe
   simplement de la page à la mini-fenêtre (ou l'inverse). */
function onWinBlur() {
  setTimeout(() => {
    let inVerbe = document.hasFocus();
    try { inVerbe = inVerbe || !!(Float.win && Float.win.document.hasFocus()); } catch (e) { /* ignore */ }
    if (!inVerbe) holdRelease();
  }, 60);
}
/* copie différée : si aucune fenêtre Verbe n'avait le focus au moment de copier */
async function onWinFocus() {
  if (!App.pendingCopy) return;
  const t = App.pendingCopy; App.pendingCopy = null;
  if (await copyText(t)) {
    if (Island.inPip && Island.state === 'done') Island.setSub(copiedLine());
    else Toast.show({ type: 'ok', text: 'Texte copié dans le presse-papiers.', sub: pasteSub(), duration: 3000 });
  }
}

function bind() {
  $('#mic').addEventListener('click', () => App.toggle());
  $('#dock').addEventListener('click', () => App.toggle());
  /* Premier geste : on prépare le moteur audio pour que la première dictée
     démarre aussi vite que les suivantes. */
  /* le moteur audio se prépare au repos, juste après l'ouverture (voir AudioEngine.prewarm) */
  AudioEngine.prewarm();
  Island.shell.addEventListener('click', () => {
    const s = Island.state, d = Island.data;
    if (s === 'ready') App.toggle();
    else if (s === 'recording' && !App.previewing) App.stop();
    else if (s === 'done' && !d.preview) copyText(d.text).then(ok => { if (ok) App.pendingCopy = null; Island.setSub(ok ? copiedLine() : 'Copie impossible : utilise le bouton Copier'); if (ok) { clearTimeout(Island.hideTimer); Island.hideTimer = setTimeout(() => Island.hide(), 1800); } });
    else if (s === 'error' || s === 'warn') {
      Island.hide();
      const to = d.action === 'settings' ? '#reglages/transcription' : d.action === 'micro' ? '#reglages/micro' : d.action === 'history' ? '#historique' : '';
      if (to && IS_BUBBLE) Desktop.openMain(to);
      else if (to) { location.hash = to; if (Island.inPip) Float.focusMain(); }
    }
  });

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', onWinBlur);
  window.addEventListener('focus', onWinFocus);

  window.addEventListener('beforeunload', e => { if (App.state === 'recording' || App.state === 'transcribing') { e.preventDefault(); e.returnValue = ''; } });

  /* Dicter */
  $('#file').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) App.transcribeFile(f); });
  $('#btn-clean-last').addEventListener('click', () => { if (App.last) App.cleanItem(App.last.id); });
  $('#btn-copy-last').addEventListener('click', async () => {
    const ta = $('#last-text'); if (!ta) return;
    const ok = await copyText(ta.value);
    Toast.show(ok ? { type: 'ok', text: 'Texte copié.', sub: pasteSub(), duration: 2600 } : { type: 'error', text: 'Copie impossible.', sub: 'Sélectionne le texte et copie-le à la main.' });
  });
  $('#notice').addEventListener('click', e => { if (e.target.closest('[data-hide-tip]')) { Settings.set('hideTip', true); UI.renderNotice(); } });
  $('#chips').addEventListener('click', e => {
    if (e.target.closest('[data-upload]')) { $('#file').click(); return; }
    if (!e.target.closest('[data-float]')) return;
    if (Float.win) Float.close(); else Float.open();
  });

  /* Glisser-déposer un fichier n'importe où */
  let depth = 0;
  const hasFiles = e => Array.from(e.dataTransfer?.types || []).includes('Files');
  window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); depth++; $('#dropveil').hidden = false; });
  window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', e => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) $('#dropveil').hidden = true; });
  window.addEventListener('drop', e => { if (!hasFiles(e)) return; e.preventDefault(); depth = 0; $('#dropveil').hidden = true; const f = e.dataTransfer.files[0]; if (f) App.transcribeFile(f); });

  /* Historique */
  $('#h-search').addEventListener('input', e => { UI.q = e.target.value; UI.renderHistory(); });
  $('#h-list').addEventListener('click', async e => {
    const b = e.target.closest('button, [data-expand]'); if (!b) return;
    if (b.dataset.copy) { const it = App.items.find(i => i.id === b.dataset.copy); if (it) { const ok = await copyText(it.text); Toast.show(ok ? { type: 'ok', text: 'Texte copié.', duration: 2200 } : { type: 'error', text: 'Copie impossible.' }); } }
    else if (b.dataset.clean) App.cleanItem(b.dataset.clean);
    else if (b.dataset.retry) App.retry(b.dataset.retry);
    else if (b.dataset.del) App.remove(b.dataset.del);
    else if (b.hasAttribute('data-expand')) b.closest('.hcard').classList.toggle('open');
    else if (b.hasAttribute('data-clear-search')) { $('#h-search').value = ''; UI.q = ''; UI.renderHistory(); }
    else if (b.hasAttribute('data-reload-history')) loadHistory();
  });
  window.addEventListener('keydown', e => {
    if (e.key === '/' && !$('#v-historique').hidden && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) { e.preventDefault(); $('#h-search').focus(); }
  });

  /* Réglages */
  $('#f-provider').addEventListener('change', e => { Settings.set('provider', e.target.value); UI.renderSettings(); UI.renderChips(); });
  let keyT = 0;
  $('#f-key').addEventListener('input', e => {
    clearTimeout(keyT);
    keyT = setTimeout(() => { Settings.d.keys[Settings.d.provider] = e.target.value.trim(); Settings.save(); UI.renderChips(); }, 250);
  });
  $('#f-key').addEventListener('change', e => { Settings.d.keys[Settings.d.provider] = e.target.value.trim(); Settings.save(); UI.renderChips(); });
  $('#btn-eye').addEventListener('click', () => {
    const k = $('#f-key'), show = k.type === 'password';
    k.type = show ? 'text' : 'password';
    $('#btn-eye').innerHTML = icon(show ? 'eyeOff' : 'eye', 20);
    $('#btn-eye').setAttribute('aria-label', show ? 'Masquer la clé' : 'Afficher la clé');
  });
  $('#btn-test').addEventListener('click', testKey);
  $('#f-model').addEventListener('change', e => { const v = e.target.value.trim(); if (!v || v === PROVIDERS[Settings.d.provider].model) delete Settings.d.models[Settings.d.provider]; else Settings.d.models[Settings.d.provider] = v; Settings.save(); });
  $('#f-lang').addEventListener('change', e => { Settings.set('lang', e.target.value); if (PROVIDERS[App.pid].kind === 'webspeech') UI.renderLocal(); });
  $('#btn-local').addEventListener('click', async () => {
    const st = $('#local-status');
    st.textContent = 'Téléchargement du modèle…';
    try { const ok = await SR.install({ langs: [srLang()], processLocally: true }); st.textContent = ok ? 'Installé : l’audio reste sur ton ordi.' : 'L’installation n’a pas abouti.'; $('#btn-local').hidden = !!ok; }
    catch (e) { st.textContent = 'L’installation n’a pas abouti.'; }
  });
  $('#f-mic').addEventListener('change', e => { Settings.set('micId', e.target.value); UI.renderChips(); if (Monitor.on) Monitor.start(); Toast.show({ type: 'ok', text: `Micro choisi : ${Mics.name(e.target.value)}`, duration: 2400 }); });
  $('#btn-mic-test').addEventListener('click', () => (Monitor.on ? Monitor.stop() : Monitor.start()));
  $('#btn-mic-perm').addEventListener('click', async () => {
    try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach(t => t.stop()); await Mics.refresh(); UI.renderMics(); UI.renderChips(); Toast.show({ type: 'ok', text: 'Micro autorisé.', duration: 2400 }); }
    catch (e) { App.micError(e); }
  });
  $('#btn-sc').addEventListener('click', () => Capture.start());
  $('#btn-sc-reset').addEventListener('click', () => {
    Settings.set('shortcut', Object.assign({}, DEFAULTS.shortcut)); UI.renderShortcut();
    const st = $('#sc-status'); st.textContent = 'Raccourci remis par défaut.'; st.className = 'help ok';
  });
  /* bureau : Recoller et Réécrire (Modifier, et l'interrupteur qui les allume) */
  for (const b of $$('[data-act-edit]')) b.addEventListener('click', () => Capture.start(b.dataset.actEdit));
  for (const sw of $$('[data-act-on]')) sw.addEventListener('click', () => {
    const name = sw.dataset.actOn, k = ACTION_SC[name], sc = Settings.d[k], st = $(`[data-act-status="${name}"]`);
    const pb = !sc.on && (shortcutProblem(sc) || scConflict(sc, name));
    if (pb) { st.textContent = pb; st.className = 'help warn'; return; }
    Settings.set(k, Object.assign({}, sc, { on: !sc.on }));
    if (!Settings.d[k].on) { st.textContent = ''; st.className = 'help'; }
    UI.renderShortcut();
  });
  for (const grp of $$('[data-setting]')) grp.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    Settings.set(grp.dataset.setting, b.dataset.value);
    if (grp.dataset.setting === 'islandPos') Island.setPos(b.dataset.value);
    /* forme ou position : on la voit tout de suite (la vraie bulle dans le bureau) ;
       pendant un aperçu déjà lancé, l'animation change en direct */
    if (grp.dataset.setting === 'islandPos' || grp.dataset.setting === 'islandStyle') App.preview();
    UI.renderSettings();
  });
  MotsUI.bind();
  for (const sw of $$('[data-switch]')) sw.addEventListener('click', () => { const k = sw.dataset.switch; Settings.set(k, !Settings.d[k]); sw.setAttribute('aria-checked', String(Settings.d[k])); UI.renderRegNav(); });
  /* sections des réglages : on change de section sans recharger la page */
  $('.reg-nav').addEventListener('click', e => {
    const t = e.target.closest('.reg-tab'); if (!t) return;
    /* téléphone : une vraie page (le bouton retour revient à la liste) ; ordinateur : on change sur place */
    if (NARROW.matches) { location.hash = `#reglages/${t.dataset.sec}`; return; }
    history.replaceState(null, '', `#reglages/${t.dataset.sec}`);
    UI.showSection(t.dataset.sec);
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: REDUCED.matches ? 'auto' : 'smooth' });
  });
  $('#theme-seg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; applyTheme(b.dataset.value); UI.renderSettings(); });
  $('#btn-preview').addEventListener('click', () => App.preview());
  $('#btn-clear').addEventListener('click', async () => {
    const n = App.items.length;
    if (!n) { Toast.show({ type: 'info', text: 'L’historique est déjà vide.', duration: 2400 }); return; }
    if (!(await confirmDialog({ title: 'Vider l’historique ?', body: `${plural(n, 'dictée', 'dictées')} et leur audio seront supprimés de ce navigateur. C’est définitif.`, confirm: `Supprimer ${plural(n, 'dictée', 'dictées')}`, danger: true }))) return;
    await Store.clear().catch(() => {});
    App.items = []; App.last = null; UI.renderLast(); UI.renderHistory();
    Toast.show({ type: 'ok', text: 'Historique vidé.' });
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', updateThemeColor);
  navigator.mediaDevices?.addEventListener?.('devicechange', () => Mics.onChange());
  window.addEventListener('hashchange', route);
}

async function testKey() {
  const pid = Settings.d.provider, P = PROVIDERS[pid];
  const key = ($('#f-key').value || '').trim(), st = $('#key-status'), btn = $('#btn-test');
  Settings.d.keys[pid] = key; Settings.save(); UI.renderChips();
  if (!key) { st.textContent = 'Colle une clé d’abord.'; st.className = 'help warn'; return; }
  btn.disabled = true; st.textContent = 'Vérification…'; st.className = 'help';
  try {
    const res = await fetch(P.test, { headers: P.kind === 'gemini' ? { 'x-goog-api-key': key } : { Authorization: `Bearer ${key}` } });
    if (res.ok) { st.textContent = `Clé acceptée par ${P.name}. Tu peux dicter.`; st.className = 'help ok'; }
    else if (res.status === 401 || res.status === 403) { st.textContent = `${P.name} refuse cette clé. Vérifie que tu l’as copiée en entier.`; st.className = 'help err'; }
    else { st.textContent = `${P.name} ne répond pas normalement. Réessaie dans un instant.`; st.className = 'help warn'; }
  } catch (e) {
    st.textContent = `Impossible de joindre ${P.name} depuis ce navigateur. Vérifie ta connexion.`; st.className = 'help err';
  } finally { btn.disabled = false; }
}

async function loadHistory({ quiet = false } = {}) {
  /* quiet : rechargé parce que l'autre fenêtre (bureau) a écrit ; une dictée
     « en cours » l'est vraiment, on n'y touche pas */
  if (quiet && Store.db) {
    try { App.items = await Store.all(); } catch (e) { return; }
    const lastId = App.last?.id;
    App.last = App.items.find(i => i.status === 'ok') || null;
    if (App.last?.id !== lastId || document.activeElement?.id !== 'last-text') UI.renderLast();
    UI.renderChips(); UI.renderQuota(); /* la bulle vient de dicter : le compteur suit */
    UI.renderHistory();
    return;
  }
  App.loadState = 'loading'; UI.renderHistory();
  try {
    if (!Store.db && !Store.mem) await Store.open();
    App.items = await Store.all();
    App.loadState = 'ready';
  } catch (e) {
    console.warn('[Verbe] IndexedDB indisponible', e);
    if (!Store.mem) { Store.useMemory(); Toast.show({ type: 'warn', text: 'L’historique ne sera pas gardé.', sub: 'Le stockage de ce navigateur est bloqué.' }); }
    App.items = await Store.all();
    App.loadState = 'ready';
  }
  /* une dictée restée « en cours » (page fermée) devient un échec qu'on peut réessayer */
  for (const it of App.items) if (it.status === 'pending') { it.status = 'error'; it.error = 'Interrompue avant la fin.'; Store.put(it).catch(() => {}); }
  Stats.seed(App.items); /* progrès : la première fois, on part de l'historique déjà gardé */
  App.last = App.items.find(i => i.status === 'ok') || null;
  UI.renderLast(); UI.renderHistory();
}

/* ============================================================
   11 bis. Version bureau : messages entre la bulle et la fenêtre
   ============================================================ */
function wireDesktop() {
  Desktop.on('toggle', d => {
    if (!IS_BUBBLE) return;
    if (App.state === 'idle') App.fgApp = (d && d.app) || ''; /* l'app où tu écris, notée au début de la dictée (ton selon l'app) */
    App.toggle();
  });
  Desktop.on('cancel', () => { if (IS_BUBBLE) App.cancel(); });
  /* la fenêtre principale montre l'état de la bulle sur ses micros */
  Desktop.on('state', s => {
    if (REMOTE && App.state !== s) App.setState(s);
    /* la fenêtre principale montre la même pastille que la bulle, avec la voix qu'elle lui envoie */
    if (!REMOTE) return;
    const miroir = on => { Island.miroir = on; Island.root.classList.toggle('miroir', on); document.body.classList.toggle('dictee-miroir', on); };
    if (s === 'recording') { miroir(true); Island.source = () => App.remoteLevels; Island.show('recording', { clock0: now() }); }
    else if (s === 'transcribing') { miroir(true); Island.show('transcribing'); }
    else if (s === 'idle' && Island.miroir) { Island.source = null; App.remoteLevels = null; Island.hide(); miroir(false); Island.place(); }
  });
  Desktop.on('levels', d => { App.remoteLevels = d; });
  Desktop.on('history', () => loadHistory({ quiet: true }));
  Desktop.on('settings', () => {
    Settings.load();
    Island.setPos(Settings.d.islandPos);
    /* position changée pendant que la bulle est visible : elle se déplace aussitôt */
    if (IS_BUBBLE && Island.state !== 'hidden') Desktop.bubble(Settings.d.islandPos || 'center');
    UI.renderShortcut(); UI.renderChips();
    if (REMOTE && !$('#v-reglages').hidden && !Capture.active) UI.renderSettings();
  });
  Desktop.on('route', h => { if (h) location.hash = h; });
  Desktop.on('preview', () => { if (IS_BUBBLE) App.preview(); });
  Desktop.on('repaste', () => { if (IS_BUBBLE) App.repaste(); });
  Desktop.on('rewrite', () => { if (IS_BUBBLE) App.rewriteKey(); });
  if (REMOTE) {
    const sw = $('#login-switch');
    Desktop.getLogin().then(v => sw.setAttribute('aria-checked', String(!!v)));
    sw.addEventListener('click', async () => {
      const v = await Desktop.setLogin(sw.getAttribute('aria-checked') !== 'true');
      sw.setAttribute('aria-checked', String(!!v));
    });
    wireUpdates();
  }
}

/* Mises à jour automatiques (bureau) : l'app vérifie, télécharge et installe ; la page montre
   l'état dans Réglages › Général et transmet l'interrupteur. Rien de tout ça dans la version web. */
function wireUpdates() {
  const render = s => {
    if (!s) return;
    const avant = App.maj?.etat;
    App.maj = s;
    document.body.classList.toggle('maj-prete', s.etat === 'ready');
    UI.renderRegNav();
    if (s.etat === 'ready' && avant !== 'ready' && App.majDite !== s.version) {
      App.majDite = s.version;
      Toast.show({ type: 'info', text: `Verbe ${s.version} est prête.`, sub: 'Elle s’installe quand tu quittes Verbe, ou tout de suite :', duration: 15000, action: { label: 'Redémarrer', fn: () => Desktop.installUpdate() } });
    }
    const cur = `Version ${s.courante}.`;
    const [titre, aide] = {
      dev: ['Version de développement', 'Les mises à jour automatiques marchent dans la version installée.'],
      idle: ['Mises à jour', s.auto === false ? `${cur} Vérification automatique coupée.` : `${cur} Vérification dans quelques secondes.`],
      off: ['Vérification automatique coupée', cur],
      checking: ['Vérification…', cur],
      uptodate: ['Verbe est à jour', cur],
      downloading: [`Nouvelle version ${s.version}`, `Téléchargement… ${s.pourcent || 0} %`],
      ready: [`Nouvelle version ${s.version} prête`, 'Elle s’installe quand tu quittes Verbe.'],
      error: ['Vérification impossible', 'Pas de connexion, ou service indisponible. Réessaie plus tard.'],
    }[s.etat] || ['Mises à jour', cur];
    $('#maj-titre').textContent = titre;
    $('#maj-aide').textContent = aide;
    const ready = s.etat === 'ready';
    $('#maj-redemarrer').hidden = !ready;
    $('#maj-verifier').hidden = ready || s.etat === 'dev';
    $('#maj-verifier').disabled = s.etat === 'checking' || s.etat === 'downloading';
  };
  Desktop.onUpdate(render);
  Desktop.setAutoUpdate(Settings.d.autoUpdate !== false).then(render); /* après une mise à jour, la fenêtre des Nouveautés le dit */
  $('#maj-switch').addEventListener('click', () => Desktop.setAutoUpdate(Settings.d.autoUpdate).then(render));
  $('#maj-verifier').addEventListener('click', () => Desktop.checkUpdate().then(render));
  $('#maj-redemarrer').addEventListener('click', () => Desktop.installUpdate());
}

/* ------------------------------------------------------------
   Nouveautés (v0.5.2) : après une mise à jour, une fenêtre présente ce
   qui change, une nouveauté par page, une seule fois par version.
   Réglages › Général › « Nouveautés » la rouvre. À chaque version :
   monter VERSION (comme package.json) et ajouter ses nouveautés en tête.
   ------------------------------------------------------------ */
const VERSION = '0.6.0';
const NOUVEAUTES = [
  { v: '0.6.0', icon: 'sparkles', title: 'Des transcriptions plus propres', text: 'Quand Whisper invente « Sous-titres réalisés par Amara.org » sur un silence, Verbe retire maintenant la phrase en entier.' },
  { v: '0.5.3', icon: 'mic', desk: true, title: 'La bulle descend', text: 'En bas, elle se pose juste au-dessus de la barre des tâches, plus loin de ce que tu écris.' },
  { v: '0.5.2', icon: 'audioLines', desk: true, title: 'La même voix partout', text: 'Pendant la dictée, la fenêtre de Verbe montre la même pastille que la bulle, à la place du micro.' },
  { v: '0.5.2', icon: 'download', desk: true, title: 'Des mises à jour qui se voient', text: 'Verbe cherche les nouvelles versions tout seul. Quand l’une est prête, un point rouge s’allume sur Réglages ; à l’installation, il te prévient et se rouvre tout seul.' },
  { v: '0.5.1', icon: 'copy', desk: true, title: 'Ta dictée reste dans le presse-papiers', text: 'Collée au mauvais endroit ? Clique où tu veux et fais Ctrl + V. Et Ctrl + Maj + 9 recolle la dernière dictée.' },
  { v: '0.5.1', icon: 'mic', desk: true, title: 'Une bulle plus fine', text: 'Un tiers plus mince, le même style : elle se fait discrète pendant que tu parles.' },
];
/* une nouvelle installation n'a rien à découvrir : on le sait avant que les réglages s'enregistrent */
const DEJA_LA = (() => { try { return !!localStorage.getItem('verbe.reglages.v1'); } catch (e) { return false; } })();
const News = {
  key: 'verbe.nouveautes',
  seen() { try { return localStorage.getItem(this.key); } catch (e) { return VERSION; } },
  mark() { try { localStorage.setItem(this.key, VERSION); } catch (e) { /* stockage indisponible */ } },
  /* ce qui est nouveau depuis la version vue (dans la version web : seulement ce qui la concerne) */
  since(after) { return NOUVEAUTES.filter(n => cmpVer(n.v, after) > 0 && cmpVer(n.v, VERSION) <= 0 && (Desktop || !n.desk)); },
  /* ce qu'il faut montrer à ce démarrage ; décidé (et noté pour une nouvelle installation) tout de suite,
     pour qu'un Verbe fermé aussitôt ouvert ne prenne pas sa première visite pour une mise à jour */
  pending() {
    if (IS_BUBBLE) return [];
    let vu = this.seen();
    if (!vu) { if (!DEJA_LA) { this.mark(); return []; } vu = '0.5.0'; } /* avant la 0.5.2, rien n'était noté */
    const list = this.since(vu);
    if (!list.length) this.mark();
    return list;
  },
  open(list = NOUVEAUTES.filter(n => n.v === VERSION && (Desktop || !n.desk))) {
    if (!list.length || $('#news')) return;
    let i = 0;
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap'; wrap.id = 'news';
    wrap.innerHTML = `<div class="modal news" role="dialog" aria-modal="true" aria-labelledby="news-title">
      <div class="news-art" aria-hidden="true"><span class="news-ver">Verbe ${VERSION}</span><span class="news-ic"></span></div>
      <div class="news-body">
        <div class="news-step"><p class="news-kick"></p><h2 id="news-title"></h2><p class="news-txt"></p></div>
        <div class="news-dots" aria-hidden="true">${list.map(() => '<i></i>').join('')}</div>
        <div class="news-actions"><button class="btn btn-2 btn-sm" type="button" data-n="skip">Passer</button><button class="btn btn-1" type="button" data-n="next"></button></div>
      </div></div>`;
    const step = wrap.querySelector('.news-body > div'), next = wrap.querySelector('[data-n="next"]');
    const show = () => {
      const n = list[i], last = i === list.length - 1;
      wrap.querySelector('.news-ic').innerHTML = icon(n.icon, 52);
      wrap.querySelector('.news-kick').textContent = list.length > 1 ? `Nouveau dans Verbe ${VERSION} · ${i + 1} / ${list.length}` : `Nouveau dans Verbe ${VERSION}`;
      wrap.querySelector('#news-title').textContent = n.title;
      wrap.querySelector('.news-txt').textContent = n.text;
      wrap.querySelectorAll('.news-dots i').forEach((d, k) => d.classList.toggle('on', k === i));
      next.textContent = last ? 'C’est parti' : 'Suivant';
      wrap.querySelector('[data-n="skip"]').style.visibility = last ? 'hidden' : '';
      step.classList.remove('news-step'); void step.offsetWidth; step.classList.add('news-step');
    };
    const close = () => { this.mark(); wrap.remove(); document.removeEventListener('keydown', onKey, true); this.back?.focus?.(); };
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'ArrowRight' && i < list.length - 1) { i++; show(); }
      else if (e.key === 'ArrowLeft' && i > 0) { i--; show(); }
    };
    wrap.addEventListener('click', e => {
      if (e.target === wrap) return close();
      const b = e.target.closest('[data-n]'); if (!b) return;
      if (b.dataset.n === 'skip' || i === list.length - 1) return close();
      i++; show(); next.focus();
    });
    document.addEventListener('keydown', onKey, true);
    this.back = document.activeElement;
    document.body.appendChild(wrap);
    show(); next.focus();
  },
};
