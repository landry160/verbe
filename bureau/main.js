// Verbe, version bureau (Windows).
// - un raccourci global (Ctrl + Maj + L par défaut) marche dans toutes les apps ;
// - une bulle ronde, sans cadre, toujours au-dessus, qui ne prend jamais le focus ;
// - le texte est copié puis collé tout seul là où on écrivait ;
// - la fenêtre principale (Dicter, Historique, Réglages) se range près de l'horloge.
const { app, BrowserWindow, globalShortcut, ipcMain, clipboard, screen, Tray, Menu, nativeImage, session, shell, Notification } = require('electron');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PAGE = path.join(ROOT, 'app', 'verbe.html');
/* développement (npm run dev:bureau) : la page servie par Vite, qui se recharge à chaque modification ;
   jamais dans l'app installée */
const DEV_URL = !app.isPackaged && process.env.VERBE_DEV_URL ? process.env.VERBE_DEV_URL.replace(/\/$/, '') : '';
const charger = (w, query) => DEV_URL ? w.loadURL(`${DEV_URL}/verbe.html${query ? '?' + new URLSearchParams(query) : ''}`) : w.loadFile(PAGE, query ? { query } : undefined);
const ICON = path.join(__dirname, 'icone.png');
const HIDDEN_START = process.argv.includes('--cache');
/* fenêtre transparente plus grande que la pastille (440 × 92 au plus) : son ombre tient dedans */
const BUBBLE_W = 520, BUBBLE_H = 190;

/* tests : un profil à part (--profil=dossier) pour ne jamais toucher les vrais réglages */
const profil = process.argv.find(a => a.startsWith('--profil='));
if (profil) app.setPath('userData', profil.slice('--profil='.length));
/* tests : --essai-clavier remplace le clavier, le presse-papiers et les raccourcis globaux par des faux
   en mémoire (voir plus bas). Aucune vraie touche n'est envoyée, aucun raccourci n'est pris à Windows,
   et le vrai presse-papiers n'est ni lu ni écrit. */
const ESSAI = process.argv.includes('--essai-clavier');
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.setAppUserModelId('Verbe');
/* la bulle démarre le son et le micro sans clic : pas de blocage « autoplay » */
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let main = null, bubble = null, tray = null, quitting = false;
let accel = null, bubbleState = 'idle', escOn = false;

/* ---------- Collage : Windows tape Ctrl+V pour nous (SendInput, via koffi) ----------
   Un appel direct à user32.dll : pas de PowerShell, rien que les antivirus puissent confondre
   avec un script caché. SendInput remplace keybd_event, que Microsoft considère comme dépassée. */
