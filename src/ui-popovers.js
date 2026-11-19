/* The popovers and menus: practice options, sound and devices, more, song list, shortcut list, about. */
(function () {
  'use strict';
  const W = window.Wapiro, E = W.engine, UI = W.ui, h = UI.h, S = W.storage;
  const P = (W.popovers = {});
  let live = null; // refresh function of the open popover
  E.on('change', () => { if (live && UI.popoverEl()) live(); });

  const section = (title, ...kids) => h('div', { class: 'pop-section' }, title ? h('div', { class: 'pop-title', text: title }) : null, ...kids);

  P.practice = function (anchor) {
    const o = E.opts;
    const speed = UI.slider('Speed', 25, 150, 5, Math.round(o.speed * 100), (v) => E.setOptions({ speed: v / 100 }), (v) => v + ' %');
    const reset = h('button', { class: 'ds-btn ds-btn--ghost pop-dashed', type: 'button', onclick: () => { E.setOptions({ speed: 1 }); speed.setValue(100); } }, 'Reset');
    // Loop: a toggle, two bar steppers and a range track with two grip handles. All three edit the same loop.
    const nBars = () => Math.max(1, E.get().measures.length);
    const setLoop = (from, to) => { const n = nBars(); from = Math.max(1, Math.min(n, from)); to = Math.max(from, Math.min(n, to)); E.setOptions({ loop: { from, to } }); };
    const range = () => { const l = E.loopRange(); const c = E.curMeasure(); return l ? { from: l.from, to: l.to, on: true } : { from: c, to: Math.min(nBars(), c + 3), on: false }; };
    const loopBtn = h('button', { class: 'ds-btn ds-btn--ghost loop-toggle', type: 'button', 'aria-pressed': 'false', 'aria-label': 'Loop', onclick: (e) => { W.app.toggleLoop(); if (e.detail > 0) loopBtn.blur(); } }, UI.icon('loop'), h('span', { text: 'Loop' }));
    const loopSum = h('span', { class: 'loop-sum' });
    const stepper = (label, aria, which) => {
      const val = h('span', { class: 'step-val' });
      const bump = (d) => { const r = range(); if (which === 'from') setLoop(r.from + d, r.to); else setLoop(r.from, r.to + d); };
      const dec = h('button', { type: 'button', class: 'step-btn', 'aria-label': aria + ', one earlier', onclick: () => bump(-1) }, UI.icon('minus'));
      const inc = h('button', { type: 'button', class: 'step-btn', 'aria-label': aria + ', one later', onclick: () => bump(1) }, UI.icon('plus'));
      const box = h('div', { class: 'loop-field', role: 'group', 'aria-label': aria }, h('span', { class: 'ds-caption', text: label }), h('div', { class: 'stepper' }, dec, val, inc));
      box.paint = (r) => { val.textContent = String(r[which]); dec.disabled = inc.disabled = !r.on; };
      return box;
    };
    const fromF = stepper('From bar', 'Start bar', 'from'), toF = stepper('To bar', 'End bar', 'to');
    const track = h('div', { class: 'loop-track' });
    const band = h('div', { class: 'loop-band', 'aria-hidden': 'true' });
    const grip = (which, aria) => {
      const g = h('div', { class: 'loop-grip', role: 'slider', tabindex: '0', 'aria-label': aria }, h('span', { 'aria-hidden': 'true' }));
      const at = (e) => { const r = track.getBoundingClientRect(), n = nBars(); return Math.round(1 + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (n - 1)); };
      const put = (v) => { const r = range(); if (which === 'from') setLoop(Math.min(v, r.to), r.to); else setLoop(r.from, Math.max(v, r.from)); };
      let drag = false;
      g.addEventListener('pointerdown', (e) => { drag = true; g.setPointerCapture(e.pointerId); e.preventDefault(); g.focus(); });
      g.addEventListener('pointermove', (e) => { if (drag) put(at(e)); });
      g.addEventListener('pointerup', () => { drag = false; }); g.addEventListener('pointercancel', () => { drag = false; });
      g.addEventListener('keydown', (e) => { const d = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : 0; if (!d) return; const r = range(); put(r[which] + d); e.preventDefault(); e.stopPropagation(); });
      return g;
    };
    const gFrom = grip('from', 'Loop start bar'), gTo = grip('to', 'Loop end bar');
    track.append(band, gFrom, gTo);
    const ends = h('div', { class: 'loop-ends' }, h('span', { text: '1' }), h('span', { class: 'loop-last' }));
    const loopSec = h('div', { class: 'pop-section loop-sec' }, h('div', { class: 'loop-head' }, loopBtn, loopSum), h('div', { class: 'loop-fields' }, fromF, toF), h('div', { class: 'loop-range' }, track, ends));
    const hands = UI.seg('Active hands', [['L', 'Left only'], ['both', 'Both'], ['R', 'Right only']], E.opts.hands, (v) => E.setOptions({ hands: v }));
    hands.classList.add('seg-fill');
    const box = h('div', { class: 'pop-body' }, section(null, h('div', { class: 'row-gap' }, h('div', { style: 'flex:1 1 0;min-width:0' }, speed), reset)), loopSec, section('Active hands', hands), P.handColours());
    live = () => {
      const q = E.opts, r = range(), n = nBars(), pct = (b) => (n > 1 ? ((b - 1) / (n - 1)) * 100 : 0);
      speed.setValue(Math.round(q.speed * 100)); hands.setValue(q.hands);
      loopBtn.setAttribute('aria-pressed', String(r.on));
      loopSum.textContent = r.on ? (r.to - r.from + 1) + (r.to === r.from ? ' bar' : ' bars') : 'Off';
      fromF.paint(r); toF.paint(r);
      loopSec.classList.toggle('is-off', !r.on);
      band.style.left = pct(r.from) + '%'; band.style.width = (pct(r.to) - pct(r.from)) + '%';
      gFrom.style.left = pct(r.from) + '%'; gTo.style.left = pct(r.to) + '%';
      [[gFrom, r.from], [gTo, r.to]].forEach(([g, v]) => { g.setAttribute('aria-valuemin', '1'); g.setAttribute('aria-valuemax', String(n)); g.setAttribute('aria-valuenow', String(v)); g.setAttribute('aria-disabled', String(!r.on)); });
      ends.lastChild.textContent = String(n);
    };
    live();
    return UI.openPopover(anchor, box, { label: 'Practice options', onClose: () => { live = null; } });
  };

  const INSTRUMENTS = [['piano', 'Piano'], ['epiano', 'E-piano'], ['organ', 'Organ'], ['harpsichord', 'Harpsichord'], ['marimba', 'Marimba'], ['strings', 'Strings']];

  P.sound = function (anchor) {
    const st = S.settings, A = W.audio, I = W.input;
    const row = (btn, slider) => h('div', { class: 'row-gap' }, btn, slider);
    const along = UI.toggleBtn('speaker', 'Play along', E.opts.playAlong, (v) => E.setOptions({ playAlong: v }));
    const vol = UI.miniSlider('Play-along volume', 0, 100, 1, Math.round(st.accVolume * 100), (v) => { st.accVolume = v / 100; A.accVolume = st.accVolume; A.applyVolumes(); S.saveSettings(); });
    const metro = UI.toggleBtn('metronome', 'Metronome', E.opts.metronome, (v) => E.setOptions({ metronome: v }));
    const mvol = UI.miniSlider('Metronome volume', 0, 100, 1, Math.round((st.metroVolume == null ? 0.7 : st.metroVolume) * 100), (v) => { st.metroVolume = v / 100; A.metroVolume = st.metroVolume; A.applyVolumes(); S.saveSettings(); });
    [vol, mvol].forEach((m) => { m.querySelector('span').remove(); m.classList.add('grow'); });
    // two instruments: the main one and an optional layer; picking the active layer again turns it off
    const picker = (label, key, cls) => {
      const wrap = h('div', { class: 'inst-grid ' + cls, role: 'group', 'aria-label': label });
      const btns = INSTRUMENTS.map(([v, t]) => { const b = h('button', { type: 'button', class: 'inst-btn', 'aria-pressed': 'false', 'data-v': v, onclick: () => pick(v) }, t); wrap.append(b); return b; });
      const paint = () => btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === st[key])));
      const pick = (v) => {
        if (key === 'layer') st.layer = st.layer === v ? null : v; else st.instrument = v;
        A.instrument = st.instrument; A.layer = st.layer || null;
        S.saveSettings(); drawInst(); if (A.preview) A.preview(60);
      };
      wrap.paint = paint;
      return wrap;
    };
    const main = picker('Main instrument', 'instrument', 'inst-main'), layer = picker('Layer instrument', 'layer', 'inst-layer');
    const drawInst = () => { main.paint(); layer.paint(); };
    drawInst();
    const devs = h('div', { class: 'dev-list' });
    const drawDevs = () => {
      devs.textContent = '';
      if (!I.supported && !I.external) devs.append(h('div', { class: 'ds-help', text: 'MIDI is not available here. Use the desktop app, Chrome or Edge.' }));
      else if (I.error && !I.external) devs.append(h('div', { class: 'ds-help is-error' }, UI.icon('alert'), I.error));
      else if (!I.devices.length) devs.append(h('div', { class: 'ds-help', text: 'No MIDI keyboard found. Connect one by USB.' }));
      for (const d of I.devices) devs.append(h('div', { class: 'dev-row' }, h('span', { class: 'dev-ok' + (d.state === 'connected' ? '' : ' is-off') }, UI.icon(d.state === 'connected' ? 'check' : 'minus')), h('span', { class: 'ds-control-text dev-name', text: d.name + (d.state === 'connected' ? ' connected' : d.state === 'busy' ? ' in use by another program' : ' not connected') })));
      if (I.devices.length) { const mute = UI.toggleBtn('speakerOff', 'Mute', !!st.midiMute, (v) => { st.midiMute = v; mute.setValue(v); S.saveSettings(); }); mute.classList.add('dev-mute'); mute.title = 'For a piano with its own speakers: the app makes no sound for keys you play on it. Play along and the metronome still sound.'; devs.firstChild.append(mute); }
    };
    drawDevs();
    I.onChange(drawDevs);
    // Low latency: smallest sound buffer; the delay the browser reports is shown so the effect can be seen
    const latText = () => { const l = A.latency && A.latency(); return (l ? 'Key to sound: about ' + l.ms + ' ms. ' : '') + 'Uses more processor power: if you hear clicks, turn it off.'; };
    const low = UI.switchBtn('Low latency', !!st.lowLatency, (v) => {
      st.lowLatency = v; low.setValue(v); S.saveSettings();
      if (E.playing) E.pause();
      A.setLowLatency(v); A.ensure();
      low.querySelector('.ds-caption').textContent = latText();
      setTimeout(() => { if (document.contains(low)) low.querySelector('.ds-caption').textContent = latText(); }, 400);
    }, latText());
    low.classList.add('low-lat');
    // ---- the ASIO engine (desktop app): the shortest key-to-sound delay
    const NA = W.naudio;
    let asio = null, unsub = null;
    if (NA && NA.supported) {
      const sw = UI.switchBtn('ASIO engine', st.audioEngine === 'asio', (v) => { sw.setValue(v); if (v) NA.enable(); else NA.disable(); }, NA.summary());
      sw.classList.add('asio-switch');
      const devSel = h('select', { class: 'ds-input asio-sel', 'aria-label': 'ASIO driver', onchange: () => NA.setDevice(devSel.value) });
      const frSel = h('select', { class: 'ds-input asio-sel', 'aria-label': 'Buffer size', onchange: () => NA.setFrames(+frSel.value) }, NA.FRAMES.map(([v, t]) => h('option', { value: String(v) }, t)));
      const btn = (text, fn) => h('button', { class: 'ds-btn ds-btn--outline', type: 'button', onclick: fn }, text);
      const tools = h('div', { class: 'row-gap asio-tools' }, btn('Driver settings', () => NA.panel()), btn('Find drivers', () => NA.refresh()));
      const rows = h('div', { class: 'asio-rows' },
        h('label', { class: 'asio-row' }, h('span', { class: 'ds-label', text: 'Driver' }), devSel),
        h('label', { class: 'asio-row' }, h('span', { class: 'ds-label', text: 'Buffer' }), frSel), tools);
      const warn = h('div', { class: 'asio-warn' });
      // Windows audio effects ("Audio enhancements"): processing in the Windows mixer, used by the standard engine
      const fxBtn = h('button', { class: 'ds-btn ds-btn--outline self-start', type: 'button' }, 'Disable Windows audio effects');
      const fxCap = h('p', { class: 'ds-caption', text: 'Windows sound enhancements add processing and delay to the standard engine and to other apps. The ASIO engine already skips them. Windows asks for permission.' });
      const fxMore = h('button', { class: 'ds-btn ds-btn--ghost self-start fx-more', type: 'button', onclick: () => NA.fxOpenSettings() }, 'Open Windows sound settings');
      let fxBusy = false;
      const drawFx = () => {
        const fx = NA.fx;
        if (!NA.fxSupported) { fxBtn.hidden = fxCap.hidden = fxMore.hidden = true; return; }
        const list = (fx && fx.devices) || [], offN = list.filter((d) => d.off).length;
        const restore = !!(fx && fx.changedByApp && list.length && offN === list.length);
        fxBtn.textContent = fxBusy ? 'Waiting for Windows…' : restore ? 'Turn Windows audio effects back on' : 'Disable Windows audio effects';
        fxBtn.disabled = fxBusy;
        fxBtn.onclick = async () => {
          fxBusy = true; drawFx();
          const r = await NA.fxSet(!restore);
          fxBusy = false; drawFx();
          if (!r) return;
          if (r.ok) UI.toast(restore ? 'Windows audio effects are back on.' : 'Windows audio effects are off for ' + r.changed + (r.changed === 1 ? ' output.' : ' outputs.'));
          else if (r.cancelled) UI.toast(r.error);
          else UI.toast('Some outputs could not be changed: ' + (r.error || 'access denied') + '. Use Windows sound settings for those.');
        };
        fxMore.hidden = !(fx && (fx.error || (list.length && offN < list.length && fx.changedByApp)));
        const state = fx && !fx.error && list.length ? (offN === list.length ? ' Effects are off for every output.' : offN ? ' Effects are off for ' + offN + ' of ' + list.length + ' outputs.' : '') : '';
        fxCap.textContent = 'Windows sound enhancements add processing and delay to the standard engine and to other apps. The ASIO engine already skips them. Windows asks for permission.' + state;
      };
      const draw = () => {
        if (!document.contains(sw)) return;
        const on = st.audioEngine === 'asio';
        sw.setValue(on);
        sw.querySelector('.ds-caption').textContent = NA.summary();
        sw.classList.toggle('is-error', NA.state === 'error');
        rows.hidden = !on;
        devSel.textContent = '';
        for (const d of NA.devices) devSel.append(h('option', { value: d.name, selected: d.name === st.asioDevice ? true : null }, d.name));
        if (!NA.devices.length) devSel.append(h('option', { value: '', text: NA.state === 'starting' ? 'Looking for drivers…' : 'No ASIO driver found' }));
        devSel.disabled = !NA.devices.length;
        frSel.value = String(st.asioFrames | 0);
        warn.textContent = '';
        if (on && NA.xruns) warn.append(h('p', { class: 'ds-help is-error' }, UI.icon('alert'), 'Dropouts: ' + NA.xruns + '. If you hear clicks, choose a larger buffer.'));
        if (NA.midiBusy()) {
          const names = NA.midi.filter((d) => !d.ok).map((d) => d.name).join(', ');
          warn.append(h('p', { class: 'ds-help is-error' }, UI.icon('alert'), names + ' is in use by another program. Close that program, or restart this app so the low-latency engine can read it.'), btn('Restart the app', () => NA.relaunch()));
        }
        low.hidden = on;
        drawFx();
      };
      asio = h('div', { class: 'pop-section asio' }, sw, rows, warn, h('div', { class: 'menu-sep', 'aria-hidden': 'true' }), fxBtn, fxCap, fxMore);
      unsub = NA.onChange(draw);
      draw();
      if (NA.fxSupported) NA.fxStatus();
      if (st.audioEngine === 'asio' && !NA.devices.length) NA.refresh();
    }
    const kb = UI.toggleBtn('keyboard', 'Keystroke input', st.kbdNotes, (v) => { st.kbdNotes = v; kb.setValue(v); if (!v) I.releaseAll(); S.saveSettings(); });
    kb.classList.add('self-start');
    // the keystroke layout, drawn like a computer keyboard: white-key letters light, black-key letters dark, octave keys dashed
    const layout = () => {
      const b = I.binds(), n = b.notes, kc = (code, cls, sub) => h('kbd', { class: 'kcap ' + cls }, I.keyLabel(code), sub ? h('small', { text: sub }) : null);
      const top = [h('span', { class: 'kcap gap' }), kc(n[1], 'blk'), kc(n[3], 'blk'), h('span', { class: 'kcap gap' }), kc(n[6], 'blk'), kc(n[8], 'blk'), kc(n[10], 'blk'), kc(b.octDown[0], 'oct', '−1 oct'), kc(b.octUp[0], 'oct', '+1 oct')];
      const bot = [0, 2, 4, 5, 7, 9, 11, 12].map((i) => kc(n[i], 'wht'));
      const lab = 'Keystroke layout: ' + [0, 2, 4, 5, 7, 9, 11, 12].map((i) => I.keyLabel(n[i])).join(' ') + ' play the white keys, ' + [1, 3, 6, 8, 10].map((i) => I.keyLabel(n[i])).join(' ') + ' the black keys. ' + b.octDown.map(I.keyLabel).join(' or ') + ' go one octave down, ' + b.octUp.map(I.keyLabel).join(' or ') + ' one octave up.';
      return h('div', { class: 'kb-layout', role: 'img', 'aria-label': lab }, h('div', { class: 'kb-row' }, ...top), h('div', { class: 'kb-row kb-row2' }, ...bot));
    };
    const rebind = h('button', { class: 'ds-btn ds-btn--outline self-start', type: 'button', onclick: () => { UI.closePopover(false); P.bindings(); } }, UI.icon('keyboard'), 'Change bindings');
    const sec = (title, ...kids) => h('section', { class: 'pop-section' }, h('h3', { class: 'pop-h', text: title }), ...kids);
    const sep = () => h('div', { class: 'menu-sep', 'aria-hidden': 'true' });
    const box = h('div', { class: 'pop-body pop-sound' },
      sec('Volume', row(along, vol), row(metro, mvol)), sep(),
      sec('Playback instruments', h('div', { class: 'pop-section' }, h('span', { class: 'ds-label', text: 'Main' }), main), h('div', { class: 'pop-section' }, h('span', { class: 'ds-label', text: 'Layer' }), layer)), sep(),
      asio ? sec('Low latency', asio) : null, asio ? sep() : null,
      sec('Devices', devs, low, kb, layout(), rebind));
    const sync = () => {
      along.setValue(E.opts.playAlong); metro.setValue(E.opts.metronome);
      vol.querySelector('input').disabled = !E.opts.playAlong; mvol.querySelector('input').disabled = !E.opts.metronome;
    };
    sync(); live = sync;
    return UI.openPopover(anchor, box, { label: 'Sound and devices', onClose: () => { live = null; if (unsub) unsub(); } });
  };

  /** Rebind the computer-keyboard notes: click a row, press a key. A key used elsewhere swaps places. */
  P.bindings = function () {
    const I = W.input, st = S.settings;
    let cur = JSON.parse(JSON.stringify(I.binds()));
    let waiting = null;
    const list = h('div', { class: 'bind-list' });
    const all = () => [...cur.notes.map((c, i) => ['n', i, c]), ...cur.octDown.map((c, i) => ['d', i, c]), ...cur.octUp.map((c, i) => ['u', i, c])];
    const setAt = (kind, i, code) => { (kind === 'n' ? cur.notes : kind === 'd' ? cur.octDown : cur.octUp)[i] = code; };
    const draw = () => {
      list.textContent = '';
      const row = (label, kind, i, code) => h('div', { class: 'row-between bind-row' }, h('span', { class: 'ds-control-text', text: label }),
        h('button', { class: 'ds-btn ds-btn--outline bind-key' + (waiting && waiting.kind === kind && waiting.i === i ? ' is-waiting' : ''), type: 'button', 'aria-label': label + ': ' + I.keyLabel(code) + '. Press to change.', onclick: () => { waiting = { kind, i }; draw(); } },
          waiting && waiting.kind === kind && waiting.i === i ? 'Press a key' : h('span', { class: 'ds-kbd', text: I.keyLabel(code) })));
      list.append(h('div', { class: 'pop-title', text: 'Notes (from C4)' }));
      cur.notes.forEach((c, i) => list.append(row(I.NOTE_NAMES[i], 'n', i, c)));
      list.append(h('div', { class: 'pop-title', text: 'Octave' }));
      cur.octDown.forEach((c, i) => list.append(row('Octave down' + (i ? ' (second key)' : ''), 'd', i, c)));
      cur.octUp.forEach((c, i) => list.append(row('Octave up' + (i ? ' (second key)' : ''), 'u', i, c)));
    };
    const onKey = (e) => {
      if (!waiting) return;
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { waiting = null; draw(); return; }
      if (!/^(Key|Digit|Semicolon|Comma|Period|Slash|BracketLeft|BracketRight|Quote|Minus|Equal|Backquote)/.test(e.code)) return;
      const other = all().find(([k, i, c]) => c === e.code && !(k === waiting.kind && i === waiting.i));
      const old = all().find(([k, i]) => k === waiting.kind && i === waiting.i)[2];
      if (other) setAt(other[0], other[1], old);
      setAt(waiting.kind, waiting.i, e.code);
      waiting = null; draw();
    };
    document.addEventListener('keydown', onKey, true);
    draw();
    UI.openDialog('Keystroke bindings', h('div', { class: 'bindings' }, h('p', { class: 'ds-caption', text: 'Choose a row, then press the key you want. A key that is already used swaps places.' }), list),
      [{ label: 'Reset to default', keepOpen: true, run: () => { cur = JSON.parse(JSON.stringify(I.DEFAULT_BINDS)); waiting = null; draw(); } },
        { label: 'Cancel' }, { label: 'Save', primary: true, run: () => { st.kbdBinds = cur; S.saveSettings(); UI.toast('Keystroke bindings saved.'); } }],
      { onClose: () => document.removeEventListener('keydown', onKey, true) });
  };

  P.more = function (anchor) {
    const item = (text, fn) => h('button', { class: 'menu-item', role: 'menuitem', type: 'button', onclick: () => { UI.closePopover(false); fn(); } }, text);
    const cur = S.settings.appearance;
    const apps = [['auto', 'System'], ['light', 'Light'], ['dark', 'Dark'], ['light-hc', 'Light, increased contrast'], ['dark-hc', 'Dark, increased contrast']];
    const box = h('div', { class: 'menu', role: 'menu' },
      item('Import file', () => W.library.pickAndImport()),
      item('Library', () => W.library.open()),
      item('Correct notes', () => W.editor.start()),
      item('Export MIDI', () => W.app.exportCurrentMidi()),
      item('Export video', () => P.exportVideo()),
      h('div', { class: 'menu-sep' }),
      h('div', { class: 'pop-title menu-title', text: 'Appearance' }),
      h('div', { role: 'group', 'aria-label': 'Appearance' }, apps.map(([v, t]) => h('button', { class: 'menu-item', role: 'menuitemradio', 'aria-checked': String(v === cur), type: 'button', onclick: () => { W.app.setAppearance(v); UI.closePopover(false); } }, h('span', { class: 'menu-check' }, v === cur ? UI.icon('check') : null), t))),
      h('div', { class: 'menu-sep' }),
      item('Keyboard shortcuts', () => P.shortcuts()),
      item('Back up library', () => W.library.backup()),
      item('Restore backup', () => W.library.restore()),
      item('About', () => P.about()));
    live = null;
    const el = UI.openPopover(anchor, box, { role: 'menu', label: 'More' });
    const first = el && el.querySelector('button'); if (first) first.focus();
    return el;
  };

  // ---------------------------------------------------------------- hand colours
  const PRESETS = [['Blue', null, 'L'], ['Orange', null, 'R'], ['Teal', '#2EC4B6'], ['Violet', '#A78BFA'], ['Pink', '#F472B6']];
  const hex2rgb = (x) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16));
  const rgb2hex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
  function hsl2rgb(hh, sat, li) { sat /= 100; li /= 100; const k = (n) => (n + hh / 30) % 12, a = sat * Math.min(li, 1 - li), f = (n) => li - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)); return [f(0) * 255, f(8) * 255, f(4) * 255]; }
  function rgb2hsl(c) { const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, li = (mx + mn) / 2; let hh = 0; if (d) { hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; hh *= 60; if (hh < 0) hh += 360; } return [hh, d ? (d / (1 - Math.abs(2 * li - 1))) * 100 : 0, li * 100]; }
  /** The colour a hand shows now, as #RRGGBB (resolves the appearance's own colour when none is set). */
  function handHex(hand) {
    const c = document.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d', { willReadFrequently: true });
    x.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(hand === 'L' ? '--hand-left' : '--hand-right').trim(); x.fillRect(0, 0, 1, 1);
    const d = x.getImageData(0, 0, 1, 1).data; return rgb2hex([d[0], d[1], d[2]]);
  }
  /** Why a colour may be a poor choice for a hand, or null. Red marks wrong and missed notes, green a correct key. */
  P.colourWarning = function (hex, otherHex) {
    const [hh, sat] = rgb2hsl(hex2rgb(hex)), a = hex2rgb(hex), b = hex2rgb(otherHex);
    if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 70) return 'Too close to the other hand\'s colour. The two hands will be hard to tell apart.';
    if (sat > 35 && (hh < 18 || hh > 342)) return 'Close to red, which marks wrong and missed notes. Notes in this colour may look like mistakes.';
    if (sat > 35 && hh > 100 && hh < 145) return 'Close to green, which lights a correct key. Notes in this colour may be hard to tell apart.';
    return null;
  };
  P.handColours = function () {
    const st = S.settings; let hand = 'L';
    const key = (hd) => (hd === 'L' ? 'handL' : 'handR');
    const chip = { L: h('span', { class: 'glass-sw glass-chip', 'aria-hidden': 'true' }), R: h('span', { class: 'glass-sw glass-chip', 'aria-hidden': 'true' }) };
    const tabs = { L: h('button', { type: 'button', class: 'seg-btn', 'aria-pressed': 'true', onclick: () => { hand = 'L'; paint(); } }, chip.L, 'Left hand'), R: h('button', { type: 'button', class: 'seg-btn', 'aria-pressed': 'false', onclick: () => { hand = 'R'; paint(); } }, chip.R, 'Right hand') };
    const row = h('div', { class: 'sw-row', role: 'group' });
    const paint = () => {
      const cur = { L: handHex('L'), R: handHex('R') }, other = hand === 'L' ? 'R' : 'L', mine = st[key(hand)];
      chip.L.style.setProperty('--c', cur.L); chip.R.style.setProperty('--c', cur.R);
      tabs.L.setAttribute('aria-pressed', String(hand === 'L')); tabs.R.setAttribute('aria-pressed', String(hand === 'R'));
      row.setAttribute('aria-label', 'Colour for the ' + (hand === 'L' ? 'left' : 'right') + ' hand');
      row.textContent = '';
      let matched = false;
      // the two default colours first: each hand's own default clears its setting
      const defaults = { L: (() => { const keep = st.handL; document.documentElement.style.removeProperty('--hand-left'); const v = handHex('L'); if (keep) document.documentElement.style.setProperty('--hand-left', keep); return v; })(),
        R: (() => { const keep = st.handR; document.documentElement.style.removeProperty('--hand-right'); const v = handHex('R'); if (keep) document.documentElement.style.setProperty('--hand-right', keep); return v; })() };
      for (const [name, hx, def] of PRESETS) {
        const val = def ? defaults[def] : hx, sel = cur[hand].toUpperCase() === val.toUpperCase(), used = !sel && cur[other].toUpperCase() === val.toUpperCase();
        if (sel) matched = true;
        row.appendChild(h('button', { type: 'button', class: 'glass-sw sw-btn', style: '--c:' + val, 'aria-pressed': String(sel), 'aria-label': name + (used ? ', used by the ' + (other === 'L' ? 'left' : 'right') + ' hand' : ''), title: name,
          onclick: () => { W.app.setHandColour(hand, def === hand ? null : val); paint(); } }, used ? h('span', { class: 'sw-mark', text: other }) : null));
      }
      const custom = !matched;
      row.appendChild(h('button', { type: 'button', class: 'sw-btn sw-custom' + (custom ? ' is-set' : ''), 'aria-pressed': String(custom), 'aria-haspopup': 'dialog', 'aria-label': 'Custom colour' + (custom ? ', ' + cur[hand] : '') + '. Opens the colour wheel', title: 'Custom colour',
        onclick: () => P.colourWheel(hand, cur[hand], cur[other], paint) }, custom ? h('span', { class: 'glass-sw', style: '--c:' + cur[hand], 'aria-hidden': 'true' }) : null));
    };
    paint();
    return h('div', { class: 'pop-section' }, h('div', { class: 'pop-title', text: 'Hand colours' }), h('div', { class: 'seg seg-fill', role: 'group', 'aria-label': 'Hand to colour' }, tabs.L, tabs.R), row);
  };
  /** Colour wheel: hue around, strength outward, a brightness slider that stops before the dark shades, and a hex field for the keyboard. */
  P.colourWheel = function (hand, startHex, otherHex, done) {
    UI.closePopover(false);
    let [hue, sat, li] = rgb2hsl(hex2rgb(startHex)); li = Math.max(40, Math.min(80, li)); sat = Math.max(0, Math.min(100, sat));
    const SZ = 176, cv = h('canvas', { class: 'wheel', width: String(SZ * 2), height: String(SZ * 2), role: 'slider', tabindex: '0', 'aria-label': 'Colour wheel: left and right change the hue, up and down the strength', 'aria-valuemin': '0', 'aria-valuemax': '360' });
    const knob = h('span', { class: 'wheel-knob', 'aria-hidden': 'true' }), wrap = h('div', { class: 'wheel-wrap' }, cv, knob);
    const pvL = h('span', { class: 'glass-sw pv-bar' }), pvR = h('span', { class: 'glass-sw pv-bar' });
    const preview = h('div', { class: 'wheel-preview', role: 'img', 'aria-label': 'Preview of both hands' }, h('div', { class: 'pv-col' }, pvL, h('span', { class: 'ds-caption', text: 'L' })), h('div', { class: 'pv-col' }, pvR, h('span', { class: 'ds-caption', text: 'R' })));
    const warn = h('div', { class: 'wheel-warn', role: 'status', hidden: '' }, UI.icon('alert'), h('span'));
    const bright = h('input', { type: 'range', class: 'range', min: '40', max: '80', step: '1', 'aria-label': 'Brightness' }), bval = h('span', { class: 'ds-caption' });
    const hexIn = h('input', { type: 'text', class: 'ds-input hex-in', spellcheck: 'false', maxlength: '7', 'aria-label': 'Hex colour' });
    const cur = () => rgb2hex(hsl2rgb(hue, sat, li));
    const drawWheel = () => {
      const x = cv.getContext('2d'), n = SZ * 2, im = x.createImageData(n, n), d = im.data, r0 = n / 2;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const dx = i - r0 + 0.5, dy = j - r0 + 0.5, rr = Math.hypot(dx, dy) / r0; if (rr > 1) continue;
        let a = (Math.atan2(dy, dx) * 180) / Math.PI + 90; if (a < 0) a += 360;
        const sv = rr * 100, c = hsl2rgb(a, sv, li), reserved = sv > 35 && (a < 18 || a > 342 || (a > 100 && a < 145)), k = reserved ? 0.3 : 1, o = (j * n + i) * 4;
        d[o] = c[0] * k; d[o + 1] = c[1] * k; d[o + 2] = c[2] * k; d[o + 3] = Math.min(1, (1 - rr) * r0) * 255;
      }
      x.putImageData(im, 0, 0);
    };
    const paint = (fromHex) => {
      const hx = cur(), rad = ((hue - 90) * Math.PI) / 180, rr = (sat / 100) * (SZ / 2);
      knob.style.left = SZ / 2 + Math.cos(rad) * rr + 'px'; knob.style.top = SZ / 2 + Math.sin(rad) * rr + 'px'; knob.style.background = hx;
      (hand === 'L' ? pvL : pvR).style.setProperty('--c', hx); (hand === 'L' ? pvR : pvL).style.setProperty('--c', otherHex);
      bright.value = String(Math.round(li)); bval.textContent = Math.round(li) + ' %'; bright.style.accentColor = hx;
      if (!fromHex) hexIn.value = hx;
      cv.setAttribute('aria-valuenow', String(Math.round(hue))); cv.setAttribute('aria-valuetext', hx);
      const wmsg = P.colourWarning(hx, otherHex); warn.hidden = !wmsg; warn.lastChild.textContent = wmsg || '';
    };
    const pick = (e) => { const r = cv.getBoundingClientRect(), dx = e.clientX - r.left - r.width / 2, dy = e.clientY - r.top - r.height / 2; hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 90 + 360) % 360; sat = Math.min(100, (Math.hypot(dx, dy) / (r.width / 2)) * 100); paint(); };
    let drag = false;
    cv.addEventListener('pointerdown', (e) => { drag = true; cv.setPointerCapture(e.pointerId); pick(e); });
    cv.addEventListener('pointermove', (e) => { if (drag) pick(e); });
    cv.addEventListener('pointerup', () => { drag = false; }); cv.addEventListener('pointercancel', () => { drag = false; });
    cv.addEventListener('keydown', (e) => {
      const k = e.key; if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(k)) return;
      if (k === 'ArrowLeft') hue = (hue + 355) % 360; else if (k === 'ArrowRight') hue = (hue + 5) % 360; else sat = Math.max(0, Math.min(100, sat + (k === 'ArrowUp' ? 5 : -5)));
      paint(); e.preventDefault(); e.stopPropagation();
    });
    bright.addEventListener('input', () => { li = Number(bright.value); drawWheel(); paint(); });
    hexIn.addEventListener('input', () => { let v = hexIn.value.trim(); if (v && v[0] !== '#') v = '#' + v; if (/^#[0-9a-f]{6}$/i.test(v)) { const c = rgb2hsl(hex2rgb(v)); hue = c[0]; sat = c[1]; li = Math.max(40, Math.min(80, c[2])); drawWheel(); paint(true); } });
    hexIn.addEventListener('blur', () => { hexIn.value = cur(); });
    drawWheel(); paint();
    const body = h('div', { class: 'wheel-body' }, h('div', { class: 'wheel-top' }, wrap, preview), warn,
      h('div', { class: 'pop-section' }, h('div', { class: 'wheel-row' }, h('span', { class: 'pop-title', text: 'Brightness' }), bval), bright, h('span', { class: 'ds-caption', text: 'The darkest shades are left out, so notes stay visible against the night sky.' })),
      h('label', { class: 'wheel-row hex-row' }, h('span', { class: 'pop-title', text: 'Hex' }), hexIn, h('span', { class: 'ds-caption grow', style: 'text-align:right', text: 'Red and green are dimmed' })));
    UI.openDialog('Custom colour, ' + (hand === 'L' ? 'left hand' : 'right hand'), body, [{ label: 'Cancel' }, { label: 'Use colour', primary: true, run: () => { W.app.setHandColour(hand, cur()); if (done) done(); } }]);
  };

  P.exportVideo = function () {
    const pick = W.exporter.pickType();
    if (!pick) { UI.toast('This browser cannot record video. Use the Windows app, or a current Chrome or Edge.', 'error'); return; }
    const g = E.get(), secs = Math.round((E.qToSec(g.endQ) - E.qToSec(-E.lead)) / E.opts.speed), len = Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
    const body = h('div', { class: 'about' },
      h('p', { class: 'ds-reading', text: 'Saves "' + E.song.title + '" as a video of the waterfall and the keys, with sound. Send it to someone who does not read sheet music.' }),
      h('p', { class: 'ds-caption', text: 'The song plays once from the start while the video is made, so it takes ' + len + ' at the current speed (' + Math.round(E.opts.speed * 100) + ' %). Keep the window open and visible until it is done. File type: ' + pick.ext.toUpperCase() + '.' }));
    UI.openDialog('Export video', body, [{ label: 'Cancel' }, { label: 'Export', primary: true, run: () => { W.exporter.start(); } }]);
  };

  P.shortcuts = function () {
    const rows = [['Space', 'Play or pause'], ['Home', 'Back to the start'], ['Left, Right', 'Previous or next bar'], ['L', 'Loop on or off'], ['F', 'Freeplay on or off'], ['R', 'Record on or off'], ['W', 'Wait for me on or off'],
      ['P', 'Play along on or off'], ['H', 'Change hands (both, right, left)'], ['V', 'Next view'], ['M', 'Metronome on or off'], ['Shift + wheel', 'Scroll the keyboard sideways'], ['+, -', 'Faster or slower'], ['Shift', 'Sustain pedal (hold)'], ['?', 'This list'], ['Esc', 'Close'],
      ['Ctrl+Z, Ctrl+Y', 'Undo or redo (Correct notes)'], ['Delete', 'Delete the selected note (Correct notes)'], ['Arrows', 'Move the selected note (Correct notes)'], ['R, L', 'Set the hand of the selected note (Correct notes)']];
    const body = h('dl', { class: 'kbd-list' }, rows.map(([k, t]) => [h('dt', null, k.split(', ').map((x) => h('kbd', { class: 'ds-kbd', text: x }))), h('dd', { text: t })]));
    UI.openDialog('Keyboard shortcuts', body);
  };
  P.about = function () {
    UI.openDialog('About', h('div', { class: 'about' },
      h('p', { class: 'ds-reading', text: 'NiSH MarkSteady Piano 2.0.0' }),
      h('p', { class: 'ds-caption', text: 'A piano practice app that runs from this one file, offline. Your songs and settings stay in this browser on this device.' })));
  };
})();
