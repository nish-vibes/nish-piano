/* App shell: top bar, stage, split view, keyboard, frame loop, idle fade, keyboard shortcuts. */
(function () {
  'use strict';
  const W = window.Wapiro, E = W.engine, UI = W.ui, h = UI.h, S = W.storage, K = W.keyboard, WF = W.waterfall, SH = W.sheet, T = W.timeline;
  const Sh = (W.shell = { el: {}, dirty: { wf: true, sheet: true, tl: true } });
  const el = Sh.el;
  const VIEWS = [['waterfall', 'Waterfall'], ['sheet', 'Sheet'], ['split', 'Split']];

  Sh.build = function (root) {
    root.textContent = '';
    el.root = root;
    root.classList.add('app');
    // top bar
    el.title = h('span', { class: 'tb-title', text: '' });
    el.badge = h('span', { class: 'ds-badge', text: '' });
    el.titleBtn = h('button', { class: 'title-btn ds-btn ds-btn--ghost', type: 'button', 'aria-haspopup': 'dialog', 'aria-label': 'Library: open a song', onclick: () => W.library.open() }, UI.icon('music'), el.title, el.badge);
    const iconBtn = (name, label, fn, extra) => h('button', Object.assign({ class: 'ds-btn ds-btn--icon ds-btn--ghost tip', type: 'button', 'aria-label': label, 'data-tip': label, onclick: fn }, extra || {}), UI.icon(name));
    el.restart = iconBtn('restart', 'Restart', () => E.restart());
    el.prev = iconBtn('prev', 'Previous bar', () => E.prevBar());
    el.next = iconBtn('next', 'Next bar', () => E.nextBar());
    el.play = h('button', { class: 'ds-btn ds-btn--primary play-btn', type: 'button', 'aria-label': 'Play', onclick: () => W.app.togglePlay() }, UI.icon('play'));
    el.counter = h('span', { class: 'bar-counter ds-tabular', text: 'Bar 1 of 1' });
    el.views = h('div', { class: 'ds-tabs view-switch', role: 'group', 'aria-label': 'View' }, VIEWS.map(([v, t]) => h('button', { class: 'ds-tab', type: 'button', 'aria-pressed': 'false', 'data-view': v, onclick: () => W.app.setView(v) }, t)));
    el.bPractice = iconBtn('sliders', 'Practice options', () => W.popovers.practice(el.bPractice), { 'aria-haspopup': 'dialog', 'aria-expanded': 'false' });
    el.bSound = iconBtn('speaker', 'Sound and devices', () => W.popovers.sound(el.bSound), { 'aria-haspopup': 'dialog', 'aria-expanded': 'false' });
    el.bMore = iconBtn('more', 'More', () => W.popovers.more(el.bMore), { 'aria-haspopup': 'menu', 'aria-expanded': 'false' });
    el.topbar = h('header', { class: 'topbar' },
      h('div', { class: 'tb-left chrome' }, el.titleBtn),
      h('div', { class: 'tb-center' }, h('span', { class: 'chrome tb-group' }, el.restart, el.prev), el.play, h('span', { class: 'chrome tb-group' }, el.next), el.counter),
      h('div', { class: 'tb-right chrome' }, el.views, el.bPractice, el.bSound, el.bMore));
    el.timeline = h('div', { class: 'timeline chrome' });
    // stage
    el.wfCanvas = h('canvas', { class: 'wf-canvas', 'aria-label': 'Waterfall of falling notes', role: 'img' });
    el.zoom = UI.seg('Look-ahead', [[1, '1 bar'], [2, '2 bars'], [4, '4 bars']], S.settings.lookBars, (v) => Sh.setLook(v));
    el.zoom.classList.add('wf-zoom', 'ds-reveal');
    el.wfPane = h('section', { class: 'pane pane-wf ds-row' }, el.wfCanvas, el.zoom);
    el.badgeApprox = h('span', { class: 'ds-badge', text: '' });
    el.sizeDown = h('button', { class: 'ds-btn ds-btn--ghost ds-reveal tip', type: 'button', 'aria-label': 'Smaller staff', 'data-tip': 'Smaller staff', onclick: () => Sh.setStaff(S.settings.staffSize - 1) }, 'A-');
    el.sizeUp = h('button', { class: 'ds-btn ds-btn--ghost ds-reveal tip', type: 'button', 'aria-label': 'Larger staff', 'data-tip': 'Larger staff', onclick: () => Sh.setStaff(S.settings.staffSize + 1) }, 'A+');
    el.sheetHead = h('div', { class: 'sheet-head' }, el.badgeApprox, h('span', { class: 'grow' }), el.sizeDown, el.sizeUp);
    el.sheetScroll = h('div', { class: 'sheet-scroll', tabindex: '-1' });
    el.sheetPane = h('section', { class: 'pane pane-sheet ds-row' }, el.sheetHead, el.sheetScroll);
    el.handle = h('div', { class: 'split-handle ds-row', role: 'separator', 'aria-orientation': 'horizontal', 'aria-label': 'Resize the sheet and waterfall', tabindex: '0' }, h('span', { class: 'split-grip ds-reveal' }));
    el.stage = h('main', { class: 'stage' }, el.sheetPane, el.handle, el.wfPane);
    el.keys = h('div', { class: 'keys', role: 'group', 'aria-label': 'Piano keyboard' });
    el.keysWrap = h('footer', { class: 'keys-wrap' }, el.keys);
    root.append(el.topbar, el.timeline, el.stage, el.keysWrap);
    UI.mountToasts(root);

    K.mount(el.keys); WF.mount(el.wfCanvas); W.editor.bind(el.wfCanvas); SH.mount(el.sheetScroll); T.mount(el.timeline);
    Sh.bindResize(); Sh.bindSplit(); Sh.bindIdle(); Sh.bindKeys();
    E.on('change', onChange); E.on('seek', mark); E.on('song', onSong); E.on('wrap', mark); E.on('result', mark); E.on('finish', mark);
    E.on('key', () => { Sh.dirty.wf = true; });
    onChange();
  };
  const mark = () => { Sh.dirty.wf = Sh.dirty.sheet = Sh.dirty.tl = true; };

  function onChange() {
    const p = E.playing;
    el.play.setAttribute('aria-label', p ? 'Pause' : 'Play');
    el.play.textContent = '';
    el.play.append(UI.icon(p ? 'pause' : 'play'));
    el.root.classList.toggle('is-playing', p);
    if (!p) Sh.wake();
    else Sh.wake();
    mark();
  }
  function onSong() {
    const s = E.song;
    el.title.textContent = s.title;
    el.badge.textContent = W.app.sourceLabel(s);
    const approx = s.notation && s.notation.approximate;
    el.badgeApprox.textContent = approx ? (s.source === 'midi' ? 'Approximate notation (from MIDI)' : s.source === 'builtin' ? 'Approximate notation (built-in excerpt)' : s.source === 'v1' ? 'Approximate notation (from version 1)' : 'Approximate notation (edited)') : s.source === 'pdf' ? 'Notation rebuilt from the PDF' : 'Notation from the MusicXML file';
    Sh.relayoutAll();
  }

  Sh.setLook = (v) => { S.settings.lookBars = v; WF.setLookBars(v); el.zoom.setValue(v); S.saveSettings(); };
  Sh.setStaff = (v) => { v = Math.max(7, Math.min(18, v)); S.settings.staffSize = v; S.saveSettings(); Sh.layoutSheet(); };

  Sh.applyView = function () {
    const v = S.settings.view;
    el.root.dataset.view = v;
    el.views.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
    const f = Math.max(0.2, Math.min(0.8, S.settings.split));
    el.sheetPane.style.flex = v === 'split' ? f + ' 1 0' : '1 1 0';
    el.wfPane.style.flex = v === 'split' ? 1 - f + ' 1 0' : '1 1 0';
    el.handle.setAttribute('aria-valuenow', String(Math.round(f * 100)));
    requestAnimationFrame(() => { Sh.resizeAll(); });
  };

  Sh.layoutSheet = function () {
    if (!E.song) return;
    const w = el.sheetScroll.clientWidth, hgt = el.sheetScroll.clientHeight;
    if (!w || !hgt) { Sh.pendingSheet = true; return; }
    Sh.pendingSheet = false;
    let size = S.settings.staffSize;
    SH.layout(w, size);
    // In Split the pane must show a whole system: shrink the staff (down to 7) until the tallest system fits
    if (S.settings.view === 'split') {
      const tallest = () => SH.lay.systems.reduce((m, s) => Math.max(m, s.bottom - s.top), 0) + 2 * size;
      while (size > 7 && tallest() > hgt) { size--; SH.layout(w, size); }
    }
    Sh.effSize = size;
    el.sheetScroll.scrollTop = 0;
    SH.update(E.q, true);
    mark();
  };
  Sh.relayoutKeyboard = function () {
    if (!E.song) return;
    const [lo, hi] = W.geom.rangeFor(E.song, S.settings.showAll);
    K.layout(lo, hi);
    WF.dirty = true; mark();
  };
  Sh.relayoutAll = function () {
    Sh.relayoutKeyboard(); Sh.layoutSheet(); WF.resize(); T.resize(); mark();
  };
  Sh.resizeAll = function () { WF.resize(); T.resize(); if (el.sheetScroll.clientWidth !== Sh.lastSheetW || el.sheetScroll.clientHeight !== Sh.lastSheetH) { Sh.lastSheetW = el.sheetScroll.clientWidth; Sh.lastSheetH = el.sheetScroll.clientHeight; Sh.layoutSheet(); } if (el.keys.clientWidth !== Sh.lastKeysW) { Sh.lastKeysW = el.keys.clientWidth; Sh.relayoutKeyboard(); } mark(); };
  Sh.bindResize = function () {
    let t = null;
    const go = () => { clearTimeout(t); t = setTimeout(() => Sh.resizeAll(), 60); };
    new ResizeObserver(go).observe(el.stage); new ResizeObserver(go).observe(el.keysWrap);
    window.addEventListener('resize', go);
  };

  Sh.bindSplit = function () {
    let drag = false;
    const set = (f) => { S.settings.split = Math.max(0.2, Math.min(0.8, f)); S.saveSettings(); Sh.applyView(); };
    el.handle.addEventListener('pointerdown', (e) => { drag = true; el.handle.setPointerCapture(e.pointerId); e.preventDefault(); });
    el.handle.addEventListener('pointermove', (e) => { if (!drag) return; const r = el.stage.getBoundingClientRect(); set((e.clientY - r.top) / r.height); });
    const up = () => { drag = false; };
    el.handle.addEventListener('pointerup', up); el.handle.addEventListener('pointercancel', up);
    el.handle.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') { set(S.settings.split - 0.05); e.preventDefault(); e.stopPropagation(); }
      else if (e.key === 'ArrowDown') { set(S.settings.split + 0.05); e.preventDefault(); e.stopPropagation(); }
    });
  };

  // ---- chrome fades out while playing
  let idleTimer = null;
  Sh.wake = function () {
    el.root.classList.remove('is-idle');
    clearTimeout(idleTimer);
    if (E.playing) idleTimer = setTimeout(() => { if (E.playing && !UI.popoverEl() && !UI.dialogOpen()) el.root.classList.add('is-idle'); }, 2500);
  };
  Sh.bindIdle = function () {
    const wake = () => Sh.wake();
    el.root.addEventListener('pointermove', wake); el.root.addEventListener('pointerdown', wake); el.root.addEventListener('focusin', wake);
    document.addEventListener('keydown', wake);
    // on touch, a tap on the stage shows or hides the chrome while playing
    let down = null;
    el.stage.addEventListener('pointerdown', (e) => { down = e.pointerType === 'touch' ? { x: e.clientX, y: e.clientY } : null; });
    el.stage.addEventListener('pointerup', (e) => {
      if (!down || !E.playing) return;
      if (Math.abs(e.clientX - down.x) < 8 && Math.abs(e.clientY - down.y) < 8) {
        if (el.root.classList.contains('is-idle')) Sh.wake(); else { clearTimeout(idleTimer); el.root.classList.add('is-idle'); }
      }
      down = null;
    });
  };

  // ---- keyboard shortcuts
  Sh.bindKeys = function () {
    const I = W.input;
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Shift' && !e.repeat) { E.pedal(true); return; }
      const t = e.target, tag = t && t.tagName;
      const typing = tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && t.type !== 'range' && t.type !== 'checkbox' && t.type !== 'file');
      if (typing) return;
      if (UI.dialogOpen()) { if (e.key === 'Escape') { UI.closeDialog(); e.preventDefault(); } return; }
      if (W.editor && W.editor.onKey(e)) return;
      if (e.key === 'Escape') { if (UI.closePopover(true)) e.preventDefault(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (I.keyDown(e)) { e.preventDefault(); return; }
      const inPop = t && t.closest && t.closest('.popover');
      const range = tag === 'INPUT' && t.type === 'range';
      const kl = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const lettersOn = !S.settings.kbdNotes;
      let used = true;
      if (e.key === ' ' || e.code === 'Space') { if (inPop && tag === 'BUTTON') return; W.app.togglePlay(); }
      else if (e.key === 'Home') E.restart();
      else if (e.key === 'ArrowLeft' && !range) E.prevBar();
      else if (e.key === 'ArrowRight' && !range) E.nextBar();
      else if (e.key === '?') W.popovers.shortcuts();
      else if (e.key === '+' || e.key === '=') E.setOptions({ speed: Math.min(1.5, E.opts.speed + 0.05) });
      else if (e.key === '-' || e.key === '_') E.setOptions({ speed: Math.max(0.25, E.opts.speed - 0.05) });
      else if (lettersOn && kl === 'l') W.app.toggleLoop();
      else if (lettersOn && kl === 'w') E.setOptions({ wait: !E.opts.wait, countIn: null });
      else if (lettersOn && kl === 'h') E.setOptions({ hands: { both: 'R', R: 'L', L: 'both' }[E.opts.hands] });
      else if (lettersOn && kl === 'v') W.app.setView({ waterfall: 'sheet', sheet: 'split', split: 'waterfall' }[S.settings.view]);
      else if (lettersOn && kl === 'm') E.setOptions({ metronome: !E.opts.metronome });
      else used = false;
      if (used) e.preventDefault();
    });
    document.addEventListener('keyup', (e) => {
      if (e.key === 'Shift') E.pedal(false);
      else if (I.keyUp(e)) e.preventDefault();
      else if ((e.key === ' ' || e.code === 'Space') && !(e.target.closest && e.target.closest('.popover'))) e.preventDefault();
    });
    window.addEventListener('blur', () => { E.pedal(false); I.releaseAll(); });
  };

  // ---- frame loop
  let lastQ = -1, lastBar = '', lastMissed = -1, lastRes = '';
  Sh.frame = function () {
    requestAnimationFrame(Sh.frame);
    if (!E.song) return;
    const playing = E.playing;
    const q = playing ? E.liveQ() : E.q;
    const view = S.settings.view;
    const moved = q !== lastQ; lastQ = q;
    if (view !== 'sheet' && (Sh.dirty.wf || WF.dirty || playing)) { WF.draw(q); Sh.dirty.wf = false; WF.dirty = false; }
    if (view !== 'waterfall' && SH.lay && (Sh.dirty.sheet || moved)) { SH.update(q); Sh.dirty.sheet = false; }
    if (view !== 'waterfall' && SH.lay && E.stats.missed !== lastMissed) { lastMissed = E.stats.missed; SH.updateMisses(); }
    if (Sh.dirty.tl || T.dirty || moved) { T.draw(q); Sh.dirty.tl = false; T.dirty = false; }
    K.update();
    const mi = E.measureIndexAt(q) + 1;
    const txt = 'Bar ' + mi + ' of ' + E.get().measures.length;
    if (txt !== lastBar) { lastBar = txt; el.counter.textContent = txt; }
    void lastRes;
  };
  Sh.start = () => requestAnimationFrame(Sh.frame);
  Sh.themeChanged = () => { WF.themeChanged(); T.themeChanged(); mark(); };
})();