let SendInput = null, INPUT = null;
function loadKeyboard() {
  if (process.platform !== 'win32' || SendInput) return;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const MOUSEINPUT = koffi.struct('MOUSEINPUT', { dx: 'long', dy: 'long', mouseData: 'uint32', dwFlags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr' });
    const KEYBDINPUT = koffi.struct('KEYBDINPUT', { wVk: 'uint16', wScan: 'uint16', dwFlags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr' });
    const HARDWAREINPUT = koffi.struct('HARDWAREINPUT', { uMsg: 'uint32', wParamL: 'uint16', wParamH: 'uint16' });
    INPUT = koffi.struct('INPUT', { type: 'uint32', u: koffi.union('INPUT_U', { mi: MOUSEINPUT, ki: KEYBDINPUT, hi: HARDWAREINPUT }) });
    SendInput = user32.func('uint32 __stdcall SendInput(uint32 cInputs, _In_ INPUT *pInputs, int cbSize)');
  } catch (e) { console.error('[Verbe] clavier Windows indisponible :', e.message); SendInput = null; }
}
const KEYUP = 0x0002;
function key(vk, up) { return SendInput(1, { type: 1, u: { ki: { wVk: vk, wScan: 0, dwFlags: up ? KEYUP : 0, time: 0, dwExtraInfo: 0 } } }, require('koffi').sizeof(INPUT)) === 1; }
function sendPaste() {
  if (ESSAI) return essai.key('paste');
  loadKeyboard();
  if (!SendInput) return false;
  /* Maj encore enfoncée ferait Ctrl+Maj+V (collage sans mise en forme) : on la relâche d'abord */
  key(0x10, true);
  return key(0x11, false) && key(0x56, false) && key(0x56, true) && key(0x11, true);
}
/* Réécrire : Windows tape Ctrl+C dans l'app où tu as sélectionné du texte */
function sendCopy() {
  if (ESSAI) return essai.key('copy');
  loadKeyboard();
  if (!SendInput) return false;
  key(0x10, true);
  return key(0x11, false) && key(0x43, false) && key(0x43, true) && key(0x11, true);
}
/* Le numéro de version du presse-papiers de Windows : il change à chaque copie, même d'un texte identique */
let ClipSeq = null, KeyState = null;
function loadUser32Extras() {
  if (process.platform !== 'win32' || ClipSeq) return;
  try {
    const user32 = require('koffi').load('user32.dll');
    ClipSeq = user32.func('uint32 __stdcall GetClipboardSequenceNumber()');
    KeyState = user32.func('int16 __stdcall GetAsyncKeyState(int vKey)');
  } catch (e) { ClipSeq = null; KeyState = null; }
}
function clipSeq() { if (ESSAI) return essai.clip.seq; loadUser32Extras(); return ClipSeq ? ClipSeq() : -1; }
/* Un raccourci vient d'être fait : on attend que la personne relâche Ctrl, Maj, Alt, Win et la touche
   (au plus 1,5 s), sinon le Ctrl+C ou le Ctrl+V tapé pour elle deviendrait Ctrl+Maj+C, Alt+V… */
async function keysUp(acc) {
  if (ESSAI) return;
  loadUser32Extras();
  if (!KeyState) return;
  const vks = [0x10, 0x11, 0x12, 0x5B, 0x5C], k = String(acc || '').split('+').pop();
  if (/^[A-Z0-9]$/i.test(k)) vks.push(k.toUpperCase().charCodeAt(0));
  else if (/^F\d{1,2}$/.test(k)) vks.push(0x6F + Number(k.slice(1)));
  for (const t0 = Date.now(); Date.now() - t0 < 1500;) {
    if (!vks.some(v => KeyState(v) & 0x8000)) return;
    await new Promise(r => setTimeout(r, 20));
  }
}
/* vérification sans rien taper : relâcher Maj (qui n'est pas enfoncée) ne fait rien, mais prouve que Windows répond */
function pingKeyboard() { loadKeyboard(); return SendInput && key(0x10, true) ? 'pong' : 'absent'; }
global.verbePingKeyer = async () => pingKeyboard(); /* pour les tests */
global.verbeClipboard = { save: () => saveClipboard(), restore: t => restoreClipboard(t) }; /* pour les tests */

/* ---------- L'app au premier plan (ton selon l'app) ----------
   Au début d'une dictée, on lit le nom du programme où tu écris (« OUTLOOK.EXE », « ms-teams.exe »…)
   et on le donne à la bulle. Rien d'autre : ni le titre de la fenêtre, ni son contenu. */
let FG = null;
function loadForeground() {
  if (process.platform !== 'win32' || FG !== null) return FG;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll'), kernel32 = koffi.load('kernel32.dll');
    FG = {
      GetForegroundWindow: user32.func('void * __stdcall GetForegroundWindow()'),
      GetWindowThreadProcessId: user32.func('uint32 __stdcall GetWindowThreadProcessId(void *hWnd, _Out_ uint32 *lpdwProcessId)'),
      OpenProcess: kernel32.func('void * __stdcall OpenProcess(uint32 dwDesiredAccess, int bInheritHandle, uint32 dwProcessId)'),
      QueryFullProcessImageNameW: kernel32.func('int __stdcall QueryFullProcessImageNameW(void *hProcess, uint32 dwFlags, _Out_ uint16 *lpExeName, _Inout_ uint32 *lpdwSize)'),
      CloseHandle: kernel32.func('int __stdcall CloseHandle(void *hObject)'),
    };
  } catch (e) { console.error('[Verbe] app au premier plan illisible :', e.message); FG = false; }
  return FG;
}
function foregroundApp() {
  const f = loadForeground();
  if (!f) return '';
  try {
    const hwnd = f.GetForegroundWindow();
    if (!hwnd) return '';
    const pid = [0];
    f.GetWindowThreadProcessId(hwnd, pid);
    if (!pid[0]) return '';
    const h = f.OpenProcess(0x1000 /* PROCESS_QUERY_LIMITED_INFORMATION */, 0, pid[0]);
    if (!h) return '';
    try {
      const buf = new Uint16Array(1024), size = [buf.length];
      if (!f.QueryFullProcessImageNameW(h, 0, buf, size)) return '';
      return path.basename(Buffer.from(buf.buffer, 0, size[0] * 2).toString('utf16le'));
    } finally { f.CloseHandle(h); }
  } catch (e) { return ''; }
}
global.verbeForegroundApp = () => foregroundApp(); /* remplaçable par un faux dans les tests */
/* ---------- Mode test (--essai-clavier) : clavier, presse-papiers et raccourcis en mémoire ----------
   - essai.selection : le texte « sélectionné » dans l'app imaginaire ; Ctrl+C le copie (après 30 ms,
     comme une vraie app), rien s'il est vide ;
   - essai.collages : ce que chaque Ctrl+V a collé ; essai.touches : chaque combinaison tapée ;
   - essai.pris : des raccourcis « déjà pris par une autre app » ; essai.appuyer(accel) fait le raccourci. */
const essai = ESSAI ? {
  selection: '', collages: [], touches: [], pris: [], raccourcis: new Map(),
  clip: {
    seq: 1, data: {},
    availableFormats() { return Object.keys(this.data).map(k => ({ text: 'text/plain', html: 'text/html', rtf: 'text/rtf' }[k])); },
    readText() { return this.data.text || ''; }, readHTML() { return this.data.html || ''; }, readRTF() { return this.data.rtf || ''; },
    readImage() { return nativeImage.createEmpty(); },
    writeText(t) { this.data = { text: String(t) }; this.seq++; },
    write(d) { this.data = {}; for (const k of ['text', 'html', 'rtf']) if (d[k]) this.data[k] = String(d[k]); this.seq++; },
    clear() { this.data = {}; this.seq++; },
  },
  key(what) {
    this.touches.push(what);
    if (what === 'paste') this.collages.push(this.clip.readText());
    if (what === 'copy' && this.selection) { const s = this.selection; setTimeout(() => this.clip.writeText(s), 30); }
    return true;
  },
  appuyer(acc) { const fn = this.raccourcis.get(acc); if (fn) fn(); return !!fn; },
} : null;
if (ESSAI) global.verbeEssai = essai;
const clip = ESSAI ? essai.clip : clipboard;
/* raccourcis globaux : ceux de Windows, ou les faux du mode test */
const hotkeys = ESSAI ? {
  register(acc, fn) { if (essai.pris.includes(acc) || essai.raccourcis.has(acc)) return false; essai.raccourcis.set(acc, fn); return true; },
  unregister(acc) { essai.raccourcis.delete(acc); },
  unregisterAll() { essai.raccourcis.clear(); },
} : globalShortcut;

/* ---------- Presse-papiers : rendu après un collage automatique ----------
   Verbe écrit le texte dicté dans le presse-papiers pour le coller ; une seconde après,
   il remet ce qui s'y trouvait avant (texte, mise en forme ou image), sauf si quelqu'un
   a copié autre chose entre-temps. */
let savedClip = null, pendingClip = null;
function saveClipboard() {
  /* un collage de moins d'une seconde n'a pas encore rendu le presse-papiers (Recoller juste après une
     dictée) : on reprend ce qu'il gardait, sinon on rendrait le texte dicté au lieu de ce que tu avais copié */
  if (pendingClip) {
    const p = pendingClip; pendingClip = null; clearTimeout(p.timer);
    if (clip.readText() === p.ours) { savedClip = p.prev; return; }
  }
  const f = clip.availableFormats();
  /* des fichiers copiés (explorateur) ne se remettent pas fidèlement : on n'y touche pas */
  if (f.some(x => /FileName|FileGroupDescriptor|HDROP|uri-list/i.test(x))) { savedClip = null; return; }
  const img = clip.readImage();
  savedClip = { text: clip.readText(), html: clip.readHTML(), rtf: clip.readRTF(), image: img.isEmpty() ? undefined : img };
}
function restoreClipboard(ours) {
  const prev = savedClip; savedClip = null;
  if (!prev) return;
  pendingClip = { prev, ours, timer: setTimeout(() => {
    pendingClip = null;
    if (clip.readText() !== ours) return; /* autre chose a été copié depuis : on le laisse */
    const data = {};
    for (const k of ['text', 'html', 'rtf']) if (prev[k]) data[k] = prev[k];
    if (prev.image) data.image = prev.image;
    if (Object.keys(data).length) clip.write(data); else clip.clear();
  }, 1000) };
}
/* Réécrire abandonné (rien de sélectionné, Échap, erreur) : le presse-papiers revient tout de suite,
   sauf si quelqu'un a copié autre chose entre-temps */
function giveBackClipboard(ours) {
  const prev = savedClip; savedClip = null;
  if (!prev || clip.readText() !== ours) return;
  const data = {};
  for (const k of ['text', 'html', 'rtf']) if (prev[k]) data[k] = prev[k];
  if (prev.image) data.image = prev.image;
  if (Object.keys(data).length) clip.write(data); else clip.clear();
}

/* ---------- Fenêtres ---------- */
const prefs = extra => Object.assign({ preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }, extra);

function createMain() {
  main = new BrowserWindow({
    width: 1240, height: 860, minWidth: 380, minHeight: 560, show: false, title: 'Verbe',
    backgroundColor: '#FAF7F3', icon: ICON, autoHideMenuBar: true, webPreferences: prefs(),
  });
  main.removeMenu();
  charger(main);
  main.on('close', e => { if (!quitting) { e.preventDefault(); main.hide(); } });
  main.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  main.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); } });
  if (!HIDDEN_START) main.once('ready-to-show', () => main.show());
}

