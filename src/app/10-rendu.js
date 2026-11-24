/* ============================================================
   10. Interface : rendu des vues
   ============================================================ */
const UI = {
  q: '',
  scLabel(sc = Settings.d.shortcut) {
    const k = [];
    if (sc.ctrl) k.push(IS_MAC ? '⌃' : 'Ctrl');
    if (sc.alt) k.push(IS_MAC ? '⌥' : 'Alt');
    if (sc.shift) k.push(IS_MAC ? '⇧' : 'Maj');
    if (sc.meta) k.push(IS_MAC ? '⌘' : 'Win');
    k.push(sc.key || sc.code);
    return k;
  },
  renderShortcut() {
    const keys = this.scLabel().map(x => `<kbd>${esc(x)}</kbd>`).join('');
    for (const el of $$('[data-sc]')) el.innerHTML = keys;
    for (const el of $$('[data-sc-default]')) el.innerHTML = this.scLabel(DEFAULTS.shortcut).map(x => `<kbd>${esc(x)}</kbd>`).join('');
    const sc = Settings.d.shortcut, def = DEFAULTS.shortcut;
    const same = ['ctrl', 'shift', 'alt', 'meta', 'code'].every(k => !!sc[k] === !!def[k] && (k !== 'code' || sc.code === def.code));
    const rs = $('#btn-sc-reset'); if (rs) rs.hidden = same;
    if (Island.state === 'ready') Island.setRight(COARSE.matches ? '' : this.scLabel().join(' '));
    for (const el of $$('[data-paste]')) el.innerHTML = `<kbd>${IS_MAC ? '⌘' : 'Ctrl'}</kbd><kbd>V</kbd>`;
    this.renderRegNav();
    if (REMOTE) this.syncGlobalShortcut();
    if (Desktop) this.renderActions();
  },
  /* bureau : Recoller et Réécrire, deux raccourcis globaux qu'on allume dans Réglages › Raccourci */
  renderActions() {
    for (const [name, k] of Object.entries(ACTION_SC)) {
      const sc = Settings.d[k];
      for (const el of $$(`[data-act-sc="${name}"]`)) el.innerHTML = this.scLabel(sc).map(x => `<kbd>${esc(x)}</kbd>`).join('');
      for (const sw of $$(`[data-act-on="${name}"]`)) sw.setAttribute('aria-checked', String(!!sc.on));
    }
    if (REMOTE) this.syncActions();
  },
  /* enregistrés auprès de Windows ; un échec veut dire qu'une autre app a déjà la combinaison */
  syncActions() {
    this._act = this._act || {}; this.actFail = this.actFail || {};
    for (const [name, k] of Object.entries(ACTION_SC)) {
      const sc = Settings.d[k], accel = sc.on && !shortcutProblem(sc) && !scConflict(sc, name) ? toAccel(sc) : '';
      if (accel === this._act[name]) continue;
      this._act[name] = accel;
      Desktop.setAction(name, accel).then(ok => {
        if (this._act[name] !== accel) return; /* changé entre-temps */
        const st = $(`[data-act-status="${name}"]`);
        this.actFail[name] = !ok; this.renderRegNav();
        if (ok) { if (st && /autre app/.test(st.textContent)) { st.textContent = ''; st.className = 'help'; } return; }
        if (st) { st.textContent = 'Une autre app utilise déjà ce raccourci dans Windows. Choisis-en un autre avec « Modifier ».'; st.className = 'help err'; }
        Toast.show({ type: 'warn', text: `${this.scLabel(sc).join(' + ')} est déjà pris par une autre app.`, sub: `« ${SC_NAMES[name]} » ne marchera pas. Change-le dans Réglages, section Raccourci.`, duration: 9000 });
      });
    }
  },
  /* bureau : le raccourci est enregistré auprès de Windows, pour toutes les apps */
  syncGlobalShortcut() {
    const sc = Settings.d.shortcut, accel = toAccel(sc);
    if (accel === this._accel) return;
    this._accel = accel;
    Desktop.setShortcut(accel).then(ok => {
      const st = $('#sc-status');
      if (ok) { if (st && /autre app/.test(st.textContent)) { st.textContent = ''; st.className = 'help'; } return; }
      this._accel = null;
      if (st) { st.textContent = 'Une autre app utilise déjà ce raccourci dans Windows. Choisis-en un autre avec « Modifier ».'; st.className = 'help err'; }
      Toast.show({ type: 'warn', text: `${this.scLabel().join(' + ')} est déjà pris par une autre app.`, sub: 'Change-le dans Réglages, section Raccourci.', duration: 9000 });
    });
  },
  renderChips() {
    const P = PROVIDERS[App.pid], missing = App.needsKey();
    /* la limite ne s'affiche ici que lorsqu'elle approche (moins de 15 %) */
    const q = Quota.view(App.pid), low = !missing && q.kind === 'limits' && q.low;
    const extra = missing ? ' · clé manquante' : low ? ` · ${q.empty ? 'limite atteinte' : `${q.short} restantes`}` : '';
    /* Dicter reste calme : le service n'apparaît que s'il y a quelque chose à savoir
       (la clé manquante a son propre bandeau), le micro choisi vit dans Réglages */
    const prov = low ? `<a class="chip warn" href="#reglages/transcription" title="Voir ce qu’il te reste">${icon('alert', 16)}<span>${esc(P.name)}${extra}</span></a>` : '';
    const open = !!Float.win;
    const flt = Float.supported ? `<button class="chip quiet" type="button" data-float aria-pressed="${open}" title="${open ? 'Fermer la mini-fenêtre' : 'Garder Verbe visible par-dessus tes autres onglets et apps'}">${icon('pip', 16)}<span>${open ? 'Mini-fenêtre ouverte' : 'Mini-fenêtre'}</span></button>` : '';
    const up = `<button class="chip quiet" type="button" data-upload title="MP3, M4A, WAV, WEBM, OGG, FLAC ou vidéo. Tu peux aussi le glisser sur la page.">${icon('upload', 16)}<span>Importer un fichier</span></button>`;
    $('#chips').innerHTML = prov + flt + up;
    /* sans clé, le micro n'a pas l'air prêt */
    $('#mic').classList.toggle('needs-key', missing);
    if (App.state === 'idle') $('#mic-cap').textContent = missing ? 'Ajoute ta clé pour dicter' : 'Appuie pour dicter';
    this.renderNotice();
    this.renderRegNav();
  },
  renderNotice() {
    const n = $('#notice'), P = PROVIDERS[App.pid];
    let warn = false, inner = '';
    if (P.kind === 'webspeech' && !SR) {
      warn = true;
      inner = `${icon('alert', 20)}<div><p><b>Ce navigateur n’a pas de reconnaissance vocale intégrée.</b> Ajoute une clé pour commencer : Groq offre un forfait gratuit.</p><div class="acts"><a class="btn btn-2 btn-sm" href="#reglages/transcription">Ajouter une clé</a></div></div>`;
    } else if (App.needsKey()) {
      warn = true;
      inner = `${icon('key', 20)}<div><p><b>Il manque ta clé ${esc(P.name)}.</b> Colle-la dans Réglages, c’est tout ce qu’il faut.</p><div class="acts"><a class="btn btn-1 btn-sm" href="#reglages/transcription">Ajouter ma clé</a></div></div>`;
    } else if (P.kind === 'webspeech' && !Settings.d.hideTip) {
      inner = `${icon('sparkles', 20)}<div><p><b>Mode gratuit actif.</b> Pour une transcription plus précise, avec une vraie ponctuation, ajoute une clé Groq gratuite (2 minutes).</p><div class="acts"><a class="btn btn-2 btn-sm" href="#reglages/transcription">Ajouter une clé</a><button class="btn btn-sm iconbtn" type="button" data-hide-tip>Plus tard</button></div></div>`;
    }
    n.className = 'notice' + (warn ? ' warn' : '');
    n.innerHTML = inner;
    n.hidden = !inner;
  },
  renderLast() {
    const it = App.last, body = $('#last-body'), meta = $('#last-meta'), acts = $('#last-actions');
    if (!it) {
      meta.textContent = '';
      acts.hidden = true;
      body.innerHTML = `<div class="empty"><span class="icbox">${icon('audioLines', 26)}</span><p>Ta première dictée apparaîtra ici.</p><p class="small">Elle sera aussi copiée, prête à coller${COARSE.matches ? '' : ` avec ${pasteHint()}`}.</p></div>`;
      return;
    }
    const bits = [plural(it.words, 'mot', 'mots')];
    /* court, pour tenir sur la ligne des boutons (le détail est dans l'historique) */
    if (it.durationMs) bits.push(fmtClock(it.durationMs));
    if (it.latencyMs != null) bits.push(`prêt en ${fmtSec(it.latencyMs)}`);
    meta.textContent = bits.join(' · ');
    meta.title = `${PROVIDERS[it.provider]?.name || it.provider}${it.durationMs ? ` · ${fmtClock(it.durationMs)} d’audio` : ''}`;
    acts.hidden = false;
    const cb = $('#btn-clean-last'), busy = App.cleaning === it.id;
    cb.disabled = busy || !!it.cleaned;
    cb.innerHTML = `${icon(busy ? 'loader' : it.cleaned ? 'check' : 'sparkles', 18, busy ? 'spinning' : '')}${busy ? 'Nettoyage…' : it.cleaned ? 'Nettoyé' : 'Nettoyer'}`;
    let ta = $('#last-text');
    if (!ta) { body.innerHTML = '<label class="sr-only" for="last-text">Texte de la dernière dictée</label><textarea id="last-text" rows="4"></textarea>'; ta = $('#last-text'); ta.addEventListener('input', () => this.editLast()); }
    ta.value = it.text;
    this.fitLast();
  },
  /* la carte grandit avec le texte, sans jamais faire défiler la page :
     au-delà, c'est la zone de texte qui défile */
  fitLast() { /* hauteur fixe en CSS (#last-body) : plus rien à ajuster */ },
  editLast() {
    clearTimeout(this._edit);
    this._edit = setTimeout(() => { const it = App.last, ta = $('#last-text'); if (!it || !ta) return; it.text = ta.value; it.words = countWords(ta.value); Store.put(it).catch(() => {}); this.renderHistory(); }, 400);
    this.fitLast();
  },

  /* progrès : mots dictés (semaine, total), temps gagné estimé, série de jours ; rien avant la première dictée */
  renderProgress() {
    const el = $('#h-prog'), line = $('#h-prog-line');
    if (!el || !line) return;
    const p = Stats.summary();
    el.hidden = !p.n;
    if (!p.n) return;
    const seg = (n, rest) => `<span class="nw"><b>${n}</b>&nbsp;${rest}</span>`;
    const mots = n => (n > 1 ? 'mots' : 'mot');
    const out = [];
    if (p.week && p.week < p.words) out.push(seg(nf0.format(p.week), `${mots(p.week)} cette semaine`), seg(nf0.format(p.words), 'au total'));
    else out.push(seg(nf0.format(p.words), `${mots(p.words)} ${p.words > 1 ? 'dictés' : 'dicté'}${p.week ? '' : ' au total'}`));
    const sec = Math.round(p.gainMs / 1000), gain = fmtAudio(sec);
    if (sec >= 1) out.push(seg(`≈&nbsp;${gain}`, /^1 (s|min)$/.test(gain) ? 'gagnée' : 'gagnées'));
    if (p.streak >= 3) out.push(seg(p.streak, 'jours de suite'));
    out[out.length - 1] = out[out.length - 1].replace(/<\/span>$/, `${icon('info', 16)}</span>`); /* l'icône reste avec le dernier bout */
    line.innerHTML = out.join('<span aria-hidden="true"> · </span>');
  },

  renderHistory() {
    const list = $('#h-list'), count = $('#h-count');
    if (!list) return;
    this.renderProgress();
    if (App.loadState === 'loading') {
      count.textContent = '';
      list.innerHTML = Array.from({ length: 3 }, () => `<div class="glass hcard" aria-hidden="true"><div class="skel" style="height:14px;width:30%"></div><div class="skel" style="height:14px;width:92%"></div><div class="skel" style="height:14px;width:70%"></div></div>`).join('');
      return;
    }
    if (App.loadState === 'error') {
      count.textContent = '';
      list.innerHTML = `<div class="glass hcard"><div class="empty"><span class="icbox">${icon('alert', 26)}</span><p>Impossible de lire l’historique.</p><p class="small">Le stockage du navigateur est peut-être bloqué.</p><button class="btn btn-2 btn-sm" type="button" data-reload-history>${icon('retry', 18)}Réessayer</button></div></div>`;
      return;
    }
    const items = App.items, q = norm(this.q.trim());
    count.textContent = items.length ? plural(items.length, 'dictée', 'dictées') : '';
    if (!items.length) {
      list.innerHTML = `<div class="glass hcard"><div class="empty"><span class="icbox">${icon('history', 26)}</span><p>Aucune dictée pour l’instant.</p><p class="small">Tes 100 dernières dictées seront gardées ici.</p><a class="btn btn-2" href="#dicter">${icon('mic', 18)}Faire une dictée</a></div></div>`;
      return;
    }
    const shown = q ? items.filter(i => norm(i.text + ' ' + (i.fileName || '')).includes(q)) : items;
    if (!shown.length) {
      list.innerHTML = `<div class="glass hcard"><div class="empty"><span class="icbox">${icon('search', 26)}</span><p>Aucun résultat pour « ${esc(this.q.trim())} ».</p><button class="btn btn-2 btn-sm" type="button" data-clear-search>Effacer la recherche</button></div></div>`;
      return;
    }
    list.innerHTML = shown.map(it => this.card(it)).join('');
  },
  card(it) {
    const P = PROVIDERS[it.provider];
    /* « Transcrite » est l'état normal : on ne signale que l'inhabituel */
    const pill = it.status === 'ok' ? ''
      : it.status === 'error' ? `<span class="pill err">${icon('alert', 12)}Échec</span>`
      : `<span class="pill pend">${icon('loader', 12)}En cours</span>`;
    const src = it.source === 'fichier' ? `<span class="pill file">${icon('fileAudio', 12)}Fichier</span>` : '';
    const text = it.status === 'ok' ? `<p class="htext" data-expand title="Afficher tout">${esc(it.text)}</p>`
      : it.status === 'error' ? `<p class="htext err">${esc(it.error || 'La transcription a échoué.')}</p>`
      : `<div class="skel" style="height:14px;width:80%"></div>`;
    /* une seule ligne discrète : quand · durée · mots (le service et la vitesse restent en infobulle) */
    const meta = [`<time datetime="${new Date(it.createdAt).toISOString()}">${relTime(it.createdAt)}</time>`];
    if (it.fileName) meta.push(`<span>${icon('fileAudio', 14)}${esc(it.fileName)}</span>`);
    if (it.durationMs) meta.push(`<span>${fmtClock(it.durationMs)}</span>`);
    if (it.words) meta.push(`<span>${plural(it.words, 'mot', 'mots')}</span>`);
    const tip = [P?.name, it.latencyMs != null && it.status === 'ok' ? `prête en ${fmtSec(it.latencyMs)}` : ''].filter(Boolean).join(' · ');
    const acts = [];
    if (it.status === 'ok') acts.push(`<button class="iconbtn" type="button" data-copy="${it.id}">${icon('copy', 16)}Copier</button>`);
    /* « Copier » en clair ; les gestes plus rares en icônes nommées (infobulle + lecteur d'écran) */
    const cleaning = App.cleaning === it.id;
    if (it.status === 'ok' && !it.cleaned) acts.push(`<button class="iconbtn" type="button" data-clean="${it.id}" ${cleaning ? 'disabled' : ''} aria-label="Nettoyer le texte" title="Nettoyer : enlève les « euh » et les répétitions">${icon(cleaning ? 'loader' : 'sparkles', 16, cleaning ? 'spinning' : '')}${cleaning ? 'Nettoyage…' : ''}</button>`);
    if (it.cleaned) meta.push(`<span>${icon('sparkles', 14)}Nettoyé</span>`);
    if (it.lang && PASTE_LANGS[it.lang]) meta.push(`<span${it.raw ? ` title="Ce que tu as dit : ${esc(it.raw)}"` : ''}>${icon('languages', 14)}${PASTE_LANGS[it.lang][0]}</span>`);
    if (it.hasAudio && it.status !== 'pending') acts.push(it.status === 'error'
      ? `<button class="iconbtn" type="button" data-retry="${it.id}">${icon('retry', 16)}Réessayer</button>`
      : `<button class="iconbtn" type="button" data-retry="${it.id}" aria-label="Retranscrire" title="Retranscrire depuis l’audio gardé">${icon('retry', 16)}</button>`);
    if (it.status !== 'pending') acts.push(`<button class="iconbtn danger" type="button" data-del="${it.id}" aria-label="Supprimer cette dictée" title="Supprimer">${icon('trash', 16)}</button>`);
    const flags = pill + src;
    return `<article class="glass hcard" data-id="${it.id}">${flags ? `<div class="htop">${flags}</div>` : ''}${text}<div class="hfoot"><div class="meta"${tip ? ` title="${esc(tip)}"` : ''}>${meta.join('<span aria-hidden="true">·</span>')}</div><div class="hacts">${acts.join('')}</div></div></article>`;
  },

  /* ----- Réglages ----- */
  renderSettings() {
    const d = Settings.d, P = PROVIDERS[d.provider];
    const sel = $('#f-provider');
    if (!sel.options.length) sel.innerHTML = Object.entries(PROVIDERS).filter(([, p]) => !(Desktop && p.kind === 'webspeech')).map(([id, p]) => `<option value="${id}">${esc(p.label)}</option>`).join('');
    sel.value = d.provider;
    $('#provider-note').textContent = P.note;
    const hasKey = P.kind !== 'webspeech';
    $('#key-field').hidden = !hasKey;
    $('#adv-model').closest('.group').hidden = !hasKey;
    $('#local-field').hidden = P.kind !== 'webspeech';
    if (hasKey) {
      $('#f-key-label').textContent = `Clé API ${P.name}`;
      const key = $('#f-key'); if (document.activeElement !== key) key.value = d.keys[d.provider] || '';
      key.placeholder = P.keyHint ? `Colle ta clé (${P.keyHint})` : 'Colle ta clé';
      const link = $('#key-link'); link.href = P.keyUrl; link.innerHTML = `${esc(P.keyCta)} ${icon('external', 16)}`;
      const model = $('#f-model'); if (document.activeElement !== model) model.value = d.models[d.provider] || P.model;
      $('#dl-models').innerHTML = P.models.map(m => `<option value="${esc(m)}"></option>`).join('');
    } else this.renderLocal();
    $('#key-status').textContent = ''; $('#key-status').className = 'help';
    $('#f-lang').value = d.lang;
    for (const grp of $$('[data-setting]')) for (const b of $$('button', grp)) b.setAttribute('aria-pressed', String(d[grp.dataset.setting] === b.dataset.value));
    for (const sw of $$('[data-switch]')) sw.setAttribute('aria-checked', String(!!d[sw.dataset.switch]));
    const fs = Float.supported;
    $('#float-switch').hidden = !fs;
    $('#float-help').textContent = fs
      ? 'Une petite fenêtre garde la pastille visible dans tes autres onglets et apps. Chrome la rouvre là où tu l’as glissée.'
      : 'Offerte dans Chrome et Edge sur ordinateur.';
    const theme = document.documentElement.dataset.theme || 'system';
    for (const b of $$('#theme-seg button')) b.setAttribute('aria-pressed', String(b.dataset.value === theme));
    this.renderMics();
    this.renderQuota();
    MotsUI.render();
    this.renderRegNav();
  },

  /* ----- Sections des réglages : une à la fois, la dernière ouverte est retenue ----- */
  section() {
    if (App.needsKey()) return 'transcription'; /* sans clé, on va droit à l'essentiel */
    try { const s = localStorage.getItem('verbe.section'); if (SECTIONS.includes(s)) return s; } catch (e) { /* ignore */ }
    return 'transcription';
  },
  showSection(id, list = false) {
    if (!SECTIONS.includes(id)) id = 'transcription';
    const reg = $('#v-reglages .reg');
    reg.classList.toggle('is-list', !!list); reg.classList.toggle('is-pane', !list);
    if (!list && NARROW.matches) window.scrollTo(0, 0);
    try { localStorage.setItem('verbe.section', id); } catch (e) { /* ignore */ }
    for (const p of $$('#v-reglages .pane')) p.hidden = p.dataset.sec !== id;
    for (const t of $$('.reg-tab')) t.setAttribute('aria-current', String(t.dataset.sec === id));
    if (id !== 'micro') Monitor.stop();
    if (id !== 'raccourci' && Capture.active) Capture.end();
  },
  /* Ce qu'il te reste avant la limite du service choisi (section Transcription) */
  renderQuota() {
    const body = $('#quota-body'); if (!body) return;
    const pid = App.pid, P = PROVIDERS[pid], q = Quota.view(pid), src = $('#quota-src');
    const line = (big, unit, left, limit, of) => {
      const f = limit ? Math.max(0, Math.min(1, left / limit)) : 0;
      const cls = f <= 0 ? 'empty' : f < 0.15 ? 'low' : '';
      return `<div class="qline ${cls}"><b>${big} <span>${unit}</span></b><div class="qbar" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(f * 100)}" aria-label="${esc(unit)}"><i style="width:${(f * 100).toFixed(1)}%"></i></div><small>${of}</small></div>`;
    };
    $('#quota-group').hidden = false;
    if (q.kind === 'free') { $('#quota-group').hidden = true; return; }
    if (q.kind === 'paid') {
      src.textContent = `${P.name} est payé à l’usage : pas de plafond par jour. Compté par Verbe sur les dernières 24 h.`;
      body.innerHTML = `<div class="quota"><div class="qline"><b>${fmtAudio(q.day.sec)} <span>d’audio envoyé</span></b><span></span><small>≈ ${q.cost.toLocaleString('fr-CA', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })}</small></div></div>`;
      return;
    }
    if (q.kind === 'unknown') {
      src.textContent = `${P.name} ne publie pas ce qu’il reste. Voici ce que Verbe a envoyé sur les dernières 24 h.`;
      body.innerHTML = `<div class="quota"><div class="qline"><b>${nf0.format(q.day.req)} <span>requêtes</span></b><span></span><small>${fmtAudio(q.day.sec)} d’audio</small></div></div>`;
      return;
    }
    const plan = q.plan === 'dev' ? 'forfait Developer' : 'forfait gratuit';
    const reset = q.api && q.api.resetAt > Date.now() ? ` Remise à zéro des requêtes dans ${fmtWait(q.api.resetAt - Date.now())}.` : '';
    src.textContent = q.api
      ? `Selon ${P.name} (${plan}), ${relTime(q.api.at)}. L’audio est compté par Verbe sur 24 h.${reset}`
      : `Estimé par Verbe : ce que cet appareil a envoyé sur les dernières 24 h, comparé au ${plan} de ${P.name}.${Desktop ? ' Le compte exact arrive avec ta prochaine dictée.' : ''}`;
    let html = '<div class="quota">';
    html += line(nf0.format(q.req.left), 'requêtes', q.req.left, q.req.limit, `sur ${nf0.format(q.req.limit)} par jour`);
    html += line(fmtAudio(q.audio.left), 'd’audio', q.audio.left, q.audio.limit, `sur ${fmtAudio(q.audio.limit)} par jour`);
    if (q.hourLeft < q.ash * 0.5) html += line(fmtAudio(q.hourLeft), 'cette heure-ci', q.hourLeft, q.ash, `sur ${fmtAudio(q.ash)} par heure`);
    body.innerHTML = html + '</div>';
  },
  /* l'état de chaque section, lisible sans l'ouvrir */
  renderRegNav() {
    if (!$('.reg-nav')) return;
    const d = Settings.d, P = PROVIDERS[d.provider], missing = App.needsKey();
    const style = { barres: 'Barres', onde: 'Onde', points: 'Points' }[d.islandStyle] || 'Barres';
    const pos = { center: 'au centre', top: 'en haut', bottom: 'en bas' }[d.islandPos] || 'au centre';
    const txt = [d.voiceCmds && 'Commandes', d.autoClean && 'Texte propre', Desktop ? d.autoPaste && 'Collage auto' : d.autoCopy && 'Copie auto'].filter(Boolean);
    if (PASTE_LANGS[d.pasteLang]) txt.push(`En ${PASTE_LANGS[d.pasteLang][1]}`);
    if (Desktop && d.toneByApp) txt.push('Ton selon l’app');
    const theme = { light: 'Clair', dark: 'Sombre' }[document.documentElement.dataset.theme] || 'Apparence du système';
    const sums = {
      transcription: (() => {
        if (missing) return [`${P.name} · clé manquante`, true];
        const q = Quota.view(d.provider);
        if (q.kind !== 'limits') return [P.name, false];
        return [`${P.name} · ${q.empty ? 'limite atteinte' : q.tiny}`, q.low];
      })(),
      micro: [Number(d.autoStop) ? `${Mics.name(d.micId)} · arrêt après ${Number(d.autoStop) >= 60 ? '1 min' : d.autoStop + ' s'}` : Mics.name(d.micId), false],
      raccourci: Desktop ? [[this.scLabel().join(' '), d.repasteSc.on && 'Recoller', d.rewriteSc.on && 'Réécrire'].filter(Boolean).join(' · '), Object.values(this.actFail || {}).some(Boolean)] : [this.scLabel().join(' '), false],
      texte: [txt.length ? txt.join(' · ') : 'Texte brut', false],
      bulle: [`${style} · ${pos}`, false],
      general: Desktop && App.maj?.etat === 'ready' ? [`Version ${App.maj.version} prête`, true] : [theme, false],
    };
    for (const [k, [t, warn]] of Object.entries(sums)) {
      const el = $(`[data-sum="${k}"]`); if (!el) continue;
      el.textContent = t; el.classList.toggle('warn', !!warn);
    }
  },
  async renderLocal() {
    const st = $('#local-status'), btn = $('#btn-local');
    btn.hidden = true;
    if (!SR) { st.textContent = 'Ce navigateur n’a pas de reconnaissance vocale. Ajoute plutôt une clé.'; return; }
    if (typeof SR.available !== 'function') { st.textContent = 'Non offert par ce navigateur : Chrome et Edge envoient l’audio à leurs serveurs pour le reconnaître.'; return; }
    st.textContent = 'Vérification…';
    try {
      const s = await SR.available({ langs: [srLang()], processLocally: true });
      if (s === 'available') st.textContent = 'Active : l’audio reste sur ton ordi.';
      else if (s === 'downloadable') { st.textContent = 'Offerte : installe le modèle pour que l’audio reste sur ton ordi.'; btn.hidden = false; }
      else if (s === 'downloading') st.textContent = 'Téléchargement du modèle en cours…';
      else st.textContent = 'Pas offerte pour cette langue : l’audio est envoyé aux serveurs du navigateur.';
    } catch (e) { st.textContent = 'Pas offerte ici : l’audio est envoyé aux serveurs du navigateur.'; }
  },
  renderMics() {
    const sel = $('#f-mic'); if (!sel) return;
    const list = Mics.list.filter(d => d.deviceId !== 'communications');
    const opts = [`<option value="default">${esc(Mics.name('default'))}</option>`];
    for (const d of list) if (d.deviceId !== 'default' && d.deviceId) opts.push(`<option value="${esc(d.deviceId)}">${esc(Mics.clean(d.label) || 'Micro')}</option>`);
    const cur = Settings.d.micId;
    if (cur !== 'default' && !list.some(d => d.deviceId === cur)) opts.push(`<option value="${esc(cur)}">Micro débranché</option>`);
    sel.innerHTML = opts.join('');
    sel.value = cur;
    $('#mic-perm-note').hidden = Mics.labelsOk || !Mics.ready;
    $('#btn-mic-perm').hidden = Mics.labelsOk || !Mics.ready;
  },
};

