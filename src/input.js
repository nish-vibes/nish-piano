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

  // ---------------------------------------------------------------- computer-keyboard notes (off by default)
  // A W S E D F T G Y H U J K L play C to C (like a piano row); I shifts an octave down, O an octave up. Rebindable.
  I.DEFAULT_BINDS = {
    notes: ['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY', 'KeyH', 'KeyU', 'KeyJ', 'KeyK'],
    octDown: ['KeyI'], octUp: ['KeyO'],
  };
  I.NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B', 'C (octave up)'];
  I.binds = () => {
    const b = W.storage.settings.kbdBinds;
    if (!b || !Array.isArray(b.notes) || b.notes.length < 13) return I.DEFAULT_BINDS;
    return { notes: b.notes.slice(0, 13), octDown: (b.octDown || []).slice(0, 1).length ? b.octDown.slice(0, 1) : I.DEFAULT_BINDS.octDown, octUp: (b.octUp || []).slice(0, 1).length ? b.octUp.slice(0, 1) : I.DEFAULT_BINDS.octUp };
  };
  I.keyLabel = (code) => (code || '').replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ').replace('Semicolon', ';').replace('Comma', ',').replace('Period', '.').replace('Slash', '/').replace('BracketLeft', '[').replace('BracketRight', ']').replace('Quote', "'").replace('Backquote', '`').replace('Minus', '-').replace('Equal', '=');
  I.octave = 0; // shift in octaves from C4
  const down = new Map();
  I.keyDown = function (e) {
    if (!W.storage.settings.kbdNotes || e.ctrlKey || e.metaKey || e.altKey) return false;
    const b = I.binds();
    if (b.octDown.includes(e.code)) { if (!e.repeat) { I.octave = Math.max(-3, I.octave - 1); changed(); } return true; }
    if (b.octUp.includes(e.code)) { if (!e.repeat) { I.octave = Math.min(3, I.octave + 1); changed(); } return true; }
    const k = b.notes.indexOf(e.code);
    if (k < 0) return false;
    const m = 60 + 12 * I.octave + k;
    if (!e.repeat && !down.has(e.code) && m >= 21 && m <= 108) { down.set(e.code, m); E.noteOn(m, 90); }
    return true;
  };
  I.keyUp = function (e) {
    if (down.has(e.code)) { E.noteOff(down.get(e.code)); down.delete(e.code); return true; }
    return false;
  };
  I.releaseAll = function () { for (const [, m] of down) E.noteOff(m); down.clear(); };
})();
