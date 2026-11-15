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
    const bpmText = (v) => Math.round(v * 100) + '% · ' + Math.round(E.bpmAt(Math.max(0, E.q)) * v) + ' BPM';
    const speed = UI.slider('Speed', 25, 150, 5, Math.round(o.speed * 100), (v) => E.setOptions({ speed: v / 100 }), (v) => bpmText(v / 100));
    const loopSw = UI.switchBtn('Loop', !!o.loop, (v) => {
      if (!v) E.setOptions({ loop: null });
      else { const cur = E.curMeasure(), last = E.get().measures.length; E.setOptions({ loop: { from: cur, to: Math.min(last, cur + 3) } }); }
    }, 'Drag the handles on the timeline to change the bars.');
    const loopTxt = h('span', { class: 'ds-caption' });
    const loopClear = h('button', { class: 'ds-btn ds-btn--outline', type: 'button', onclick: () => E.setOptions({ loop: null }) }, 'Clear');
    const loopRow = h('div', { class: 'row-between loop-row' }, loopTxt, loopClear);
    const restart = UI.seg('Restart bar after mistakes', [[0, 'Off'], [2, '2'], [3, '3'], [5, '5'], [10, '10']], o.restartAfter, (v) => E.setOptions({ restartAfter: v }));
    const box = h('div', { class: 'pop-body' }, section(null, speed), section(null, loopSw, loopRow), section('Restart bar after mistakes', restart));
    live = () => {
      const q = E.opts;
      speed.setValue(Math.round(q.speed * 100)); loopSw.setValue(!!q.loop); restart.setValue(q.restartAfter);
      const l = E.loopRange();
      loopRow.style.display = l ? '' : 'none';
      loopTxt.textContent = l ? (l.from === l.to ? 'Bar ' + l.from : 'Bars ' + l.from + ' to ' + l.to) : '';
    };
    live();
    return UI.openPopover(anchor, box, { label: 'Practice options', onClose: () => { live = null; } });
  };

  P.sound = function (anchor) {
    const st = S.settings, A = W.audio, I = W.input;
    const vol = UI.slider('Volume', 0, 100, 1, Math.round(st.volume * 100), (v) => { st.volume = v / 100; A.volume = st.volume; A.applyVolumes(); S.saveSettings(); }, (v) => v + '%');
    const mvol = UI.slider('Metronome volume', 0, 100, 1, Math.round((st.metroVolume == null ? 0.7 : st.metroVolume) * 100), (v) => { st.metroVolume = v / 100; A.metroVolume = st.metroVolume; A.applyVolumes(); S.saveSettings(); }, (v) => v + '%');
    const countIn = UI.switchBtn('Count-in', E.effectiveCountIn(), (v) => E.setOptions({ countIn: v }), 'One bar of clicks before play starts from the middle of a song. From the start, the two empty bars count in.');
    const inst = UI.seg('Instrument', [['piano', 'Piano'], ['epiano', 'E-piano'], ['organ', 'Organ'], ['harpsichord', 'Harpsichord'], ['strings', 'Strings']], st.instrument, (v) => { st.instrument = v; A.instrument = v; inst.setValue(v); S.saveSettings(); if (A.preview) A.preview(60); });
    inst.classList.add('seg-wrap');
    const devs = h('div', { class: 'dev-list' });
    const drawDevs = () => {
      devs.textContent = '';
      if (!I.supported) devs.append(h('div', { class: 'ds-help', text: 'MIDI is not available here. Use the desktop app, Chrome or Edge.' }));
      else if (I.error) devs.append(h('div', { class: 'ds-help is-error' }, UI.icon('alert'), I.error));
      else if (!I.devices.length) devs.append(h('div', { class: 'ds-help', text: 'No MIDI keyboard found. Connect one by USB.' }));
      for (const d of I.devices) devs.append(h('div', { class: 'row-between dev-row' }, h('span', { class: 'ds-control-text dev-name', text: d.name }), h('span', { class: 'ds-badge ' + (d.state === 'connected' ? 'ds-badge--success' : '') }, d.state === 'connected' ? UI.icon('check') : null, d.state === 'connected' ? 'Connected' : 'Not connected')));
    };
    drawDevs();
    I.onChange(drawDevs);
    const b = I.binds();
    const kbHint = () => b.notes.slice(0, 13).map(I.keyLabel).join(' ') + ' play C to C. Octave down: ' + b.octDown.map(I.keyLabel).join(' or ') + '. Octave up: ' + b.octUp.map(I.keyLabel).join(' or ') + '.';
    const kb = UI.switchBtn('Activate keystroke input', st.kbdNotes, (v) => { st.kbdNotes = v; kb.setValue(v); if (!v) I.releaseAll(); S.saveSettings(); }, kbHint());
    const rebind = h('button', { class: 'ds-btn ds-btn--outline', type: 'button', onclick: () => { UI.closePopover(false); P.bindings(); } }, 'Change bindings');
    const box = h('div', { class: 'pop-body' }, section(null, vol), section('Metronome', mvol, countIn), section('Instrument', inst),
      section('MIDI devices', devs), section(null, kb, h('div', null, rebind)));
    live = () => countIn.setValue(E.effectiveCountIn());
    return UI.openPopover(anchor, box, { label: 'Sound and devices', onClose: () => { live = null; } });
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

  P.shortcuts = function () {
    const rows = [['Space', 'Play or pause'], ['Home', 'Back to the start'], ['Left, Right', 'Previous or next bar'], ['L', 'Loop on or off'], ['W', 'Wait for me on or off'],
      ['P', 'Play along on or off'], ['H', 'Change hands (both, right, left)'], ['V', 'Next view'], ['M', 'Metronome on or off'], ['Shift + wheel', 'Scroll the keyboard sideways'], ['+, -', 'Faster or slower'], ['Shift', 'Sustain pedal (hold)'], ['?', 'This list'], ['Esc', 'Close'],
      ['Ctrl+Z, Ctrl+Y', 'Undo or redo (Correct notes)'], ['Delete', 'Delete the selected note (Correct notes)'], ['Arrows', 'Move the selected note (Correct notes)'], ['R, L', 'Set the hand of the selected note (Correct notes)']];
    const body = h('dl', { class: 'kbd-list' }, rows.map(([k, t]) => [h('dt', null, k.split(', ').map((x) => h('kbd', { class: 'ds-kbd', text: x }))), h('dd', { text: t })]));
    UI.openDialog('Keyboard shortcuts', body);
  };
  P.about = function () {
    UI.openDialog('About', h('div', { class: 'about' },
      h('p', { class: 'ds-reading', text: 'MarkSteady Wapiro 2.0.0' }),
      h('p', { class: 'ds-caption', text: 'A piano practice app that runs from this one file, offline. Your songs and settings stay in this browser on this device.' })));
  };
})();