/* Test du micro dans Réglages */
const Monitor = {
  stream: null, meter: null, raf: 0,
  async start() {
    this.stop();
    const btn = $('#btn-mic-test');
    try {
      const ctx = await AudioEngine.getCtx();
      this.stream = await Rec.open();
      this.meter = new Meter(ctx, this.stream);
      btn.innerHTML = `${icon('square', 18)}Arrêter le test`;
      if (!Mics.labelsOk) { await Mics.refresh(); UI.renderMics(); UI.renderChips(); }
      const bar = $('#meter > i'), m = $('#meter');
      const loop = () => {
        if (!this.meter) return;
        const v = Math.round(this.meter.read().level * 100);
        bar.style.width = v + '%'; m.setAttribute('aria-valuenow', String(v));
        this.raf = requestAnimationFrame(loop);
      };
      loop();
    } catch (e) { this.stop(); App.micError(e); }
  },
  stop() {
    cancelAnimationFrame(this.raf); this.raf = 0;
    this.meter?.disconnect(); this.stream?.getTracks().forEach(t => t.stop());
    this.meter = null; this.stream = null; AudioEngine.rest();
    const bar = $('#meter > i'); if (bar) bar.style.width = '0%';
    const btn = $('#btn-mic-test'); if (btn) btn.innerHTML = `${icon('mic', 18)}Tester le micro`;
  },
  get on() { return !!this.meter; },
};

