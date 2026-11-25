/* ============================================================
   4. Historique (IndexedDB) — 100 dictées, audio des 30 dernières
   ============================================================ */
const MAX_ITEMS = 100, MAX_AUDIO = 30;
const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const txDone = t => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
const Store = {
  db: null, mem: null, memAudio: null, opening: null,
  /* une seule ouverture, même demandée deux fois en même temps (démarrage + première dictée) */
  open() {
    if (this.opening) return this.opening;
    return (this.opening = new Promise((res, rej) => {
      let req;
      try { req = indexedDB.open('verbe', 1); } catch (e) { rej(e); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio');
      };
      req.onsuccess = () => { this.db = req.result; res(); };
      req.onerror = () => rej(req.error);
      req.onblocked = () => rej(new Error('blocked'));
    }).catch(e => { this.opening = null; throw e; }));
  },
  /* une dictée peut finir avant que la base soit ouverte (premier démarrage lent) : on l'attend (v0.6.2) */
  async ready() { if (!this.db && !this.mem) await this.open(); },
  useMemory() { this.mem = new Map(); this.memAudio = new Map(); },
  async all() {
    await this.ready();
    if (this.mem) return [...this.mem.values()].sort((a, b) => b.createdAt - a.createdAt);
    const items = await reqP(this.db.transaction('items').objectStore('items').getAll());
    return items.sort((a, b) => b.createdAt - a.createdAt);
  },
  async put(item) {
    await this.ready();
    if (this.mem) { this.mem.set(item.id, { ...item }); return; }
    const t = this.db.transaction('items', 'readwrite'); t.objectStore('items').put(item); await txDone(t);
  },
  async putAudio(id, blob) {
    await this.ready();
    if (this.mem) { this.memAudio.set(id, blob); return; }
    const t = this.db.transaction('audio', 'readwrite'); t.objectStore('audio').put(blob, id); await txDone(t);
  },
  async getAudio(id) {
    await this.ready();
    if (this.mem) return this.memAudio.get(id) || null;
    return (await reqP(this.db.transaction('audio').objectStore('audio').get(id))) || null;
  },
  async delAudio(id) {
    await this.ready();
    if (this.mem) { this.memAudio.delete(id); return; }
    const t = this.db.transaction('audio', 'readwrite'); t.objectStore('audio').delete(id); await txDone(t);
  },
  async del(id) {
    await this.ready();
    if (this.mem) { this.mem.delete(id); this.memAudio.delete(id); return; }
    const t = this.db.transaction(['items', 'audio'], 'readwrite');
    t.objectStore('items').delete(id); t.objectStore('audio').delete(id); await txDone(t);
  },
  async clear() {
    await this.ready();
    if (this.mem) { this.mem.clear(); this.memAudio.clear(); return; }
    const t = this.db.transaction(['items', 'audio'], 'readwrite');
    t.objectStore('items').clear(); t.objectStore('audio').clear(); await txDone(t);
  },
};
