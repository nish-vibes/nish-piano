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
    const mode = UI.seg('Mode', [['practice', 'Practice'], ['listen', 'Listen']], o.mode, (v) => E.setOptions({ mode: v }));
    const wait = UI.switchBtn('Wait for me', o.wait, (v) => E.setOptions({ wait: v, countIn: null }), 'The notes stop until you play them.');
    const hands = UI.seg('Hands', [['both', 'Both'], ['R', 'Right'], ['L', 'Left']], o.hands, (v) => E.setOptions({ hands: v }));
    const bpmText = (v) => Math.round(v * 100) + '% · ' + Math.round(E.bpmAt(E.q) * v) + ' BPM';
    const speed = UI.slider('Speed', 25, 150, 5, Math.round(o.speed * 100), (v) => E.setOptions({ speed: v / 100 }), (v) => bpmText(v / 100));
    const loopSw = UI.switchBtn('Loop', !!o.loop, (v) => {
      if (!v) E.setOptions({ loop: null });
      else { const cur = E.curMeasure(), last = E.get().measures.length; E.setOptions({ loop: { from: cur, to: Math.min(last, cur + 3) } }); }
    });
    const loopTxt = h('span', { class: 'ds-caption' });
    const loopClear = h('button', { class: 'ds-btn ds-btn--outline', type: 'button', onclick: () => E.setOptions({ loop: null }) }, 'Clear');
    const loopRow = h('div', { class: 'row-between loop-row' }, loopTxt, loopClear);
    const metro = UI.switchBtn('Metronome', o.metronome, (v) => E.setOptions({ metronome: v }));
    const countIn = UI.switchBtn('Count-in', E.effectiveCountIn(), (v) => E.setOptions({ countIn: v }), 'One bar of clicks before play starts.');
    const restart = UI.seg('Restart bar after mistakes', [[0, 'Off'], [2, '2'], [3, '3'], [5, '5'], [10, '10']], o.restartAfter, (v) => E.setOptions({ restartAfter: v }));
    const box = h('div', { class: 'pop-body' },
      section('Mode', mode), section(null, wait), section('Hands', hands), section(null, speed),
      section(null, loopSw, loopRow), section(null, metro), section(null, countIn),
      section('Restart bar after mistakes', restart));
    live = () => {
      const q = E.opts;
      mode.setValue(q.mode); wait.setValue(q.wait); hands.setValue(q.hands); speed.setValue(Math.round(q.speed * 100));
      loopSw.setValue(!!q.loop); metro.setValue(q.metronome); countIn.setValue(E.effectiveCountIn()); restart.setValue(q.restartAfter);
      const l = E.loopRange();
      loopRow.style.display = l ? '' : 'none';
      loopTxt.textContent = l ? (l.from === l.to ? 'Bar ' + l.from : 'Bars ' + l.from + ' to ' + l.to) : '';
    };
    live();
    return UI.openPopover(anchor, box, { label: 'Practice options', onClose: () => { live = null; } });
  };

  P.sound = function (anchor) {
    const st = S.settings, A = W.audio;
    const vol = UI.slider('Volume', 0, 100, 1, Math.round(st.volume * 100), (v) => { st.volume = v / 100; A.volume = st.volume; A.applyVolumes(); S.saveSettings(); }, (v) => v + '%');
    const acc = UI.slider('Accompaniment volume', 0, 100, 1, Math.round(st.accVolume * 100), (v) => { st.accVolume = v / 100; A.accVolume = st.accVolume; A.applyVolumes(); S.saveSettings(); }, (v) => v + '%');
    const mute = UI.switchBtn('Mute', st.mute, (v) => { st.mute = v; A.mute = v; A.applyVolumes(); mute.setValue(v); S.saveSettings(); });
    const mine = UI.switchBtn('Play sound for my notes', st.userSound, (v) => { st.userSound = v; mine.setValue(v); S.saveSettings(); }, 'Turn this off if your keyboard makes its own sound.');
    const inst = UI.seg('Instrument', [['piano', 'Piano'], ['epiano', 'Electric piano'], ['organ', 'Organ']], st.instrument, (v) => { st.instrument = v; A.instrument = v; inst.setValue(v); S.saveSettings(); });
    const devs = h('div', { class: 'dev-list' });
    const drawDevs = () => {
      devs.textContent = '';
      const I = W.input;
      if (!I.supported) devs.append(h('div', { class: 'ds-help', text: 'This browser has no Web MIDI. Use Chrome or Edge.' }));
      else if (I.error) devs.append(h('div', { class: 'ds-help is-error' }, UI.icon('alert'), I.error));
      else if (!I.devices.length) devs.append(h('div', { class: 'ds-help', text: 'No MIDI keyboard found. Connect one by USB.' }));
      for (const d of I.devices) devs.append(h('div', { class: 'row-between dev-row' }, h('span', { class: 'ds-control-text dev-name', text: d.name }), h('span', { class: 'ds-badge ' + (d.state === 'connected' ? 'ds-badge--success' : '') }, d.state === 'connected' ? UI.icon('check') : null, d.state === 'connected' ? 'Connected' : 'Not connected')));
    };
    drawDevs();
    W.input.onChange(drawDevs);
    const kb = UI.switchBtn('Computer-keyboard notes', st.kbdNotes, (v) => { st.kbdNotes = v; kb.setValue(v); if (!v) W.input.releaseAll(); S.saveSettings(); }, 'Z to M and Q to P play notes. Letter shortcuts are off while this is on.');
    const all = UI.switchBtn('Show all 88 keys', st.showAll, (v) => { st.showAll = v; all.setValue(v); S.saveSettings(); W.app.relayoutKeyboard(); });
    const box = h('div', { class: 'pop-body' }, section(null, vol), section(null, acc), section(null, mute), section(null, mine), section('Instrument', inst),
      section('MIDI devices', devs), section(null, kb), section(null, all));
    live = null;
    return UI.openPopover(anchor, box, { label: 'Sound and devices' });
  };

  P.more = function (anchor) {
    const item = (text, fn) => h('button', { class: 'menu-item', role: 'menuitem', type: 'button', onclick: () => { UI.closePopover(false); fn(); } }, text);
    const cur = S.settings.appearance;
    const apps = [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark'], ['light-hc', 'Light, increased contrast'], ['dark-hc', 'Dark, increased contrast']];
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
      ['H', 'Change hands'], ['V', 'Next view'], ['M', 'Metronome on or off'], ['+, -', 'Faster or slower'], ['Shift', 'Sustain pedal (hold)'], ['?', 'This list'], ['Esc', 'Close'],
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
