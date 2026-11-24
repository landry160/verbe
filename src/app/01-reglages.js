/* ============================================================
   1. Réglages (localStorage)
   ============================================================ */
/* Electron n'a pas la reconnaissance vocale de Chrome (elle passe par Google) */
const SR = window.verbeDesktop ? null : (window.SpeechRecognition || window.webkitSpeechRecognition || null);
const SETTINGS_KEY = 'verbe.reglages.v1';
const DEFAULTS = {
  provider: SR ? 'navigateur' : 'groq',
  keys: { groq: '', openai: '', mistral: '', gemini: '' },
  models: {},
  lang: 'fr',
  micId: 'default',
  shortcut: { ctrl: true, shift: true, alt: false, meta: false, code: 'KeyL', key: 'L' },
  mode: 'toggle',
  autoCopy: true,
  sounds: true,
  islandStyle: 'barres',
  islandPos: 'bottom', /* en bas au centre par défaut (demande du 24 nov.) */
  floating: true,
  floatTip: false,
  keepAudio: true,
  autoUpdate: true, /* bureau : vérifier les mises à jour au démarrage puis toutes les 6 h */
  freeLocal: true,
  hideTip: false,
  conflictTip: false,
  scV: 2,
  fixV: 1,
  posV: 1,
  clipV: 1,
  keepClip: true, /* la dictée reste dans le presse-papiers après le collage (demande du 24 nov.) */
  voiceCmds: true,
  autoClean: false,
  pasteLang: 'same', /* « Coller en » : 'same' = comme je parle, sinon la langue de la traduction (fr, en, es) */
  toneByApp: false, /* bureau : ton selon l'app au premier plan ; coupé par défaut (un appel au modèle à chaque dictée) */
  autoPaste: true,
  autoStop: '20', /* secondes sans voix avant l'arrêt automatique ; '0' = jamais */
  /* bureau : Recoller la dernière dictée et Réécrire la sélection, deux raccourcis globaux éteints
     par défaut (ils voleraient leur combinaison dans toutes les apps) ; la combinaison est proposée */
  repasteSc: { on: true, ctrl: true, shift: true, alt: false, meta: false, code: 'Digit9', key: '9' }, /* allumé par défaut (demande du 24 nov.) */
  rewriteSc: { on: false, ctrl: true, shift: true, alt: false, meta: false, code: 'Digit7', key: '7' },
  llm: {},
  words: [], /* Mes mots : [{ word: 'SlideFabrik', heard: 'slide fabrique' }] */
  snippets: [], /* Textes tout prêts : [{ name: 'signature', text: '…' }] */
};

/* ------------------------------------------------------------
   Version bureau (v0.3) : la même page tourne dans Electron.
   - la « bulle » (?bulle=1) est une petite fenêtre ronde, sans cadre,
     toujours au-dessus, qui ne prend jamais le focus : elle écoute,
     transcrit, copie et colle dans l'app où tu écris ;
   - la fenêtre principale (Dicter, Historique, Réglages) lui délègue
     le micro et reçoit son état.
   ------------------------------------------------------------ */
const Desktop = window.verbeDesktop || null;
const IS_BUBBLE = !!Desktop && new URLSearchParams(location.search).get('bulle') === '1';
const REMOTE = !!Desktop && !IS_BUBBLE; /* fenêtre principale : le micro vit dans la bulle */
if (Desktop) document.documentElement.classList.add('bureau');
/* Lien de l'installateur Windows, une fois publié en ligne. Vide = bouton caché. */
const DOWNLOAD_URL = 'https://github.com/landry160/verbe/releases/latest/download/Verbe-Setup.exe';
if (IS_BUBBLE) document.documentElement.classList.add('bulle');
/* Ctrl + une lettre seule, ou une lettre sans Ctrl/Alt/⌘, se bat avec
   Windows et le navigateur (Ctrl+V colle, Ctrl+C copie…). */