function createBubble() {
  bubble = new BrowserWindow({
    width: BUBBLE_W, height: BUBBLE_H, show: false, frame: false, transparent: true, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, focusable: false, hasShadow: false,
    alwaysOnTop: true, backgroundColor: '#00000000', title: 'Verbe — bulle',
    webPreferences: prefs({ backgroundThrottling: false }),
  });
  bubble.setAlwaysOnTop(true, 'screen-saver');
  bubble.setVisibleOnAllWorkspaces(true);
  bubble.setIgnoreMouseEvents(true, { forward: true });
  charger(bubble, { bulle: '1' });
}

function placeBubble(pos) {
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const x = Math.round(d.x + (d.width - BUBBLE_W) / 2);
  const y = pos === 'top' ? d.y + 24 : pos === 'bottom' ? d.y + d.height - BUBBLE_H : Math.round(d.y + (d.height - BUBBLE_H) / 2);
  bubble.setBounds({ x, y, width: BUBBLE_W, height: BUBBLE_H });
}

function showMain(hash) {
  if (!main) return;
  if (hash) main.webContents.send('verbe:route', hash);
  if (main.isMinimized()) main.restore();
  main.show(); main.focus();
}

/* ---------- Raccourcis ---------- */
/* au début d'une dictée, la bulle reçoit aussi le nom de l'app où tu écris (ton selon l'app) */
function toggleDictation() { bubble?.webContents.send('verbe:toggle', { app: bubbleState === 'idle' ? global.verbeForegroundApp() : '' }); }
function setShortcut(next) {
  if (accel) { try { hotkeys.unregister(accel); } catch (e) { /* déjà libre */ } }
  accel = null;
  try { if (hotkeys.register(next, toggleDictation)) { accel = next; updateTray(); return true; } } catch (e) { /* format refusé */ }
  updateTray();
  return false;
}
/* Échap n'est pris à Windows que pendant l'écoute */
function syncEscape() {
  const want = bubbleState === 'recording' || bubbleState === 'starting';
  if (want && !escOn) escOn = hotkeys.register('Escape', () => bubble?.webContents.send('verbe:cancel'));
  if (!want && escOn) { hotkeys.unregister('Escape'); escOn = false; }
}
/* Recoller la dernière dictée et Réécrire la sélection (Réglages › Raccourci), éteints tant que
   la personne ne les allume pas. On attend qu'elle relâche les touches avant d'agir. */