/* Capture d'un nouveau raccourci */
const Capture = {
  active: false, target: 'shortcut', /* « shortcut » (la dictée), ou dans le bureau « repaste » / « rewrite » */
  els(t = this.target) {
    if (t === 'shortcut') return { kcap: $('#kcap'), msg: $('#capture-msg'), btn: $('#btn-sc'), st: $('#sc-status') };
    const k = $(`[data-act-kcap="${t}"]`);
    return { kcap: k, msg: k.querySelector('.capture-msg'), btn: k.querySelector('[data-act-edit]'), st: $(`[data-act-status="${t}"]`) };
  },
  start(target = 'shortcut') {
    if (this.active) this.end();
    this.active = true; this.target = target;
    const E = this.els();
    E.kcap.classList.add('capturing'); E.msg.hidden = false; E.btn.hidden = true;
    E.st.textContent = ''; E.st.className = 'help';
  },
  end() { this.active = false; const E = this.els(); E.kcap.classList.remove('capturing'); E.msg.hidden = true; E.btn.hidden = false; },
  onKey(e) {
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') { this.end(); return; }
    if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock'].includes(e.key)) return;
    const st = this.els().st;
    const key = e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.code === 'Space' ? 'Espace' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
    const sc = { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey, code: e.code, key };
    const pb = shortcutProblem(sc) || scConflict(sc, this.target);
    if (pb) { st.textContent = pb; st.className = 'help warn'; return; }
    /* Recoller, Réécrire : choisir une combinaison les allume */
    if (this.target !== 'shortcut') Settings.set(ACTION_SC[this.target], Object.assign({ on: true }, sc));
    else Settings.set('shortcut', sc);
    lastScDown = now(); /* le relâchement de cette combinaison ne doit pas lancer la dictée */
    UI.renderShortcut(); this.end();
    st.textContent = 'Raccourci enregistré.'; st.className = 'help ok';
  },
};

