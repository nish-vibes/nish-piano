/* Timeline strip: bar ticks, progress, seek by click or drag, loop band with two drag handles. */
(function () {
  'use strict';
  const W = window.Wapiro, E = W.engine, UI = W.ui, h = UI.h;
  const T = (W.timeline = { el: null, canvas: null, w: 0, h: 28, dirty: true });
  const cache = {};
  const cssVar = (n) => (n in cache ? cache[n] : (cache[n] = getComputedStyle(document.documentElement).getPropertyValue(n).trim()));
  T.themeChanged = () => { for (const k in cache) delete cache[k]; T.dirty = true; };

  T.mount = function (host) {
    T.el = host;
    T.canvas = h('canvas', { class: 'tl-canvas', 'aria-hidden': 'true' });
    T.hA = h('div', { class: 'tl-handle ds-reveal', role: 'slider', tabindex: '0', 'aria-label': 'Loop start bar' });
    T.hB = h('div', { class: 'tl-handle ds-reveal', role: 'slider', tabindex: '0', 'aria-label': 'Loop end bar' });
    T.hint = h('div', { class: 'tl-seek', role: 'slider', tabindex: '0', 'aria-label': 'Position in the song' });
    host.append(T.canvas, T.hint, T.hA, T.hB);
    host.classList.add('ds-row');
    new ResizeObserver(() => T.resize()).observe(host);
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
    const r = T.el.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    T.w = Math.max(1, Math.floor(r.width)); T.h = Math.max(1, Math.floor(r.height));
    T.canvas.width = T.w * dpr; T.canvas.height = T.h * dpr;
    T.ctx = T.canvas.getContext('2d'); T.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    T.dirty = true;
  };

  T.draw = function (q) {
    const ctx = T.ctx;
    if (!ctx || !E.song) return;
    const { measures, endQ } = E.get();
    const w = T.w, hh = T.h;
    ctx.clearRect(0, 0, w, hh);
    ctx.fillStyle = cssVar('--card'); ctx.fillRect(0, 0, w, hh);
    const xq = (v) => (v / endQ) * w;
    const ty = hh - 12, th = 8; // track
    const px = xq(q);
    // played part and track outline
    ctx.fillStyle = cssVar('--muted-foreground'); ctx.globalAlpha = 0.35; ctx.fillRect(0, ty, px, th); ctx.globalAlpha = 1;
    ctx.strokeStyle = cssVar('--muted-foreground'); ctx.lineWidth = 1; ctx.strokeRect(0.5, ty + 0.5, w - 1, th - 1);
    // loop band
    const l = E.loopRange();
    if (l) {
      const x0 = xq(l.q0), x1 = xq(l.q1);
      ctx.fillStyle = cssVar('--foreground'); ctx.globalAlpha = 0.2; ctx.fillRect(x0, 0, x1 - x0, hh); ctx.globalAlpha = 1;
      ctx.fillRect(x0, 0, x1 - x0, 2); ctx.fillRect(x0, hh - 2, x1 - x0, 2);
      ctx.fillRect(Math.round(x0), 0, 2, hh); ctx.fillRect(Math.round(x1) - 2, 0, 2, hh);
    }
    // bar ticks and numbers
    ctx.strokeStyle = cssVar('--muted-foreground'); ctx.beginPath();
    const stepT = Math.max(1, Math.ceil(measures.length / (w / 6)));
    const stepN = Math.max(1, Math.ceil(measures.length / Math.max(1, w / 56)));
    ctx.font = '12px ' + cssVar('--font-sans'); ctx.textBaseline = 'top'; ctx.fillStyle = cssVar('--muted-foreground');
    for (let i = 0; i < measures.length; i += stepT) { const x = Math.round(xq(measures[i].q)) + 0.5; ctx.moveTo(x, ty - 3); ctx.lineTo(x, ty + th); }
    ctx.stroke();
    for (let i = 0; i < measures.length; i += stepN) { if (i === 0 || (i + 1) % Math.max(1, stepN) === 0 || stepN === 1) ctx.fillText(String(i + 1), Math.round(xq(measures[i].q)) + 3, 1); }
    // position marker
    ctx.fillStyle = cssVar('--foreground'); ctx.fillRect(Math.round(px) - 1, 0, 2, hh);
    ctx.beginPath(); ctx.moveTo(px - 4, 0); ctx.lineTo(px + 4, 0); ctx.lineTo(px, 5); ctx.closePath(); ctx.fill();
    // handles and slider values
    const place = (hd, x, val, text) => { hd.style.left = x + 'px'; hd.style.display = l ? '' : 'none'; hd.setAttribute('aria-valuenow', String(val)); hd.setAttribute('aria-valuetext', text); };
    if (l) { place(T.hA, xq(l.q0), l.from, 'Bar ' + l.from); place(T.hB, xq(l.q1), l.to, 'Bar ' + l.to); } else { T.hA.style.display = 'none'; T.hB.style.display = 'none'; }
    T.hint.setAttribute('aria-valuenow', String(E.curMeasure())); T.hint.setAttribute('aria-valuetext', 'Bar ' + E.curMeasure() + ' of ' + measures.length);
  };
})();
