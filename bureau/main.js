// Verbe, version bureau (Windows).
// - un raccourci global (Ctrl + Maj + L par défaut) marche dans toutes les apps ;
// - une bulle ronde, sans cadre, toujours au-dessus, qui ne prend jamais le focus ;
// - le texte est copié puis collé tout seul là où on écrivait ;
// - la fenêtre principale (Dicter, Historique, Réglages) se range près de l'horloge.
const { app, BrowserWindow, globalShortcut, ipcMain, clipboard, screen, Tray, Menu, nativeImage, session, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PAGE = path.join(ROOT, 'app', 'verbe.html');
const ICON = path.join(__dirname, 'icone.png');
const HIDDEN_START = process.argv.includes('--cache');
/* fenêtre transparente un peu plus grande que la pastille (440 × 92 au plus), pour son ombre */
const BUBBLE_W = 480, BUBBLE_H = 150;

/* tests : un profil à part (--profil=dossier) pour ne jamais toucher les vrais réglages */
const profil = process.argv.find(a => a.startsWith('--profil='));
if (profil) app.setPath('userData', profil.slice('--profil='.length));
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.setAppUserModelId('Verbe');
/* la bulle démarre le son et le micro sans clic : pas de blocage « autoplay » */
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let main = null, bubble = null, tray = null, quitting = false;
let accel = null, bubbleState = 'idle', escOn = false;

/* ---------- Collage : un petit PowerShell resté ouvert, qui tape Ctrl+V ---------- */
let keyer = null;
function startKeyer() {
  if (process.platform !== 'win32') return;
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "Add-Type -Namespace Verbe -Name Keys -MemberDefinition '[DllImport(\"user32.dll\")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra);'",
    'while ($true) {',
    '  $l = [Console]::In.ReadLine()',
    '  if ($l -eq $null) { break }',
    "  if ($l -eq 'paste') {",
    // Maj encore enfoncée ferait Ctrl+Maj+V : on la relâche d'abord
    '    [Verbe.Keys]::keybd_event(0x10, 0, 2, [System.UIntPtr]::Zero)',
    '    [Verbe.Keys]::keybd_event(0x11, 0, 0, [System.UIntPtr]::Zero)',
    '    [Verbe.Keys]::keybd_event(0x56, 0, 0, [System.UIntPtr]::Zero)',
    '    [Verbe.Keys]::keybd_event(0x56, 0, 2, [System.UIntPtr]::Zero)',
    '    [Verbe.Keys]::keybd_event(0x11, 0, 2, [System.UIntPtr]::Zero)',
    "    [Console]::Out.WriteLine('ok')",
    '  }',
    // vérification sans rien taper : prouve que le module clavier est chargé
    "  if ($l -eq 'ping') { if ('Verbe.Keys' -as [type]) { [Console]::Out.WriteLine('pong') } else { [Console]::Out.WriteLine('nokeys') } }",
    '}',
  ].join('\n');
  /* le script passe en -EncodedCommand : l'entrée standard reste libre pour nos ordres */
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  keyer = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  keyer.on('exit', () => { keyer = null; if (!quitting) setTimeout(startKeyer, 1000); });
}
function sendPaste() {
  return new Promise(resolve => {
    if (!keyer) return resolve(false);
    const t = setTimeout(() => { keyer?.stdout.off('data', onData); resolve(false); }, 1500);
    const onData = d => { if (String(d).includes('ok')) { clearTimeout(t); keyer.stdout.off('data', onData); resolve(true); } };
    keyer.stdout.on('data', onData);
    keyer.stdin.write('paste\n');
  });
}

function pingKeyer() {
  return new Promise(resolve => {
    if (!keyer) return resolve('absent');
    const t = setTimeout(() => { keyer?.stdout.off('data', onData); resolve('muet'); }, 8000);
    const onData = d => { const s = String(d); if (/pong|nokeys/.test(s)) { clearTimeout(t); keyer.stdout.off('data', onData); resolve(s.trim()); } };
    keyer.stdout.on('data', onData);
    keyer.stdin.write('ping\n');
  });
}
global.verbePingKeyer = pingKeyer; /* pour les tests */

