/* Timeline strip: bar ticks, progress, seek by click or drag, loop band with two drag handles. */
(function () {
  'use strict';
  const W = window.Wapiro, E = W.engine, UI = W.ui, h = UI.h, U = W.util;
  const T = (W.timeline = { el: null, canvas: null, w: 0, h: 28, dirty: true });
  const cache = {};
  const cssVar = (n) => (n in cache ? cache[n] : (cache[n] = getComputedStyle(document.documentElement).getPropertyValue(n).trim()));
  T.themeChanged = () => { for (const k in cache) delete cache[k]; ovKey = ''; T.dirty = true; };

  T.mount = function (host) {
    T.el = host;
    T.canvas = h('canvas', { class: 'tl-canvas', 'aria-hidden': 'true' });
    T.hA = h('div', { class: 'tl-handle ds-reveal', role: 'slider', tabindex: '0', 'aria-label': 'Loop start bar' });
    T.hB = h('div', { class: 'tl-handle ds-reveal', role: 'slider', tabindex: '0', 'aria-label': 'Loop end bar' });
    T.hint = h('div', { class: 'tl-seek', role: 'slider', tabindex: '0', 'aria-label': 'Position in the song' });
    host.append(T.canvas, T.hint, T.hA, T.hB);
    host.classList.add('ds-row');
    new ResizeObserver(() => T.resize()).observe(host);
    U.watchPixels(T.canvas, () => { const p = U.pixelSize(T.canvas, T.canvas.getBoundingClientRect()); if (p.w !== T.canvas.width || p.h !== T.canvas.height) T.resize(); });
    T.resize();
    let drag = null;
    const qAt = (e) => { const r = host.getBoundingClientRect(); const x = Math.max(0, Math.min(r.width, e.clientX - r.left)); return (x / r.width) * E.get().endQ; };
    host.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      if (e.target === T.hA || e.target === T.hB) return;
      host.setPointerCapture(e.pointerId);
      if (e.shiftKey && E.song) { drag = { kind: 'new', q0: qAt(e) }; return; }
      drag = { kind: 'seek' }; E.seekQ(qAt(e));
    });
    host.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (drag.kind === 'seek') E.seekQ(qAt(e));
      else if (drag.kind === 'new') setLoopFromQ(drag.q0, qAt(e));
    });
    const end = () => { drag = null; };
    host.addEventListener('pointerup', end); host.addEventListener('pointercancel', end);
    host.addEventListener('dblclick', (e) => {
      const l = E.loopRange();
      if (!l) return;
      const q = qAt(e);
      if (q >= l.q0 && q <= l.q1) E.setOptions({ loop: null });
    });
    // handles
    for (const [hd, which] of [[T.hA, 'from'], [T.hB, 'to']]) {
      let d = null;
      hd.addEventListener('pointerdown', (e) => { hd.setPointerCapture(e.pointerId); d = true; e.stopPropagation(); });
      hd.addEventListener('pointermove', (e) => {
        if (!d) return;
        const bar = E.measureIndexAt(qAt(e)) + 1;
        const l = E.loopRange();
        if (!l) return;
        let from = l.from, to = l.to;
        if (which === 'from') from = Math.min(to, bar); else to = Math.max(from, bar);
        E.setOptions({ loop: { from, to } });
      });
      hd.addEventListener('pointerup', () => { d = null; });
      hd.addEventListener('keydown', (e) => {
        const l = E.loopRange();
        if (!l || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
        const dlt = e.key === 'ArrowLeft' ? -1 : 1;
        let { from, to } = l;
        if (which === 'from') from = Math.max(1, Math.min(to, from + dlt)); else to = Math.max(from, Math.min(E.get().measures.length, to + dlt));
        E.setOptions({ loop: { from, to } });
        e.preventDefault(); e.stopPropagation();
      });
    }
    T.hint.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { E.prevBar(); e.preventDefault(); e.stopPropagation(); }
      else if (e.key === 'ArrowRight') { E.nextBar(); e.preventDefault(); e.stopPropagation(); }
    });
  };
  function setLoopFromQ(q0, q1) {
    const a = Math.min(q0, q1), b = Math.max(q0, q1);
    E.setOptions({ loop: { from: E.measureIndexAt(a) + 1, to: E.measureIndexAt(b) + 1 } });
  }
  T.resize = function () {
    const r = T.canvas.getBoundingClientRect(), px = U.pixelSize(T.canvas, r);
    T.w = Math.max(1, r.width); T.h = Math.max(1, r.height);
    if (T.canvas.width !== px.w) T.canvas.width = px.w;
    if (T.canvas.height !== px.h) T.canvas.height = px.h;
    T.ctx = T.canvas.getContext('2d'); T.ctx.setTransform(px.w / T.w, 0, 0, px.h / T.h, 0, 0);
    T.dirty = true;
  };

  /** The song's notes drawn once into an offscreen bitmap (pitch upwards, hand colours); redrawn when the notes,
   * the size or the theme change. */
  let ov = null, ovKey = '';
  function overview(notes, endQ, w, y0, oh, scale) {
    let sig = notes.length; for (let i = 0; i < notes.length; i += 7) sig = (sig * 31 + Math.round(notes[i].q * 8) + notes[i].midi) | 0;
    const key = [E.song.id, sig, w, oh, scale, cssVar('--hand-left'), cssVar('--hand-right'), cssVar('--primary')].join('|');
    if (ov && key === ovKey) return ov;
    ovKey = key;
    ov = document.createElement('canvas');
    ov.width = Math.max(1, Math.round(w * scale)); ov.height = Math.max(1, Math.round(oh * scale));
    const c = ov.getContext('2d'); c.setTransform(scale, 0, 0, scale, 0, 0);
    if (!notes.length) return ov;
    let lo = 127, hi = 0; for (const n of notes) { if (n.midi < lo) lo = n.midi; if (n.midi > hi) hi = n.midi; }
    lo -= 1; hi += 1;
    const pad = 3, span = Math.max(12, hi - lo), yOf = (m) => pad + (1 - (m - lo) / span) * (oh - 2 * pad);
    const bar = Math.max(3, (oh - 2 * pad) / span * 1.2);
    const colR = cssVar('--hand-right') || cssVar('--primary'), colL = cssVar('--hand-left');
    for (const hand of ['L', 'R']) {
      c.fillStyle = hand === 'L' ? colL : colR;
      for (const n of notes) {
        if ((n.hand === 'L') !== (hand === 'L')) continue;
        const x = (n.q / endQ) * w, x2 = ((n.q + n.durQ) / endQ) * w;
        c.fillRect(x, yOf(n.midi) - bar / 2, Math.max(1, x2 - x - 0.5), bar);
      }
    }
    return ov;
  }

  T.draw = function (q) {
    const ctx = T.ctx;
    if (!ctx || !E.song) return;
    const { measures, endQ, notes } = E.get();
    const w = T.w, hh = T.h;
    const rowH = 20, y0 = rowH, oh = Math.max(8, hh - rowH - 2); // bar numbers on top, the song overview below
    ctx.clearRect(0, 0, w, hh);
    ctx.fillStyle = cssVar('--muted'); ctx.fillRect(0, 0, w, rowH);
    ctx.fillStyle = cssVar('--roll') || cssVar('--card'); ctx.fillRect(0, y0, w, hh - y0);
    const xq = (v) => (v / endQ) * w;
    const px = xq(Math.max(0, q));
    // played part
    ctx.fillStyle = cssVar('--muted'); ctx.fillRect(0, y0, px, oh);
    // bar lines across the overview
    ctx.strokeStyle = cssVar('--border'); ctx.lineWidth = 1; ctx.beginPath();
    const stepT = Math.max(1, Math.ceil(measures.length / (w / 6)));
    for (let i = 0; i < measures.length; i += stepT) { const x = Math.round(xq(measures[i].q)) + 0.5; ctx.moveTo(x, y0); ctx.lineTo(x, y0 + oh); }
    ctx.moveTo(0, y0 + 0.5); ctx.lineTo(w, y0 + 0.5);
    ctx.stroke();
    // the notes of the whole song
    const scale = T.canvas.width / Math.max(1, w);
    const o = overview(notes || [], endQ, w, y0, oh, scale);
    ctx.drawImage(o, 0, y0, w, oh);
    // loop band
    const l = E.loopRange();
    if (l) {
      const x0 = xq(l.q0), x1 = xq(l.q1);
      ctx.fillStyle = cssVar('--primary'); ctx.globalAlpha = 0.59; ctx.fillRect(x0, y0, x1 - x0, oh); ctx.globalAlpha = 1;
      ctx.fillRect(x0, y0, x1 - x0, 2); ctx.fillRect(x0, y0 + oh - 2, x1 - x0, 2);
    }
    // bar numbers
    const stepN = Math.max(1, Math.ceil(measures.length / Math.max(1, w / 48)));
    ctx.font = '12px ' + cssVar('--font-sans'); ctx.textBaseline = 'middle'; ctx.fillStyle = cssVar('--muted-foreground');
    for (let i = 0; i < measures.length; i += stepN) ctx.fillText(String(i + 1), Math.round(xq(measures[i].q)) + 3, rowH / 2 + 1);
    // current bar: bold accent number and an accent line under its stretch of the bar row
    const ci = Math.max(0, Math.min(measures.length - 1, E.measureIndexAt(q)));
    { const bx = xq(measures[ci].q), bw = xq(ci + 1 < measures.length ? measures[ci + 1].q : endQ) - bx;
      const lab = String(ci + 1); ctx.font = '600 12px ' + cssVar('--font-sans');
      const lw = ctx.measureText(lab).width;
      ctx.fillStyle = cssVar('--muted'); ctx.fillRect(Math.round(bx) + 1, 1, lw + 6, rowH - 3);
      ctx.fillStyle = cssVar('--primary-ink'); ctx.fillText(lab, Math.round(bx) + 3, rowH / 2 + 1);
      ctx.fillRect(Math.round(bx), rowH - 2, Math.max(2, Math.round(bw)), 2); }
    // position marker
    ctx.fillStyle = 'rgba(0, 255, 251, 0.45)'; ctx.fillRect(Math.round(px) - 1, y0, 2, oh);
    ctx.beginPath(); ctx.moveTo(px - 5, y0); ctx.lineTo(px + 5, y0); ctx.lineTo(px, y0 + 6); ctx.closePath(); ctx.fill();
    // handles and slider values
    const place = (hd, x, val, text) => { hd.style.left = x + 'px'; hd.style.display = l ? '' : 'none'; hd.setAttribute('aria-valuenow', String(val)); hd.setAttribute('aria-valuetext', text); };
    if (l) { place(T.hA, xq(l.q0), l.from, 'Bar ' + l.from); place(T.hB, xq(l.q1), l.to, 'Bar ' + l.to); } else { T.hA.style.display = 'none'; T.hB.style.display = 'none'; }
    T.hint.setAttribute('aria-valuenow', String(E.curMeasure())); T.hint.setAttribute('aria-valuetext', 'Bar ' + E.curMeasure() + ' of ' + measures.length);
  };
})();
