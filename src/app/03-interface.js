/* ============================================================
   3. Petits éléments d'interface : toasts, modale, sons
   ============================================================ */
const Toast = {
  show({ type = 'ok', text, sub = '', action = null, duration }) {
    const root = $('#toasts');
    const el = document.createElement('div');
    el.className = `toast t-${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    const ic = { ok: 'circleCheck', error: 'alert', warn: 'alert', info: 'info' }[type] || 'info';
    el.innerHTML = `<span class="t-ic">${icon(ic, 20)}</span><div class="t-body"><p class="t-text"></p>${sub ? '<p class="t-sub"></p>' : ''}</div>${action ? '<button class="t-act" type="button"></button>' : ''}<button class="t-x" type="button" aria-label="Fermer">${icon('x', 18)}</button>`;
    el.querySelector('.t-text').textContent = text;
    if (sub) el.querySelector('.t-sub').textContent = sub;
    let timer = 0;
    const close = () => { clearTimeout(timer); el.remove(); };
    if (action) {
      const b = el.querySelector('.t-act'); b.textContent = action.label;
      b.addEventListener('click', () => { close(); action.fn(); });
    }
    el.querySelector('.t-x').addEventListener('click', close);
    root.prepend(el);
    while (root.children.length > 4) root.lastElementChild.remove();
    const ms = duration ?? (type === 'error' ? 0 : 4200);
    if (ms) timer = setTimeout(close, ms);
    return { close };
  },
};

function confirmDialog({ title, body, confirm = 'Confirmer', danger = false }) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-title"><h3 id="m-title"></h3><p></p><div class="m-actions"><button class="btn btn-2" type="button" data-r="0">Annuler</button><button class="btn ${danger ? 'btn-danger' : 'btn-1'}" type="button" data-r="1"></button></div></div>`;
    wrap.querySelector('h3').textContent = title;
    wrap.querySelector('p').textContent = body;
    wrap.querySelector('[data-r="1"]').textContent = confirm;
    const prev = document.activeElement;
    const done = v => { wrap.remove(); document.removeEventListener('keydown', onKey, true); prev?.focus?.(); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); } };
    wrap.addEventListener('click', e => { if (e.target === wrap) done(false); const b = e.target.closest('[data-r]'); if (b) done(b.dataset.r === '1'); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(wrap);
    wrap.querySelector('[data-r="0"]').focus();
  });
}

const Sound = {
  play(kind) {
    if (!Settings.d.sounds) return;
    try {
      /* le même moteur que le micro : pas de deuxième création au premier son */
      const ctx = AudioEngine.ensure();
      if (ctx.state === 'suspended') ctx.resume();
      AudioEngine.rest();
      const t = ctx.currentTime + 0.01;
      const seq = { start: [[660, 0], [990, 0.07]], stop: [[880, 0], [587, 0.07]], done: [[1320, 0]], error: [[233, 0], [196, 0.11]] }[kind] || [];
      for (const [f, dt] of seq) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + dt);
        g.gain.exponentialRampToValueAtTime(kind === 'done' ? 0.035 : 0.055, t + dt + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.12);
        o.connect(g).connect(ctx.destination);
        o.start(t + dt); o.stop(t + dt + 0.14);
      }
    } catch (e) { /* le son est un bonus : jamais bloquant */ }
  },
};