/* ---------- Fenêtres ---------- */
const prefs = extra => Object.assign({ preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }, extra);

function createMain() {
  main = new BrowserWindow({
    width: 1240, height: 860, minWidth: 380, minHeight: 560, show: false, title: 'Verbe',
    backgroundColor: '#FAF7F3', icon: ICON, autoHideMenuBar: true, webPreferences: prefs(),
  });
  main.removeMenu();
  main.loadFile(PAGE);
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
  bubble.loadFile(PAGE, { query: { bulle: '1' } });
}

function placeBubble(pos) {
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const x = Math.round(d.x + (d.width - BUBBLE_W) / 2);
  const y = pos === 'top' ? d.y + 24 : pos === 'bottom' ? d.y + d.height - BUBBLE_H - 12 : Math.round(d.y + (d.height - BUBBLE_H) / 2);
  bubble.setBounds({ x, y, width: BUBBLE_W, height: BUBBLE_H });
}

function showMain(hash) {
  if (!main) return;
  if (hash) main.webContents.send('verbe:route', hash);
  if (main.isMinimized()) main.restore();
  main.show(); main.focus();
}

/* ---------- Raccourcis ---------- */
function toggleDictation() { bubble?.webContents.send('verbe:toggle'); }
function setShortcut(next) {
  if (accel) { try { globalShortcut.unregister(accel); } catch (e) { /* déjà libre */ } }
  accel = null;
  try { if (globalShortcut.register(next, toggleDictation)) { accel = next; updateTray(); return true; } } catch (e) { /* format refusé */ }
  updateTray();
  return false;
}
/* Échap n'est pris à Windows que pendant l'écoute */
function syncEscape() {
  const want = bubbleState === 'recording' || bubbleState === 'starting';
  if (want && !escOn) escOn = globalShortcut.register('Escape', () => bubble?.webContents.send('verbe:cancel'));
  if (!want && escOn) { globalShortcut.unregister('Escape'); escOn = false; }
}

/* ---------- Icône près de l'horloge ---------- */
function prettyAccel() { return (accel || '').replace('Control', 'Ctrl').replace('Shift', 'Maj').replace(/\+/g, ' + '); }
function updateTray() {
  if (!tray) return;
  tray.setToolTip(accel ? `Verbe — ${prettyAccel()} pour dicter` : 'Verbe');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: accel ? `Dicter    ${prettyAccel()}` : 'Dicter', click: toggleDictation },
    { label: 'Ouvrir Verbe', click: () => showMain() },
    { label: 'Historique', click: () => showMain('#historique') },
    { label: 'Réglages', click: () => showMain('#reglages') },
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
ipcMain.handle('verbe:copy', (e, text) => { clipboard.writeText(text); return true; });
ipcMain.handle('verbe:paste', async () => { await new Promise(r => setTimeout(r, 40)); return sendPaste(); });
ipcMain.handle('verbe:shortcut', (e, a) => setShortcut(a));
const loginOpts = () => ({ path: process.execPath, args: app.isPackaged ? ['--cache'] : [ROOT, '--cache'] });
ipcMain.handle('verbe:login-get', () => app.getLoginItemSettings(loginOpts()).openAtLogin);
ipcMain.handle('verbe:login-set', (e, on) => { app.setLoginItemSettings(Object.assign({ openAtLogin: on }, loginOpts())); return app.getLoginItemSettings(loginOpts()).openAtLogin; });

/* ---------- Démarrage ---------- */
app.on('second-instance', () => showMain());
app.whenReady().then(() => {
  const allow = ['media', 'clipboard-sanitized-write', 'clipboard-read', 'audioCapture'];
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
  startKeyer();
  createBubble();
  createMain();
  createTray();
  /* si la page n'a pas encore donné son raccourci, on prend celui par défaut */
  setTimeout(() => { if (!accel) setShortcut('Control+Shift+L'); }, 4000);
});
app.on('window-all-closed', e => e.preventDefault());
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => { globalShortcut.unregisterAll(); try { keyer?.stdin.end(); keyer?.kill(); } catch (e) { /* fini */ } });