const actions = { repaste: null, rewrite: null };
function setAction(name, next) {
  if (!Object.prototype.hasOwnProperty.call(actions, name)) return false;
  if (actions[name]) { try { hotkeys.unregister(actions[name]); } catch (e) { /* déjà libre */ } }
  actions[name] = null;
  if (!next) return true;
  if (next === accel || Object.values(actions).includes(next)) return false; /* déjà pris par Verbe */
  try {
    if (hotkeys.register(next, async () => { await keysUp(next); bubble?.webContents.send('verbe:' + name); })) { actions[name] = next; return true; }
  } catch (e) { /* format refusé */ }
  return false;
}

/* ---------- Icône près de l'horloge ---------- */
function prettyAccel() { return (accel || '').replace('Control', 'Ctrl').replace('Shift', 'Maj').replace(/\+/g, ' + '); }
function updateTray() {
  if (!tray) return;
  tray.setToolTip(accel ? `Verbe — ${prettyAccel()} pour dicter` : 'Verbe');
  tray.setContextMenu(trayMenu = Menu.buildFromTemplate([
    { label: accel ? `Dicter    ${prettyAccel()}` : 'Dicter', click: toggleDictation },
    { label: 'Ouvrir Verbe', click: () => showMain() },
    { label: 'Historique', click: () => showMain('#historique') },
    { label: 'Réglages', click: () => showMain('#reglages') },
    ...updateMenu(),
    { type: 'separator' },
    { label: 'Quitter Verbe', click: () => { quitting = true; app.quit(); } },
  ]));
}
function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.on('click', () => showMain());
  updateTray();
}