/* Thème */
function applyTheme(t) {
  const root = document.documentElement;
  try {
    if (t === 'light' || t === 'dark') { root.dataset.theme = t; localStorage.setItem('theme', t); }
    else { delete root.dataset.theme; localStorage.removeItem('theme'); }
  } catch (e) { /* ignore */ }
  updateThemeColor();
  Float.syncTheme();
}
function updateThemeColor() {
  const t = document.documentElement.dataset.theme;
  const dark = t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches);
  $('meta[name="theme-color"]').content = dark ? '#100C0A' : '#FAF7F3';
}

/* Navigation par ancre */
const VIEWS = ['dicter', 'historique', 'reglages'];
/* #reglages/micro ouvre directement la section Micro */
const SECTIONS = ['transcription', 'micro', 'raccourci', 'texte', 'bulle', 'general'];
const NARROW = window.matchMedia('(max-width: 900px)');
function route() {
  const [h, sub] = (location.hash || '#dicter').slice(1).split('/'), v = VIEWS.includes(h) ? h : 'dicter';
  document.body.dataset.view = v;
  for (const id of VIEWS) $(`#v-${id}`).hidden = id !== v;
  for (const a of $$('[data-v]')) { if (a.dataset.v === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
  if (v !== 'reglages') { Monitor.stop(); if (Capture.active) Capture.end(); }
  /* sur téléphone, #reglages montre la liste des sections ; #reglages/micro, la section Micro */
  if (v === 'reglages') { UI.renderSettings(); UI.showSection(sub || UI.section(), !sub); }
  if (v === 'historique') UI.renderHistory();
  if (v === 'dicter') requestAnimationFrame(() => UI.fitLast());
  Island.place(); /* changer d'écran pendant une dictée : la pastille suit */
}