const CHROME_SHIFT = ['KeyT', 'KeyN', 'KeyW', 'KeyI', 'KeyJ', 'KeyC', 'KeyB', 'KeyO', 'KeyQ', 'KeyV', 'KeyM', 'KeyA', 'Delete', 'Tab'];
function shortcutProblem(sc) {
  if (!sc || !sc.code) return 'Raccourci vide.';
  if (!sc.ctrl && !sc.alt && !sc.meta) return 'Ajoute Ctrl, Alt ou ⌘ : une lettre seule s’écrirait dans tes textes.';
  if ((sc.ctrl || sc.meta) && !sc.shift && !sc.alt) return 'Ctrl + une seule touche est déjà pris par Windows ou le navigateur (coller, copier…). Ajoute Maj, par exemple Ctrl + Maj + L.';
  if ((sc.ctrl || sc.meta) && sc.shift && !sc.alt && CHROME_SHIFT.includes(sc.code)) return 'Ce raccourci est réservé par le navigateur. Essaies-en un autre.';
  return '';
}
/* Les raccourcis de Verbe : celui de la dictée, et dans le bureau, Recoller et Réécrire */
const ACTION_SC = { repaste: 'repasteSc', rewrite: 'rewriteSc' };
const SC_NAMES = { shortcut: 'Démarrer et arrêter la dictée', repaste: 'Recoller la dernière dictée', rewrite: 'Réécrire la sélection' };
const sameSc = (a, b) => !!a && !!b && a.code === b.code && ['ctrl', 'shift', 'alt', 'meta'].every(k => !!a[k] === !!b[k]);
/* target : « shortcut », « repaste » ou « rewrite » ; refuse une combinaison déjà prise par un autre raccourci de Verbe */
function scConflict(sc, target) {
  if (target !== 'shortcut' && sc.ctrl && sc.alt) return 'Ctrl + Alt, c’est AltGr sur un clavier canadien : tes caractères spéciaux ne s’écriraient plus. Essaies-en un autre.';
  const others = ['shortcut'].concat(Desktop ? Object.keys(ACTION_SC) : []).filter(t => t !== target);
  const t = others.find(o => sameSc(sc, Settings.d[o === 'shortcut' ? 'shortcut' : ACTION_SC[o]]));
  return t ? `Déjà utilisé pour « ${SC_NAMES[t]} ». Choisis-en un autre.` : '';
}
const Settings = {
  d: null, firstRun: false,
  load() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); } catch (e) { saved = null; }
    this.firstRun = !saved;
    const s = saved && typeof saved === 'object' ? saved : {};
    this.d = Object.assign(structuredClone(DEFAULTS), s);
    this.d.keys = Object.assign({}, DEFAULTS.keys, s.keys || {});
    this.d.models = Object.assign({}, s.models || {});
    this.d.shortcut = Object.assign({}, DEFAULTS.shortcut, s.shortcut || {});
    for (const k of Object.values(ACTION_SC)) this.d[k] = Object.assign({}, DEFAULTS[k], s[k] || {});
    if (!PROVIDERS[this.d.provider] || (PROVIDERS[this.d.provider].kind === 'webspeech' && !SR && Desktop)) this.d.provider = DEFAULTS.provider;
    /* v0.2 : Ctrl + Maj + L pour tout le monde, et jamais un raccourci qui vole le collage */
    if ((s.scV || 0) < 2 || shortcutProblem(this.d.shortcut)) {
      this.d.shortcut = Object.assign({}, DEFAULTS.shortcut);
      this.d.scV = 2;
      if (saved) this.save();
    }
    /* v0.3.1 (bureau) : un test du 23 nov. avait laissé Ctrl+Maj+K et coupé le
       collage automatique dans les réglages de l'app : on remet, une seule fois. */
    /* 24 nov. : la bulle et la pastille se placent en bas au centre par défaut ; une seule fois,
       « Centre » enregistré par l'ancien défaut devient « Bas » (un choix fait ensuite est respecté) */
    if (saved && (s.posV || 0) < 1) { if (this.d.islandPos === 'center') this.d.islandPos = 'bottom'; this.d.posV = 1; this.save(); }
    /* v0.5.1 : « Recoller la dernière dictée » allumé par défaut ; une seule fois pour les réglages déjà là */
    if (saved && (s.clipV || 0) < 1) { this.d.repasteSc = Object.assign({}, this.d.repasteSc, { on: true }); this.d.clipV = 1; this.save(); }
    if (Desktop && saved && (s.fixV || 0) < 1) {
      const k = this.d.shortcut;
      if (k.code === 'KeyK' && k.ctrl && k.shift && !k.alt && !k.meta) this.d.shortcut = Object.assign({}, DEFAULTS.shortcut);
      this.d.autoPaste = true;
      this.d.fixV = 1;
      this.save();
    }
  },
  save() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.d)); } catch (e) { return false; }
    if (Desktop) Desktop.notify('settings'); /* l'autre fenêtre relit les réglages */
    return true;
  },
  set(k, v) { this.d[k] = v; this.save(); },
};
