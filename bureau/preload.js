// Pont entre la page Verbe et l'app bureau : la page ne voit que ces fonctions.
const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = ['toggle', 'cancel', 'state', 'history', 'settings', 'route', 'preview', 'repaste', 'rewrite', 'levels'];

contextBridge.exposeInMainWorld('verbeDesktop', {
  toggle: () => ipcRenderer.send('verbe:toggle'),
  cancel: () => ipcRenderer.send('verbe:cancel'),
  state: s => ipcRenderer.send('verbe:state', String(s)),
  /* la voix de la bulle, pour la pastille de la fenêtre principale : { bands, level } */
  levels: d => ipcRenderer.send('verbe:levels', d),
  notify: kind => ipcRenderer.send('verbe:notify', String(kind)),
  /* la position voyage avec la demande (« center », « top », « bottom ») ; false cache la bulle */
  bubble: pos => ipcRenderer.send('verbe:bubble', pos ? String(pos) : false),
  preview: () => ipcRenderer.send('verbe:preview'),
  /* où est la pastille dans la bulle ({ x, y, w, h }, ou null) : l'app ne laisse passer les clics que là */
  pill: r => ipcRenderer.send('verbe:pill', r ? { x: +r.x, y: +r.y, w: +r.w, h: +r.h } : null),
  openMain: hash => ipcRenderer.send('verbe:open-main', String(hash || '')),
  copy: text => ipcRenderer.invoke('verbe:copy', String(text)),
  paste: opts => ipcRenderer.invoke('verbe:paste', opts || {}),
  setShortcut: accel => ipcRenderer.invoke('verbe:shortcut', String(accel)),
  /* Recoller et Réécrire : name = « repaste » ou « rewrite » ; accel vide = éteint */
  setAction: (name, accel) => ipcRenderer.invoke('verbe:action-shortcut', String(name), String(accel || '')),
  grab: () => ipcRenderer.invoke('verbe:grab'),
  giveBack: ours => ipcRenderer.invoke('verbe:give-back', String(ours || '')),
  pasteText: text => ipcRenderer.invoke('verbe:paste-text', String(text)),
  getLogin: () => ipcRenderer.invoke('verbe:login-get'),
  setLogin: on => ipcRenderer.invoke('verbe:login-set', !!on),
  /* mises à jour automatiques : état ({ etat, version, pourcent, courante, auto }), interrupteur, vérifier, redémarrer */
  getUpdate: () => ipcRenderer.invoke('verbe:update-get'),
  setAutoUpdate: on => ipcRenderer.invoke('verbe:update-auto', !!on),
  checkUpdate: () => ipcRenderer.invoke('verbe:update-check'),
  installUpdate: () => ipcRenderer.send('verbe:update-install'),
  onUpdate: fn => ipcRenderer.on('verbe:update', (_e, data) => fn(data)),
  on: (channel, fn) => {
    if (!CHANNELS.includes(channel)) return;
    ipcRenderer.on('verbe:' + channel, (_e, data) => fn(data));
  },
});