/* ---------- Messages de la page ---------- */
const others = sender => [main, bubble].filter(w => w && !w.isDestroyed() && w.webContents !== sender);
ipcMain.on('verbe:toggle', toggleDictation);
ipcMain.on('verbe:cancel', () => bubble?.webContents.send('verbe:cancel'));
ipcMain.on('verbe:levels', (e, d) => { if (main && !main.isDestroyed() && main.isVisible()) main.webContents.send('verbe:levels', d); });
ipcMain.on('verbe:state', (e, s) => { bubbleState = s; syncEscape(); main?.webContents.send('verbe:state', s); });
ipcMain.on('verbe:notify', (e, kind) => { if (kind === 'history' || kind === 'settings') for (const w of others(e.sender)) w.webContents.send('verbe:' + kind); });
let placedPos = null;
ipcMain.on('verbe:bubble', (e, v) => {
  if (!bubble) return;
  if (v) {
    const pos = ['center', 'top', 'bottom'].includes(v) ? v : 'center';
    /* placée à chaque apparition (l'écran du curseur a pu changer), et déplacée
       tout de suite si on change la position pendant qu'elle est visible */
    if (!bubble.isVisible() || pos !== placedPos) { placeBubble(pos); placedPos = pos; }
    if (!bubble.isVisible()) { bubble.setIgnoreMouseEvents(true, { forward: true }); bubble.showInactive(); }
    bubble.setAlwaysOnTop(true, 'screen-saver');
  } else bubble.hide();
});
ipcMain.on('verbe:preview', () => bubble?.webContents.send('verbe:preview'));
ipcMain.on('verbe:mouse', (e, inside) => bubble?.setIgnoreMouseEvents(!inside, { forward: true }));
ipcMain.on('verbe:open-main', (e, hash) => showMain(hash));
ipcMain.handle('verbe:copy', (e, text) => { saveClipboard(); clip.writeText(text); return true; });
ipcMain.handle('verbe:paste', async (e, opts) => {
  await new Promise(r => setTimeout(r, 40));
  const ok = sendPaste();
  /* par défaut la dictée reste dans le presse-papiers (Ctrl + V la recolle ailleurs) ;
     sinon, une seconde après, ce que tu avais copié revient */
  if (ok && !(opts && opts.keep)) restoreClipboard(clip.readText());
  else savedClip = null;
  return ok;
});
ipcMain.handle('verbe:shortcut', (e, a) => setShortcut(a));
ipcMain.handle('verbe:action-shortcut', (e, name, a) => setAction(String(name), String(a || '')));
/* Réécrire : Ctrl+C dans l'app active, puis on attend que le presse-papiers change (0,7 s au plus).
   Ce qu'il y avait avant est gardé, et rendu après le collage (ou tout de suite si on abandonne). */
ipcMain.handle('verbe:grab', async () => {
  saveClipboard();
  const before = clipSeq();
  if (!sendCopy()) { savedClip = null; return { ok: false, text: '' }; }
  let text = '';
  for (const t0 = Date.now(); Date.now() - t0 < 700;) {
    await new Promise(r => setTimeout(r, 25));
    if (clipSeq() !== before && (text = clip.readText())) break;
  }
  if (!text.trim()) { if (clipSeq() !== before) giveBackClipboard(clip.readText()); else savedClip = null; text = ''; }
  return { ok: true, text };
});
ipcMain.handle('verbe:give-back', (e, ours) => { giveBackClipboard(String(ours)); return true; });
/* Réécrire : la nouvelle version remplace la sélection, puis le presse-papiers d'avant revient */
ipcMain.handle('verbe:paste-text', async (e, text) => {
  clip.writeText(String(text));
  await new Promise(r => setTimeout(r, 40));
  const ok = sendPaste();
  if (ok) restoreClipboard(String(text));
  return ok;
});
const loginOpts = () => ({ path: process.execPath, args: app.isPackaged ? ['--cache'] : [ROOT, '--cache'] });
ipcMain.handle('verbe:login-get', () => app.getLoginItemSettings(loginOpts()).openAtLogin);
ipcMain.handle('verbe:login-set', (e, on) => { app.setLoginItemSettings(Object.assign({ openAtLogin: on }, loginOpts())); return app.getLoginItemSettings(loginOpts()).openAtLogin; });

