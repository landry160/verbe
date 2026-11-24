// Pont entre la page Verbe et l'app bureau : la page ne voit que ces fonctions.
const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = ['toggle', 'cancel', 'state', 'history', 'settings', 'route', 'preview', 'repaste', 'rewrite'];

contextBridge.exposeInMainWorld('verbeDesktop', {
  toggle: () => ipcRenderer.send('verbe:toggle'),
  cancel: () => ipcRenderer.send('verbe:cancel'),
  state: s => ipcRenderer.send('verbe:state', String(s)),
  notify: kind => ipcRenderer.send('verbe:notify', String(kind)),
  /* la position voyage avec la demande (« center », « top », « bottom ») ; false cache la bulle */
  bubble: pos => ipcRenderer.send('verbe:bubble', pos ? String(pos) : false),
  preview: () => ipcRenderer.send('verbe:preview'),
  mouse: inside => ipcRenderer.send('verbe:mouse', !!inside),
  openMain: hash => ipcRenderer.send('verbe:open-main', String(hash || '')),
  copy: text => ipcRenderer.invoke('verbe:copy', String(text)),
  paste: () => ipcRenderer.invoke('verbe:paste'),
  setShortcut: accel => ipcRenderer.invoke('verbe:shortcut', String(accel)),
  /* Recoller et Réécrire : name = « repaste » ou « rewrite » ; accel vide = éteint */
  setAction: (name, accel) => ipcRenderer.invoke('verbe:action-shortcut', String(name), String(accel || '')),
  grab: () => ipcRenderer.invoke('verbe:grab'),
  giveBack: ours => ipcRenderer.invoke('verbe:give-back', String(ours || '')),
  pasteText: text => ipcRenderer.invoke('verbe:paste-text', String(text)),
  getLogin: () => ipcRenderer.invoke('verbe:login-get'),
  setLogin: on => ipcRenderer.invoke('verbe:login-set', !!on),
  on: (channel, fn) => {
    if (!CHANNELS.includes(channel)) return;
    ipcRenderer.on('verbe:' + channel, (_e, data) => fn(data));
  },
});
