/* Storage: songs in IndexedDB, settings in localStorage. Errors are reported to the user, never swallowed. */
(function () {
  'use strict';
  const W = window.Wapiro;
  const S = (W.storage = {});
  const DB_NAME = 'marksteady_wapiro_v2', STORE = 'songs', SETTINGS_KEY = 'marksteady_wapiro_v2_settings';
  let db = null;
  const pending = [];
  S.available = true;
  W.notify = W.notify || function (msg, kind) { pending.push([msg, kind]); };
  W._pendingNotes = pending;

  /** In-memory library: the single source of truth while the app runs; IndexedDB is written behind it. */
  S.records = []; // { id, order, best, prefs, song }

  function fail(what, err) {
    S.lastError = what + ': ' + ((err && err.message) || err || 'unknown error');
    W.notify(what + ' (' + ((err && err.message) || 'unknown error') + ').', 'error');
  }

  S.open = function () {
    return new Promise((resolve) => {
      if (!window.indexedDB) { S.available = false; W.notify('This browser cannot store songs. Songs you add will be lost when you close the page.', 'error'); resolve(); return; }
      let req;
      try { req = indexedDB.open(DB_NAME, 1); } catch (e) { S.available = false; fail('Songs cannot be stored in this browser', e); resolve(); return; }
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'id' }); };
      req.onsuccess = () => { db = req.result; db.onversionchange = () => db.close(); resolve(); };
      req.onerror = () => { S.available = false; fail('Songs cannot be stored in this browser', req.error); resolve(); };
      req.onblocked = () => { S.available = false; fail('Storage is blocked by another tab', null); resolve(); };
    });
  };

  S.loadAll = function () {
    return new Promise((resolve) => {
      if (!db) { resolve([]); return; }
      try {
        const r = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
        r.onsuccess = () => resolve(r.result || []);
        r.onerror = () => { fail('Could not read your songs', r.error); resolve([]); };
      } catch (e) { fail('Could not read your songs', e); resolve([]); }
    });
  };

  S.writeRecord = function (rec) {
    return new Promise((resolve) => {
      if (!db) { resolve(false); return; }
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(rec);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => { fail('Could not save "' + (rec.song && rec.song.title) + '"', tx.error); resolve(false); };
        tx.onabort = () => { fail('Could not save "' + (rec.song && rec.song.title) + '"', tx.error); resolve(false); };
      } catch (e) { fail('Could not save "' + (rec.song && rec.song.title) + '"', e); resolve(false); }
    });
  };
  S.removeRecord = function (id) {
    return new Promise((resolve) => {
      if (!db) { resolve(false); return; }
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => { fail('Could not delete the song', tx.error); resolve(false); };
      } catch (e) { fail('Could not delete the song', e); resolve(false); }
    });
  };
  S.clearAll = function () {
    return new Promise((resolve) => {
      S.records = [];
      try { localStorage.removeItem(SETTINGS_KEY); } catch (e) { fail('Could not clear settings', e); }
      if (!db) { resolve(); return; }
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => { fail('Could not clear stored songs', tx.error); resolve(); };
      } catch (e) { fail('Could not clear stored songs', e); resolve(); }
    });
  };

  // ---- library operations (memory first, then IndexedDB)
  S.find = (id) => S.records.find((r) => r.id === id) || null;
  S.newId = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  S.add = function (song) {
    if (!song.id) song.id = S.newId();
    const order = S.records.reduce((m, r) => Math.max(m, r.order), 0) + 1;
    const rec = { id: song.id, order, best: null, prefs: null, song };
    S.records.push(rec);
    return S.writeRecord(rec).then(() => rec);
  };
  const timers = new Map();
  /** Save a record after a short delay (used for edits and per-song preferences). */
  S.saveSoon = function (id, ms) {
    clearTimeout(timers.get(id));
    timers.set(id, setTimeout(() => { timers.delete(id); const r = S.find(id); if (r) S.writeRecord(r); }, ms == null ? 400 : ms));
  };
  S.flush = function () { for (const [id, t] of timers) { clearTimeout(t); timers.delete(id); const r = S.find(id); if (r) S.writeRecord(r); } };
  S.remove = function (id) {
    S.records = S.records.filter((r) => r.id !== id);
    return S.removeRecord(id);
  };
  S.setBest = function (id, pct) {
    const r = S.find(id);
    if (!r) return false;
    if (r.best == null || pct > r.best) { r.best = pct; S.writeRecord(r); return true; }
    return false;
  };

  // ---- settings
  S.defaults = {
    v: 3, appearance: 'auto', view: 'split', split: 0.5, volume: 0.7, accVolume: 0.7, metroVolume: 0.7, mute: false, userSound: true, midiMute: false, instrument: 'piano', layer: null,
    kbdNotes: false, kbdBinds: null, wait: true, hands: 'both', mode: 'practice', playAlong: true, metronome: false, countIn: null, restartAfter: 0,
    handL: null, handR: null, lookBars: 4, staffSize: 12, showAll: false, keyW: null, keysH: 120, lastSong: null,
  };
  S.settings = Object.assign({}, S.defaults);
  S.loadSettings = function () {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const o = JSON.parse(raw);
        if (o && typeof o === 'object') {
          // version 3 layout: system appearance, Split view, both hands and play-along by default
          if (!(o.v >= 3)) { o.v = 3; o.appearance = 'auto'; o.view = 'split'; o.hands = 'both'; o.playAlong = true; o.mode = 'practice'; o.lookBars = 4; }
          S.settings = Object.assign({}, S.defaults, o);
        }
      }
    } catch (e) { fail('Could not read your settings', e); }
    return S.settings;
  };
  let settingsTimer = null;
  S.saveSettings = function () {
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(S.saveSettingsNow, 150);
  };
  S.saveSettingsNow = function () {
    clearTimeout(settingsTimer);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(S.settings)); } catch (e) { fail('Could not save your settings', e); }
  };
})();