/* ---------- Mises à jour automatiques (electron-updater) ----------
   - source : les versions GitHub de landry160/verbe (latest.yml + Verbe-Setup.exe, voir README) ;
   - vérification quelques secondes après le démarrage, puis toutes les 6 h, si l'interrupteur
     de Réglages › Général est actif (la page nous le dit) ; « Vérifier maintenant » marche toujours ;
   - téléchargement en arrière-plan, installation quand on quitte Verbe, ou tout de suite
     avec « Redémarrer maintenant » (Réglages › Général et menu de l'icône) ;
   - jamais dans la version de développement (app.isPackaged faux), sauf en mode test :
     --maj-test=<url> lit le latest.yml d'un serveur local (fournisseur « generic »). En mode test,
     rien ne s'installe jamais : ni à la fermeture, ni avec « Redémarrer maintenant » (simple compteur).
   L'app n'est pas signée : app-update.yml n'a donc pas de « publisherName », et electron-updater
   saute la vérification de signature du nouvel installateur (il garde celle du sha512 de latest.yml). */
const MAJ_TEST = (process.argv.find(a => a.startsWith('--maj-test=')) || '').slice('--maj-test='.length);
const MAJ_DELAI = MAJ_TEST ? 300 : 8000; /* premier coup d'œil après le démarrage */
const MAJ_PERIODE = 6 * 60 * 60 * 1000;
let updater = null, trayMenu = null, majAuto = null, majPret = false;
let maj = { etat: app.isPackaged || MAJ_TEST ? 'idle' : 'dev', version: '', pourcent: 0, courante: app.getVersion() };
const majTest = { installations: 0, etats: [] }; /* pour les tests */
function setMaj(next) {
  maj = Object.assign({}, maj, next);
  if (MAJ_TEST) majTest.etats.push(maj.etat);
  if (main && !main.isDestroyed()) main.webContents.send('verbe:update', Object.assign({ auto: majAuto }, maj));
  if (next.etat) updateTray();
}
function getUpdater() {
  if (updater || maj.etat === 'dev') return updater;
  const { autoUpdater } = require('electron-updater');
  updater = autoUpdater;
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = !MAJ_TEST;
  updater.disableWebInstaller = true; /* un installateur complet, pas d'installateur web */
  if (MAJ_TEST) {
    /* le serveur local, et le cache du téléchargement dans le profil de test (jamais dans %LOCALAPPDATA%) */
    const dossier = app.getPath('userData');
    const config = path.join(dossier, 'maj-test.yml');
    require('fs').writeFileSync(config, `provider: generic\nurl: ${JSON.stringify(MAJ_TEST)}\nupdaterCacheDirName: maj-cache\n`);
    updater.updateConfigPath = config;
    updater.forceDevUpdateConfig = true;
    updater.disableDifferentialDownload = true;
    Object.defineProperty(updater.app, 'baseCachePath', { get: () => dossier });
  }
  updater.on('checking-for-update', () => setMaj({ etat: 'checking' }));
  updater.on('update-not-available', () => setMaj({ etat: 'uptodate', version: '' }));
  updater.on('update-available', info => setMaj({ etat: 'downloading', version: info.version, pourcent: 0 }));
  updater.on('download-progress', p => setMaj({ pourcent: Math.round(p.percent || 0) }));
  updater.on('update-downloaded', info => setMaj({ etat: 'ready', version: info.version }));
  updater.on('error', () => { if (maj.etat !== 'ready') setMaj({ etat: 'error' }); });
  return updater;
}
function checkUpdates() {
  const u = getUpdater();
  if (!u || ['checking', 'downloading', 'ready'].includes(maj.etat)) return;
  setMaj({ etat: 'checking' });
  u.checkForUpdates().catch(() => { if (maj.etat !== 'ready') setMaj({ etat: 'error' }); });
}
function installUpdate() {
  if (maj.etat !== 'ready') return;
  if (MAJ_TEST) { majTest.installations++; return; }
  quitting = true;
  annoncerInstallation(true);
  updater.quitAndInstall(true, true); /* installation silencieuse, puis Verbe se relance */
}
/* L'installation ne montre rien pendant 10 à 20 s : sans ce message, on relance Verbe, l'installateur le
   referme pour remplacer ses fichiers, et il faut s'y reprendre à plusieurs fois (vu le 24 nov.). */
