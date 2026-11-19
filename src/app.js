/* App wiring: start-up, opening and importing songs, appearance, per-song preferences, and the test hooks. */
(function () {
  'use strict';
  const W = window.Wapiro, E = W.engine, UI = W.ui, S = W.storage, A = W.audio, Sh = W.shell;
  const App = (W.app = {});
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  App.sourceLabel = (s) => (s.source === 'builtin' ? 'Built-in excerpt' : s.source === 'v1' ? 'From version 1' : s.source === 'pdf' ? (s.exactNotation ? 'From PDF' : 'From PDF, edited') : s.source === 'scan' ? (s.exactNotation ? 'From scan' : 'From scan, edited') : s.source === 'midi' ? 'MIDI' : s.source === 'recording' ? 'Recorded here' : s.exactNotation ? 'MusicXML' : 'MusicXML, edited');

  // ---------------------------------------------------------------- appearance
  const mqDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const mqContrast = window.matchMedia ? window.matchMedia('(prefers-contrast: more)') : null;
  App.resolveTheme = function (a) {
    if (a !== 'auto') return a;
    const dark = mqDark && mqDark.matches, hc = mqContrast && mqContrast.matches;
    return (dark ? 'dark' : 'light') + (hc ? '-hc' : '');
  };
  App.setAppearance = function (a) {
    if (!['auto', 'light', 'dark', 'light-hc', 'dark-hc'].includes(a)) return;
    S.settings.appearance = a;
    document.documentElement.setAttribute('data-theme', App.resolveTheme(a));
    S.saveSettings();
    if (Sh && Sh.themeChanged) Sh.themeChanged();
  };
  if (mqDark) mqDark.addEventListener('change', () => { if (S.settings.appearance === 'auto') App.setAppearance('auto'); });
  if (mqContrast) mqContrast.addEventListener('change', () => { if (S.settings.appearance === 'auto') App.setAppearance('auto'); });

  /** Hand colours: null keeps the appearance's own colour; a hex value replaces it in every appearance. */
  App.applyHandColours = function () {
    const st = S.settings, rs = document.documentElement.style, ok = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
    if (ok(st.handL)) rs.setProperty('--hand-left', st.handL); else rs.removeProperty('--hand-left');
    if (ok(st.handR)) rs.setProperty('--hand-right', st.handR); else rs.removeProperty('--hand-right');
    if (Sh && Sh.themeChanged && Sh.el.root) Sh.themeChanged();
  };
  App.setHandColour = function (hand, hex) { S.settings[hand === 'L' ? 'handL' : 'handR'] = hex || null; S.saveSettings(); App.applyHandColours(); };
  App.setView = function (v) {
    if (!['waterfall', 'sheet', 'split'].includes(v)) return;
    S.settings.view = v; S.saveSettings(); Sh.applyView();
  };
  App.relayoutKeyboard = () => Sh.relayoutKeyboard();
  App.togglePlay = function () { if (W.free.active || W.exporter.active) return; E.toggle(); }; // Freeplay has nothing to play; an export runs by itself
  App.toggleLoop = function () {
    if (E.opts.loop) E.setOptions({ loop: null });
    else { const cur = E.curMeasure(), last = E.get().measures.length; E.setOptions({ loop: { from: cur, to: Math.min(last, cur + 3) } }); }
  };

  // ---------------------------------------------------------------- songs
  App.openSong = function (id) {
    const rec = S.find(id);
    if (!rec) return false;
    const st = S.settings;
    const prefs = Object.assign({ wait: st.wait, hands: st.hands, speed: 1, loop: null, restartAfter: st.restartAfter, metronome: st.metronome, countIn: st.countIn, mode: 'practice', playAlong: st.playAlong !== false }, rec.prefs || {});
    E.load(rec.song, prefs);
    history.length = 0; future.length = 0;
    if (W.editor && W.editor.active) W.editor.stop();
    st.lastSong = id; S.saveSettings();
    return true;
  };

  // Persist options: global ones in settings, per-song ones with the song.
  E.on('change', () => {
    const o = E.opts, st = S.settings;
    st.wait = o.wait; st.metronome = o.metronome; st.countIn = o.countIn; st.restartAfter = o.restartAfter; st.mode = o.mode; st.hands = o.hands; st.playAlong = o.playAlong;
    if (E.song) { const rec = S.find(E.song.id); if (rec) { rec.prefs = { speed: o.speed, hands: o.hands, loop: o.loop }; S.saveSoon(rec.id, 600); } }
    S.saveSettings();
  });

  App.importBuffer = (name, buffer) => W.library.importBuffer(name, buffer, true);
  App.pickFile = () => W.library.pickAndImport();
  App.exportCurrentMidi = function () {
    if (!E.song) return;
    try {
      const bytes = W.core.exportMidi(E.song);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/midi' }));
      const a = UI.h('a', { href: url, download: E.song.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() + '.mid' });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) { UI.toast('Could not export MIDI: ' + e.message, 'error'); }
  };

  // ---------------------------------------------------------------- editing (Correct notes and the test hooks share this path)
  const history = [], future = [];
  const snapshot = () => JSON.stringify({ notes: E.song.notes, measures: E.song.measures, exact: E.song.exactNotation });
  function rebuildNotation(s) {
    const rec = S.find(s.id);
    s.notation = s.exactNotation && rec && rec.original ? JSON.parse(JSON.stringify(rec.original.notation)) : W.notation.fromNotes(s);
  }
  function restore(js) {
    const o = JSON.parse(js), s = E.song;
    s.notes = o.notes; s.measures = o.measures; s.exactNotation = o.exact;
    rebuildNotation(s);
    afterEdit();
  }
  function afterEdit() {
    E.reloadNotes();
    Sh.relayoutKeyboard(); Sh.layoutSheet();
    S.saveSoon(E.song.id, 400);
    if (W.editor) W.editor.refresh();
  }
  function ensureMeasures(s) {
    const end = s.notes.reduce((m, n) => Math.max(m, n.q + n.durQ), 0);
    const last = s.measures[s.measures.length - 1];
    if (end > last.q + last.lenQ + 1e-6) {
      const ts = s.timeSigs[s.timeSigs.length - 1];
      const extra = W.midi.buildMeasures([{ q: 0, num: ts.num, den: ts.den }], end - (last.q + last.lenQ));
      let q0 = last.q + last.lenQ;
      for (const m of extra) { s.measures.push({ q: W.util.round6(q0), lenQ: m.lenQ }); q0 += m.lenQ; }
    }
  }
  /** Apply an edit to the open song: snapshot for undo, keep the imported version for "Revert to imported", rebuild, autosave. */
  App.editCommit = function (fn) {
    const s = E.song;
    if (!s) return;
    const rec = S.find(s.id);
    if (rec && s.exactNotation && !rec.original) rec.original = JSON.parse(JSON.stringify({ notes: s.notes, measures: s.measures, notation: s.notation }));
    history.push(snapshot()); if (history.length > 100) history.shift(); future.length = 0;
    fn(s);
    s.notes = s.notes.filter((n) => n.durQ > 1e-6);
    W.util.sortNotes(s.notes);
    ensureMeasures(s);
    s.exactNotation = false;
    s.notation = W.notation.fromNotes(s);
    afterEdit();
  };
  App.addNote = function (n) {
    App.editCommit((s) => {
      const f = s.keySigs.length ? s.keySigs[0].fifths : s.estKey != null ? s.estKey : 0;
      const sp = W.util.spellInKey(n.midi, f);
      s.notes.push({ q: n.q, durQ: n.durQ, midi: n.midi, hand: n.hand === 'L' ? 'L' : 'R', spelled: W.util.spell(sp.letter, sp.alter, sp.oct) });
    });
  };
  App.canUndo = () => history.length > 0;
  App.canRedo = () => future.length > 0;
  App.undo = function () { if (!history.length) return; future.push(snapshot()); restore(history.pop()); };
  App.redo = function () { if (!future.length) return; history.push(snapshot()); restore(future.pop()); };
  App.revertToImported = function () {
    const s = E.song, rec = s && S.find(s.id);
    if (!rec || !rec.original) return;
    history.push(snapshot()); future.length = 0;
    const o = JSON.parse(JSON.stringify(rec.original));
    s.notes = o.notes; s.measures = o.measures; s.notation = o.notation; s.exactNotation = true;
    afterEdit();
    UI.toast('Back to the notes and notation from the file.');
  };

  App.deleteSong = async function (id) {
    const wasCurrent = E.song && E.song.id === id;
    await S.remove(id);
    if (wasCurrent) { const first = S.records.slice().sort((a, b) => a.order - b.order)[0]; if (first) App.openSong(first.id); }
  };

  // ---------------------------------------------------------------- start-up
  async function seedBuiltins() {
    for (const song of W.builtin.list()) await S.add(song);
  }
  function applySettings() {
    const st = S.settings;
    A.volume = st.volume; A.accVolume = st.accVolume; A.metroVolume = st.metroVolume == null ? 0.7 : st.metroVolume; A.mute = st.mute; A.instrument = st.instrument; A.layer = st.layer || null; if (A.setLowLatency) A.setLowLatency(!!st.lowLatency);
    document.documentElement.setAttribute('data-theme', App.resolveTheme(st.appearance));
    App.applyHandColours();
    W.waterfall.setLookBars(st.lookBars);
    Sh.el.zoom.setValue(st.lookBars);
    Sh.applyView();
  }

  async function start() {
    S.loadSettings();
    await S.open();
    const rows = await S.loadAll();
    S.records = rows.sort((a, b) => a.order - b.order);
    if (!S.records.length) await seedBuiltins();
    Sh.build(document.getElementById('app'));
    applySettings();
    await W.library.migrateV1();
    W.library.bindDrop(document.getElementById('app'));
    W.results.hint(Sh.el.stage);
    if (W.naudio) W.naudio.boot();
    W.input.init();
    Sh.bindFree();
    const last = S.settings.lastSong && S.find(S.settings.lastSong);
    App.openSong(last ? last.id : S.records.slice().sort((a, b) => a.order - b.order)[0].id);
    Sh.start();
    readyRes();
    window.addEventListener('pagehide', () => { S.flush(); S.saveSettingsNow(); });
    // first user gesture unlocks audio
    const unlock = () => { A.ensure(); };
    document.addEventListener('pointerdown', unlock, { once: true, capture: true });
    document.addEventListener('keydown', unlock, { once: true, capture: true });
  }

  // ---------------------------------------------------------------- test hooks (same code paths as the UI)
  App.reset = async function () {
    if (W.editor) W.editor.stop();
    if (W.free.active) W.free.leave();
    E.stop(); E.pause(true); E.lastResult = null;
    UI.closePopover(false); UI.closeDialog();
    await S.clearAll();
    S.settings = Object.assign({}, S.defaults);
    Object.assign(E.opts, { wait: true, hands: 'both', speed: 1, loop: null, restartAfter: 0, metronome: false, countIn: null, mode: 'practice', playAlong: true });
    await seedBuiltins();
    history.length = 0; future.length = 0;
    applySettings();
    App.openSong(S.records.slice().sort((a, b) => a.order - b.order)[0].id);
    Sh.relayoutAll();
    S.saveSettingsNow();
  };

  let readyRes; App.ready = new Promise((r) => { readyRes = r; });
  const wrap = (o) => { const out = {}; for (const k in o) out[k] = async (...a) => { await App.ready; return o[k](...a); }; return out; };
  window.WapiroTest = wrap({
    reset: () => App.reset(),
    listSongs: () => S.records.slice().sort((a, b) => a.order - b.order).map((r) => ({ id: r.id, title: r.song.title, source: r.song.source, best: r.best == null ? null : r.best })),
    songInfo: (id) => { const r = S.find(id); if (!r) return null; const s = r.song; return { id, title: s.title, notes: s.notes.length, measures: s.measures.length, exactNotation: s.exactNotation, handsGuessed: s.handsGuessed }; },
    importBytes: (name, buffer) => App.importBuffer(name, buffer),
    openSong: (id) => App.openSong(id),
    setOptions: (o) => E.setOptions(o),
    seekMeasure: (n) => E.seekMeasure(n),
    play: () => E.play(), pause: () => E.pause(), stop: () => E.stop(), listen: () => E.listen(),
    noteOn: (m, v) => E.noteOn(m, v == null ? 90 : v), noteOff: (m) => E.noteOff(m),
    state: () => Object.assign(E.snapshot(), { view: S.settings.view, appearance: S.settings.appearance }),
    openResults: () => W.results.show(E.lastResult && E.lastResult.songId === (E.song && E.song.id) ? E.lastResult : null),
    closeResults: () => W.results.close(),
    editAddNote: (n) => App.addNote(n), undo: () => App.undo(), redo: () => App.redo(),
    deleteSong: (id) => App.deleteSong(id),
    setView: (v) => App.setView(v),
    setAppearance: (a) => App.setAppearance(a),
    setHandColour: (hand, hex) => App.setHandColour(hand, hex),
    freeplay: (on) => (on ? W.free.enter() : W.free.leave()),
    record: (on) => (on ? W.free.startRecording() : W.free.stopRecording()),
    exportVideo: async (o) => { const r = await W.exporter.start(Object.assign({ noDownload: true }, o || {})); delete r.blob; return r; },
  });

  const go = () => start().catch((e) => { UI.toast('The app could not start: ' + e.message, 'error'); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})();
