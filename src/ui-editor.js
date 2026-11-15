/* Correct notes: edit the notes in the waterfall (paused). Tap an empty lane to add, drag to move,
 * drag the top edge to change the length. Every drag has a keyboard alternative. Autosaves. */
(function () {
  'use strict';
  const W = window.Wapiro, E = W.engine, UI = W.ui, h = UI.h, S = W.storage, G = W.geom, WF = W.waterfall, U = W.util;
  const Ed = (W.editor = { active: false, sel: null, grid: 1, hand: 'R', drag: null });
  const GRIDS = [[1, 'Quarter'], [0.5, 'Eighth'], [0.25, 'Sixteenth'], [1 / 3, 'Triplet']];

  const snapDown = (q) => { const g = Ed.grid; return Math.max(0, Math.floor(q / g + 1e-6) * g); };
  const snapNear = (q) => { const g = Ed.grid; return Math.round(q / g) * g; };
  const rd = (v) => Math.round(v * 1e6) / 1e6;
  function respell(n) { const s = E.song, f = s.keySigs.length ? s.keySigs[0].fifths : s.estKey != null ? s.estKey : 0; const sp = U.spellInKey(n.midi, f); n.spelled = U.spell(sp.letter, sp.alter, sp.oct); }

  function rectOf(n) {
    const m = WF.map; if (!m || !G.inRange(n.midi)) return null;
    const kr = G.keyRect(n.midi);
    const yBot = m.h - (n.q - m.q) * m.ppq, yTop = Math.min(yBot - 6, m.h - (n.q + n.durQ - m.q) * m.ppq + 2);
    return { x: kr.x + 1, y: yTop, w: Math.max(3, kr.w - 2), h: yBot - yTop };
  }
  function noteAt(x, y) {
    const notes = E.song.notes;
    let best = null;
    for (const n of notes) { const r = rectOf(n); if (!r) continue; if (x >= r.x - 1 && x <= r.x + r.w + 1 && y >= r.y - 4 && y <= r.y + r.h + 1) { if (!best || G.keyRect(n.midi).black) best = n; } }
    return best;
  }
  const qAt = (y) => WF.map.q + (WF.map.h - y) / WF.map.ppq;

  // ---------------------------------------------------------------- toolbar
  Ed.start = function () {
    if (!E.song || Ed.active) return;
    E.pause();
    if (S.settings.view === 'sheet') W.app.setView('split');
    Ed.active = true; Ed.sel = null;
    const pane = W.shell.el.wfPane;
    const grid = UI.seg('Grid', GRIDS, Ed.grid, (v) => { Ed.grid = v; grid.setValue(v); });
    const hand = UI.seg('Hand for new notes', [['R', 'Right'], ['L', 'Left']], Ed.hand, (v) => { Ed.hand = v; hand.setValue(v); if (Ed.sel) setHand(v); });
    const btn = (icon, label, fn, cls) => h('button', { class: 'ds-btn ds-btn--ghost ds-btn--icon tip ' + (cls || ''), type: 'button', 'aria-label': label, 'data-tip': label, onclick: fn }, UI.icon(icon));
    Ed.bUndo = btn('undo', 'Undo (Ctrl+Z)', () => W.app.undo());
    Ed.bRedo = btn('redo', 'Redo (Ctrl+Y)', () => W.app.redo());
    Ed.bDel = btn('trash', 'Delete note (Delete)', () => del());
    Ed.bRevert = h('button', { class: 'ds-btn ds-btn--ghost', type: 'button', onclick: () => W.app.revertToImported() }, 'Revert to imported');
    Ed.help = h('span', { class: 'ds-caption ed-help', text: 'Tap an empty lane to add a note. Drag a note to move it, or its top edge to change its length.' });
    Ed.bar = h('div', { class: 'editor-bar ds-card', role: 'toolbar', 'aria-label': 'Correct notes' },
      h('span', { class: 'ds-control-text', text: 'Correct notes' }),
      h('span', { class: 'ed-group' }, h('span', { class: 'ds-caption', text: 'Grid' }), grid),
      h('span', { class: 'ed-group' }, h('span', { class: 'ds-caption', text: 'Hand' }), hand),
      Ed.bUndo, Ed.bRedo, Ed.bDel, Ed.bRevert, h('span', { class: 'grow' }),
      h('button', { class: 'ds-btn ds-btn--outline', type: 'button', onclick: () => Ed.stop() }, 'Done'));
    Ed.handSeg = hand;
    pane.appendChild(Ed.bar); pane.appendChild(Ed.help);
    pane.classList.add('is-editing');
    Ed.refresh();
    const rec = S.find(E.song.id);
    if (E.song.exactNotation && rec && !rec.editNoticeShown) {
      rec.editNoticeShown = true;
      UI.toast('Editing changes the notes, so the sheet shows approximate notation after an edit. Revert to imported brings the file back.', null, { ms: 8000 });
    }
    WF.dirty = true;
  };
  Ed.stop = function () {
    if (!Ed.active) return;
    Ed.active = false; Ed.sel = null; Ed.drag = null;
    if (Ed.bar) Ed.bar.remove(); if (Ed.help) Ed.help.remove();
    W.shell.el.wfPane.classList.remove('is-editing');
    S.flush();
    WF.dirty = true;
  };
  Ed.refresh = function () {
    if (!Ed.active) return;
    const rec = E.song && S.find(E.song.id);
    Ed.bUndo.disabled = !W.app.canUndo(); Ed.bRedo.disabled = !W.app.canRedo(); Ed.bDel.disabled = !Ed.sel;
    Ed.bRevert.style.display = rec && rec.original ? '' : 'none';
    WF.dirty = true;
  };
  E.on('song', () => { if (Ed.active && Ed.sel && E.song.notes.indexOf(Ed.sel) < 0) Ed.sel = null; if (Ed.active) Ed.refresh(); });
  E.on('change', () => { if (Ed.active && E.playing) Ed.stop(); });

  // ---------------------------------------------------------------- edits (all through App.editCommit, so undo and autosave apply)
  function del() { const n = Ed.sel; if (!n) return; Ed.sel = null; W.app.editCommit((s) => { const i = s.notes.indexOf(n); if (i >= 0) s.notes.splice(i, 1); }); }
  function setHand(v) { const n = Ed.sel; if (!n || n.hand === v) return; W.app.editCommit(() => { n.hand = v; }); }
  function moveBy(dq, dm, dd) {
    const n = Ed.sel; if (!n) return;
    W.app.editCommit(() => {
      if (dq) n.q = rd(Math.max(0, n.q + dq));
      if (dm) { n.midi = Math.max(21, Math.min(108, n.midi + dm)); respell(n); }
      if (dd) n.durQ = rd(Math.max(Ed.grid, n.durQ + dd));
    });
  }

  Ed.onKey = function (e) {
    if (!Ed.active) return false;
    const k = e.key;
    if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'Z')) { if (e.shiftKey) W.app.redo(); else W.app.undo(); e.preventDefault(); return true; }
    if ((e.ctrlKey || e.metaKey) && (k === 'y' || k === 'Y')) { W.app.redo(); e.preventDefault(); return true; }
    if (k === 'Escape') { if (Ed.sel) { Ed.sel = null; Ed.refresh(); } else Ed.stop(); e.preventDefault(); return true; }
    if (!Ed.sel) return false;
    if (k === 'Delete' || k === 'Backspace') { del(); e.preventDefault(); return true; }
    if (k === 'r' || k === 'R') { setHand('R'); Ed.handSeg.setValue('R'); e.preventDefault(); return true; }
    if (k === 'l' || k === 'L') { setHand('L'); Ed.handSeg.setValue('L'); e.preventDefault(); return true; }
    if (k === 'ArrowUp' || k === 'ArrowDown') { moveBy(0, k === 'ArrowUp' ? 1 : -1, 0); e.preventDefault(); return true; }
    if (k === 'ArrowLeft' || k === 'ArrowRight') { const d = k === 'ArrowRight' ? Ed.grid : -Ed.grid; if (e.shiftKey) moveBy(0, 0, d); else moveBy(d, 0, 0); e.preventDefault(); return true; }
    return false;
  };

  // ---------------------------------------------------------------- pointer
  Ed.bind = function (canvas) {
    canvas.addEventListener('pointerdown', (e) => {
      if (!Ed.active || !E.song || !WF.map) return;
      const r = canvas.getBoundingClientRect(), x = e.clientX - r.left + (G.scrollX || 0), y = e.clientY - r.top;
      e.preventDefault();
      const hit = noteAt(x, y);
      if (!hit) {
        const midi = G.hit(x, 0, 1);
        if (midi == null) return;
        const n = { q: rd(snapDown(qAt(y))), durQ: rd(Ed.grid), midi, hand: Ed.hand, spelled: '' };
        respell(n);
        W.app.editCommit((s) => { s.notes.push(n); });
        Ed.sel = n; Ed.refresh();
        if (W.audio && W.audio.preview) W.audio.preview(midi);
        return;
      }
      Ed.sel = hit; Ed.refresh();
      const rr = rectOf(hit);
      const touch = e.pointerType === 'touch';
      const mode = y <= rr.y + (touch ? 14 : 7) && rr.h > 10 ? 'resize' : 'move';
      Ed.drag = { n: hit, mode, x0: x, y0: y, q: hit.q, midi: hit.midi, durQ: hit.durQ, moved: false, ghost: { q: hit.q, midi: hit.midi, durQ: hit.durQ } };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      const d = Ed.drag; if (!d) { if (Ed.active && WF.map) { const r = canvas.getBoundingClientRect(), y = e.clientY - r.top, x = e.clientX - r.left + (G.scrollX || 0); const n = noteAt(x, y); const rr = n && rectOf(n); canvas.style.cursor = n ? (y <= rr.y + 7 && rr.h > 10 ? 'ns-resize' : 'grab') : 'crosshair'; } return; }
      const r = canvas.getBoundingClientRect(), x = e.clientX - r.left + (G.scrollX || 0), y = e.clientY - r.top;
      if (Math.abs(x - d.x0) + Math.abs(y - d.y0) > 3) d.moved = true;
      const dq = (d.y0 - y) / WF.map.ppq;
      if (d.mode === 'resize') d.ghost.durQ = rd(Math.max(Ed.grid, snapNear(d.durQ + dq)));
      else {
        d.ghost.q = rd(Math.max(0, snapNear(d.q + dq)));
        const m = G.hit(x, 0, 1); if (m != null) d.ghost.midi = m;
      }
      WF.dirty = true;
    });
    const up = () => {
      const d = Ed.drag; if (!d) return;
      Ed.drag = null;
      const g = d.ghost;
      if (d.moved && (g.q !== d.q || g.midi !== d.midi || g.durQ !== d.durQ)) {
        W.app.editCommit(() => { d.n.q = g.q; d.n.durQ = g.durQ; if (d.n.midi !== g.midi) { d.n.midi = g.midi; respell(d.n); } });
        if (g.midi !== d.midi && W.audio && W.audio.preview) W.audio.preview(g.midi);
      }
      WF.dirty = true;
    };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', (e) => {
      if (!Ed.active || E.playing) return;
      e.preventDefault();
      E.seekQ(Math.max(0, E.q + (e.deltaY < 0 ? 1 : -1) * Ed.grid * Math.max(1, Math.round(Math.abs(e.deltaY) / 60))));
    }, { passive: false });
  };

  /** Drawn by the waterfall after the notes. */
  WF.overlay = function (ctx) {
    if (!Ed.active) return;
    const d = Ed.drag;
    const ring = (r, color, wdt) => { ctx.beginPath(); ctx.rect(Math.round(r.x) - 1.5, Math.round(r.y) - 1.5, Math.round(r.w) + 3, Math.round(r.h) + 3); ctx.strokeStyle = color; ctx.lineWidth = wdt; ctx.stroke(); };
    const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    if (d) {
      const r = rectOf(d.ghost); if (r) { ctx.setLineDash([4, 3]); ring(r, css('--primary-ink'), 2); ctx.setLineDash([]); }
    }
    if (Ed.sel) {
      const r = rectOf(Ed.sel);
      if (r) {
        ring(r, css('--ring'), 2);
        // length handle on the top edge
        ctx.fillStyle = css('--card'); ctx.strokeStyle = css('--ring'); ctx.lineWidth = 1.5;
        const hw = Math.min(r.w - 2, 18);
        ctx.beginPath(); ctx.rect(Math.round(r.x + r.w / 2 - hw / 2) + 0.5, Math.round(r.y) - 3.5, Math.round(hw), 6); ctx.fill(); ctx.stroke();
      }
    }
  };
})();
