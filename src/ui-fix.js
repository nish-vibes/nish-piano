/* Tap to fix: the whole score as read from a scan or PDF, in the import review. Tap a note to hear it and see its
 * name, hand, length and place on the keyboard, then move it by a semitone or an octave, change its length, swap its
 * hand or delete it. Every button has a key: arrows for pitch (Shift = octave), left/right for the next note,
 * [ and ] for length, H for hand, Delete, Ctrl+Z to undo. */
(function () {
  'use strict';
  const W = window.Wapiro, UI = W.ui, h = UI.h, U = W.util;
  const FX = (W.fix = {});
  const LENGTHS = [0.125, 0.25, 0.375, 0.5, 0.75, 1, 1.5, 2, 3, 4];
  const LEN_NAME = { 4: 'whole note', 3: 'dotted half note', 2: 'half note', 1.5: 'dotted quarter note', 1: 'quarter note', 0.75: 'dotted eighth note', 0.5: 'eighth note', 0.375: 'dotted sixteenth note', 0.25: 'sixteenth note', 0.125: 'thirty-second note' };
  const SVGNS = 'http://www.w3.org/2000/svg';

  const keyOf = (song) => (song.keySigs.length ? song.keySigs[0].fifths : song.estKey != null ? song.estKey : 0);
  const lengthName = (d) => LEN_NAME[Math.round(d * 1000) / 1000] || (Math.round(d * 100) / 100) + ' beats';
  function respell(song, n) { const sp = U.spellInKey(n.midi, keyOf(song)); n.spelled = U.spell(sp.letter, sp.alter, sp.oct); }
  function pretty(sp) { return String(sp || '').replace('#', '♯').replace(/(?<=[A-G])b/, '♭').replace('x', '𝄪'); }
  function barOf(song, n) {
    let i = 0; while (i + 1 < song.measures.length && song.measures[i + 1].q <= n.q + 1e-6) i++;
    const m = song.measures[i], ts = song.timeSigs.filter((t) => t.q <= m.q + 1e-6).pop() || { den: 4 };
    return { bar: i + 1, beat: Math.floor((n.q - m.q) / (4 / ts.den) + 1e-6) + 1 };
  }
  function play(midi) {
    const A = W.audio;
    if (!A || !A.noteOn || W.storage.settings.userSound === false) return;
    A.noteOn(midi, 80);
    setTimeout(() => A.noteOff(midi), 450);
  }

  /** A two-octave keyboard with one key lit, so the note's place is visible at a glance. */
  function miniKeys(midi, hand) {
    const base = Math.floor(midi / 12) * 12 - (midi % 12 < 6 ? 12 : 0);
    const svg = document.createElementNS(SVGNS, 'svg');
    const W1 = 14, H1 = 44, whites = [0, 2, 4, 5, 7, 9, 11];
    svg.setAttribute('viewBox', '0 0 ' + W1 * 14 + ' ' + H1); svg.setAttribute('class', 'fix-keys'); svg.setAttribute('aria-hidden', 'true');
    const rect = (x, y, w, hh, cls) => { const r = document.createElementNS(SVGNS, 'rect'); r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', w); r.setAttribute('height', hh); r.setAttribute('rx', 1.5); r.setAttribute('class', cls); svg.appendChild(r); };
    for (let o = 0; o < 2; o++) whites.forEach((pc, i) => rect((o * 7 + i) * W1 + 0.5, 0.5, W1 - 1, H1 - 1, 'fk-w' + (base + o * 12 + pc === midi ? ' is-lit is-' + hand : '')));
    for (let o = 0; o < 2; o++) [[1, 1], [3, 2], [6, 4], [8, 5], [10, 6]].forEach(([pc, after]) => rect((o * 7 + after) * W1 - 4.5, 0.5, 9, H1 * 0.6, 'fk-b' + (base + o * 12 + pc === midi ? ' is-lit is-' + hand : '')));
    const c = document.createElementNS(SVGNS, 'text'); c.setAttribute('x', 3); c.setAttribute('y', H1 - 5); c.setAttribute('class', 'fk-label'); c.textContent = 'C' + (base / 12 - 1);
    svg.appendChild(c);
    return svg;
  }

  /** Mount the fix view. opts.onChange() runs after every change to the notes. Returns { redraw, select, selected }. */
  FX.mount = function (box, song, opts) {
    opts = opts || {};
    let sel = null, svg = null, ring = null;
    const undo = [];
    const scroller = h('div', { class: 'fix-score', tabindex: '0', role: 'group', 'aria-label': 'The music as read. Tap a note to fix it, or use the arrow keys.' });
    const panel = h('div', { class: 'fix-panel', 'aria-live': 'polite' });
    box.append(scroller, panel);

    const changed = () => { song.exactNotation = false; U.sortNotes(song.notes); song.notation = W.notation.fromNotes(song); song.fixes = undo.length; if (opts.onChange) opts.onChange(); draw(); };
    const remember = () => { if (sel) undo.push({ n: sel, midi: sel.midi, spelled: sel.spelled, durQ: sel.durQ, hand: sel.hand, at: song.notes.indexOf(sel) }); };
    const act = {
      pitch: (d) => { if (!sel) return; const m = sel.midi + d; if (m < 21 || m > 108) return; remember(); sel.midi = m; respell(song, sel); play(m); changed(); },
      length: (dir) => {
        if (!sel) return;
        const i = LENGTHS.findIndex((l) => l > sel.durQ - 1e-6);
        const cur = i < 0 ? LENGTHS.length - 1 : Math.abs(LENGTHS[i] - sel.durQ) < 1e-6 ? i : dir > 0 ? i - 1 : i;
        const next = LENGTHS[Math.max(0, Math.min(LENGTHS.length - 1, cur + dir))];
        if (Math.abs(next - sel.durQ) < 1e-6) return;
        remember(); sel.durQ = next; changed();
      },
      hand: () => { if (!sel) return; remember(); sel.hand = sel.hand === 'R' ? 'L' : 'R'; changed(); },
      del: () => {
        if (!sel) return;
        remember(); const i = song.notes.indexOf(sel);
        const nextSel = song.notes[i + 1] || song.notes[i - 1] || null;
        song.notes.splice(i, 1); sel = nextSel; changed();
      },
      undo: () => {
        const u = undo.pop(); if (!u) return;
        if (!song.notes.includes(u.n)) song.notes.splice(Math.min(u.at, song.notes.length), 0, u.n);
        Object.assign(u.n, { midi: u.midi, spelled: u.spelled, durQ: u.durQ, hand: u.hand });
        sel = u.n; changed();
      },
      step: (d) => {
        const order = svg ? svg.hits.slice().sort((a, b) => a.n.q - b.n.q || a.n.midi - b.n.midi).map((x) => x.n).filter((n, i, a) => a.indexOf(n) === i) : [];
        if (!order.length) return;
        const i = sel ? order.indexOf(sel) : -1;
        select(order[Math.max(0, Math.min(order.length - 1, i < 0 ? 0 : i + d))], true);
      },
    };

    function draw() {
      const top = scroller.scrollTop;
      scroller.textContent = '';
      const w = Math.max(320, (scroller.clientWidth || box.clientWidth || 640) - 2);
      svg = W.sheet.fixView(song, w, 8);
      scroller.appendChild(svg);
      svg.addEventListener('click', (e) => {
        const r = svg.getBoundingClientRect(), lay = svg.lay;
        const x = (e.clientX - r.left) * (lay.width / r.width), y = (e.clientY - r.top) * (lay.height / r.height);
        let best = null, bd = Infinity;
        for (const hit of svg.hits) { const d = Math.hypot(hit.x - x, (hit.y - y) * 1.3); if (d < bd) { bd = d; best = hit; } }
        if (best && bd < 2.2 * lay.S) select(best.n, false); else select(null);
      });
      scroller.scrollTop = top;
      if (sel && !song.notes.includes(sel)) sel = null;
      mark(false);
      drawPanel();
    }
    function mark(scroll) {
      if (ring) { ring.remove(); ring = null; }
      if (!sel || !svg) return;
      const hit = svg.hits.find((x) => x.n === sel);
      if (!hit) return;
      ring = document.createElementNS(SVGNS, 'circle');
      ring.setAttribute('cx', hit.x); ring.setAttribute('cy', hit.y); ring.setAttribute('r', 1.25 * svg.lay.S);
      ring.setAttribute('class', 'fix-ring is-' + sel.hand);
      svg.appendChild(ring);
      if (scroll) {
        const k = svg.getBoundingClientRect().height / svg.lay.height || 1, y = hit.y * k;
        if (y < scroller.scrollTop + 20 || y > scroller.scrollTop + scroller.clientHeight - 20) scroller.scrollTop = Math.max(0, y - scroller.clientHeight / 2);
      }
    }
    function select(n, scroll) {
      sel = n;
      if (n) play(n.midi);
      mark(scroll);
      drawPanel();
    }
    function drawPanel() {
      // the panel is rebuilt after every change: keep the keyboard focus on the same button (or the score)
      const a = document.activeElement, had = a && box.contains(a) ? (a.getAttribute('aria-label') || a.title || 'score') : null;
      paint();
      if (!had) return;
      const again = had === 'score' ? null : [...panel.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || x.title) === had && !x.disabled);
      (again || scroller).focus({ preventScroll: true });
    }
    function paint() {
      panel.textContent = '';
      const b = (icon, label, fn, key, extra) => h('button', Object.assign({ class: 'ds-btn ds-btn--outline fix-btn', type: 'button', onclick: fn, 'aria-keyshortcuts': key || null, title: label + (key ? ' (' + key + ')' : '') }, extra || {}), icon ? UI.icon(icon) : null, h('span', { text: label }));
      const ib = (icon, label, fn, key) => h('button', { class: 'ds-btn ds-btn--ghost ds-btn--icon', type: 'button', 'aria-label': label, 'aria-keyshortcuts': key, title: label + ' (' + key.replace('ArrowDown', '↓').replace('ArrowUp', '↑') + ')', onclick: fn }, UI.icon(icon));
      const stepper = (text, down, up, dl, ul, dk, uk) => h('span', { class: 'fix-step' }, ib('minus', dl, down, dk), h('span', { class: 'fix-step-text', text }), ib('plus', ul, up, uk));
      const nav = h('div', { class: 'fix-nav' },
        h('button', { class: 'ds-btn ds-btn--ghost ds-btn--icon', type: 'button', 'aria-label': 'Previous note (Left arrow)', title: 'Previous note (←)', onclick: () => act.step(-1) }, UI.icon('prev')),
        h('button', { class: 'ds-btn ds-btn--ghost ds-btn--icon', type: 'button', 'aria-label': 'Next note (Right arrow)', title: 'Next note (→)', onclick: () => act.step(1) }, UI.icon('next')));
      const undoBtn = h('button', { class: 'ds-btn ds-btn--ghost', type: 'button', disabled: undo.length ? null : true, onclick: act.undo, title: 'Undo (Ctrl+Z)' }, UI.icon('undo'), 'Undo');
      if (!sel) {
        panel.append(h('div', { class: 'fix-empty' }, h('span', { class: 'ds-help', text: 'Tap a note to hear it and fix it. The arrow keys work too.' }), h('span', { class: 'grow' }), undoBtn, nav));
        return;
      }
      const where = barOf(song, sel);
      panel.append(
        h('div', { class: 'fix-id' },
          h('div', { class: 'fix-name', text: pretty(sel.spelled) }),
          h('div', { class: 'ds-caption', text: (sel.hand === 'R' ? 'Right hand' : 'Left hand') + ' · ' + lengthName(sel.durQ) + ' · bar ' + where.bar + ', beat ' + where.beat }),
          miniKeys(sel.midi, sel.hand)),
        h('div', { class: 'fix-actions' },
          h('div', { class: 'fix-group', role: 'group', 'aria-label': 'Pitch' }, h('span', { class: 'ds-caption', text: 'Pitch' }),
            stepper('Semitone', () => act.pitch(-1), () => act.pitch(1), 'Down a semitone', 'Up a semitone', 'ArrowDown', 'ArrowUp'),
            stepper('Octave', () => act.pitch(-12), () => act.pitch(12), 'Down an octave', 'Up an octave', 'Shift+ArrowDown', 'Shift+ArrowUp')),
          h('div', { class: 'fix-group', role: 'group', 'aria-label': 'Length' }, h('span', { class: 'ds-caption', text: 'Length' }),
            stepper(lengthName(sel.durQ).replace(' note', ''), () => act.length(-1), () => act.length(1), 'Shorter', 'Longer', '[', ']')),
          h('div', { class: 'fix-group' },
            b(null, sel.hand === 'R' ? 'Move to left hand' : 'Move to right hand', act.hand, 'H'),
            b('trash', 'Delete', act.del, 'Delete', { class: 'ds-btn ds-btn--outline fix-btn fix-del' }))),
        h('div', { class: 'fix-foot' }, undoBtn, h('span', { class: 'grow' }), nav));
    }
    box.addEventListener('keydown', (e) => {
      if (e.target.closest && e.target.closest('input, select, textarea')) return;
      const k = e.key;
      let done = true;
      if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') act.undo();
      else if (k === 'ArrowUp') act.pitch(e.shiftKey ? 12 : 1);
      else if (k === 'ArrowDown') act.pitch(e.shiftKey ? -12 : -1);
      else if (k === 'ArrowRight') act.step(1);
      else if (k === 'ArrowLeft') act.step(-1);
      else if (k === ']') act.length(1);
      else if (k === '[') act.length(-1);
      else if (k.toLowerCase() === 'h') act.hand();
      else if (k === 'Delete' || k === 'Backspace') act.del();
      else if (k === 'Escape' && sel) select(null);
      else done = false;
      if (done) { e.preventDefault(); e.stopPropagation(); }
    });
    requestAnimationFrame(draw);
    return { redraw: draw, select: (n) => select(n, true), selected: () => sel, act };
  };
})();