let annonce = false;
function annoncerInstallation(relance) {
  if (annonce || MAJ_TEST || !Notification.isSupported()) return;
  annonce = true;
  new Notification({
    title: `Mise à jour de Verbe ${maj.version}`,
    body: relance ? 'Installation en cours : Verbe se rouvre tout seul dans quelques secondes. Pas besoin de le relancer.'
      : 'Installation en cours (environ 15 s). Attends un peu avant de rouvrir Verbe.',
    icon: ICON, silent: true,
  }).show();
}
function updateMenu() {
  return maj.etat === 'ready' ? [{ type: 'separator' }, { label: `Redémarrer maintenant (version ${maj.version})`, click: installUpdate }] : [];
}
function startUpdates() {
  if (maj.etat === 'dev') return;
  setTimeout(() => { majPret = true; if (majAuto) checkUpdates(); }, MAJ_DELAI);
  setInterval(() => { if (majAuto) checkUpdates(); }, MAJ_PERIODE);
}
ipcMain.handle('verbe:update-get', () => Object.assign({ auto: majAuto }, maj));
ipcMain.handle('verbe:update-auto', (e, on) => {
  majAuto = !!on;
  if (maj.etat === 'idle' || maj.etat === 'off') setMaj({ etat: majAuto ? 'idle' : 'off' });
  if (majAuto && majPret && maj.etat === 'idle') checkUpdates();
  return Object.assign({ auto: majAuto }, maj);
});
ipcMain.handle('verbe:update-check', () => { checkUpdates(); return Object.assign({ auto: majAuto }, maj); });
ipcMain.on('verbe:update-install', installUpdate);
global.verbeMaj = { /* pour les tests */
  etat: () => Object.assign({ auto: majAuto, charge: !!updater }, maj, majTest),
  menu: () => (trayMenu ? trayMenu.items.map(i => i.label).filter(Boolean) : []),
  cliquer: label => trayMenu?.items.find(i => i.label.startsWith(label))?.click(),
};

/* ---------- Démarrage ---------- */
app.on('second-instance', () => showMain());
app.whenReady().then(() => {
  /* en mode test, la page n'a pas accès au vrai presse-papiers non plus */
  const allow = ['media', 'clipboard-sanitized-write', 'clipboard-read', 'audioCapture'].filter(p => !ESSAI || !/clipboard/.test(p));
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(allow.includes(perm)));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => allow.includes(perm));
  /* Les services envoient « ce qu'il reste » dans leurs réponses, mais ne le
     laissent pas lire par une page : l'app le rend lisible à Verbe. */
  const EXPOSE = 'x-ratelimit-limit-requests, x-ratelimit-remaining-requests, x-ratelimit-reset-requests, x-ratelimit-limit-tokens, x-ratelimit-remaining-tokens, x-ratelimit-reset-tokens, retry-after, x-request-id';
  session.defaultSession.webRequest.onHeadersReceived({ urls: ['https://api.groq.com/*', 'https://api.openai.com/*', 'https://api.mistral.ai/*'] }, (d, cb) => {
    const h = Object.assign({}, d.responseHeaders);
    for (const k of Object.keys(h)) if (k.toLowerCase() === 'access-control-expose-headers') delete h[k];
    h['Access-Control-Expose-Headers'] = [EXPOSE];
    cb({ responseHeaders: h });
  });
  loadKeyboard();
  createBubble();
  createMain();
  createTray();
  startUpdates();
  /* si la page n'a pas encore donné son raccourci, on prend celui par défaut */
  setTimeout(() => { if (!accel) setShortcut('Control+Shift+L'); }, 4000);
});
app.on('window-all-closed', e => e.preventDefault());
app.on('before-quit', () => { quitting = true; if (maj.etat === 'ready' && updater && !MAJ_TEST) annoncerInstallation(false); });
app.on('will-quit', () => { hotkeys.unregisterAll(); });
