/* Input: Web MIDI (all inputs, hot-plug, note on/off, sustain CC64) and optional computer-keyboard notes. */
(function () {
  'use strict';
  const W = window.Wapiro, E = W.engine;
  const I = (W.input = { supported: typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function', devices: [], error: null, access: null });
  const listeners = [];
  I.onChange = (fn) => listeners.push(fn);
  const changed = () => listeners.forEach((f) => f());

  function onMessage(ev) {
    const d = ev.data;
    if (!d || d.length < 2) return;
    const st = d[0] & 0xf0;
    if (st === 0x90 && d[2] > 0) E.noteOn(d[1], d[2]);
    else if (st === 0x80 || (st === 0x90 && d[2] === 0)) E.noteOff(d[1]);
    else if (st === 0xb0 && d[1] === 64) E.pedal(d[2] >= 64);
  }
  function refresh() {
    const list = [];
    if (I.access) I.access.inputs.forEach((inp) => {
      if (!inp.onmidimessage) inp.onmidimessage = onMessage;
      list.push({ id: inp.id, name: inp.name || 'MIDI input', state: inp.state, connection: inp.connection });
    });
    I.devices = list;
    changed();
  }
  I.init = function () {
    if (!I.supported) return;
    let p;
    try { p = navigator.requestMIDIAccess({ sysex: false }); } catch (e) { I.error = 'MIDI access is not available here.'; changed(); return; }
    p.then((acc) => { I.access = acc; acc.onstatechange = refresh; refresh(); }, (err) => {
      I.error = err && err.name === 'SecurityError' ? 'MIDI access was not allowed. Allow it in the browser site settings, then reload.' : 'MIDI access was not available.';
      changed();
    });
  };

  // computer keyboard notes (off by default). Keys that map to notes:
  const MAP = { z: 48, s: 49, x: 50, d: 51, c: 52, v: 53, g: 54, b: 55, h: 56, n: 57, j: 58, m: 59, ',': 60, q: 60, '2': 61, w: 62, '3': 63, e: 64, r: 65, '5': 66, t: 67, '6': 68, y: 69, '7': 70, u: 71, i: 72, '9': 73, o: 74, '0': 75, p: 76, '[': 77, ']': 79 };
  const down = new Map();
  I.keyDown = function (e) {
    if (!W.storage.settings.kbdNotes || e.ctrlKey || e.metaKey || e.altKey) return false;
    const m = MAP[e.key.toLowerCase()];
    if (m == null) return false;
    if (!e.repeat && !down.has(e.code)) { down.set(e.code, m); E.noteOn(m, 90); }
    return true;
  };
  I.keyUp = function (e) {
    if (down.has(e.code)) { E.noteOff(down.get(e.code)); down.delete(e.code); return true; }
    return false;
  };
  I.releaseAll = function () { for (const [, m] of down) E.noteOff(m); down.clear(); };
})();
