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
    const loopTxt = h('span', { class: 'loop-text' });
    const loopBtn = h('button', { class: 'ds-btn ds-btn--ghost pop-dashed', type: 'button', onclick: () => {
      if (E.opts.loop) E.setOptions({ loop: null });
      else { const cur = E.curMeasure(), last = E.get().measures.length; E.setOptions({ loop: { from: cur, to: Math.min(last, cur + 3) } }); }
    } }, 'Set');
    const loopRow = h('div', { class: 'row-gap loop-row' }, UI.icon('loop'), loopTxt, loopBtn);
    const box = h('div', { class: 'pop-body' }, section(null, h('div', { class: 'row-gap' }, h('div', { style: 'flex:1 1 0;min-width:0' }, speed), reset)), section('Loop', loopRow));
    live = () => {
      const q = E.opts;
      speed.setValue(Math.round(q.speed * 100));
      const l = E.loopRange();
      loopTxt.textContent = l ? (l.from === l.to ? 'Bar ' + l.from : 'Bars ' + l.from + ' to ' + l.to) : 'Off. Set a loop from this bar.';
      loopBtn.textContent = l ? 'Clear' : 'Set';
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
      if (!I.supported) devs.append(h('div', { class: 'ds-help', text: 'MIDI is not available here. Use the desktop app, Chrome or Edge.' }));
      else if (I.error) devs.append(h('div', { class: 'ds-help is-error' }, UI.icon('alert'), I.error));
      else if (!I.devices.length) devs.append(h('div', { class: 'ds-help', text: 'No MIDI keyboard found. Connect one by USB.' }));
      for (const d of I.devices) devs.append(h('div', { class: 'dev-row' }, h('span', { class: 'dev-ok' + (d.state === 'connected' ? '' : ' is-off') }, UI.icon(d.state === 'connected' ? 'check' : 'minus')), h('span', { class: 'ds-control-text dev-name', text: d.name + (d.state === 'connected' ? ' connected' : ' not connected') })));
    };
    drawDevs();
    I.onChange(drawDevs);
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
      sec('Devices', devs, kb, layout(), rebind));
    const sync = () => {
      along.setValue(E.opts.playAlong); metro.setValue(E.opts.metronome);
      vol.querySelector('input').disabled = !E.opts.playAlong; mvol.querySelector('input').disabled = !E.opts.metronome;
    };
    sync(); live = sync;
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
