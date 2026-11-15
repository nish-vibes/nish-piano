/* Waterfall: falling bars aligned to the keys. Canvas, redrawn only when something changed. */
(function () {
  'use strict';
  const W = window.Wapiro, E = W.engine, G = W.geom;
  const WF = (W.waterfall = { canvas: null, ctx: null, w: 0, h: 0, dirty: true, colors: null, lookBars: 2 });
  const cache = {};
  function cssVar(n) { if (!(n in cache)) cache[n] = getComputedStyle(document.documentElement).getPropertyValue(n).trim(); return cache[n]; }
  WF.themeChanged = function () { for (const k in cache) delete cache[k]; WF.dirty = true; };

  WF.mount = function (canvas) { WF.canvas = canvas; WF.ctx = canvas.getContext('2d'); };
  WF.resize = function () {
    const c = WF.canvas, r = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    WF.w = Math.max(1, Math.floor(r.width)); WF.h = Math.max(1, Math.floor(r.height));
    c.width = Math.floor(WF.w * dpr); c.height = Math.floor(WF.h * dpr);
    WF.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    WF.dirty = true;
  };
  WF.setLookBars = (n) => { WF.lookBars = n; WF.dirty = true; };

  WF.draw = function (q) {
    const ctx = WF.ctx, w = WF.w, h = WF.h;
    if (!ctx || !w || !h) return;
    const song = E.song;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = cssVar('--background'); ctx.fillRect(0, 0, w, h);
    ctx.save(); ctx.translate(-Math.round(G.scrollX || 0), 0);
    // lane guides: a line at every C
    ctx.strokeStyle = cssVar('--border'); ctx.lineWidth = 1;
    ctx.beginPath();
    for (let m = G.lo; m <= G.hi; m++) if (m % 12 === 0) { const x = Math.round(G.keyRect(m).x) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    ctx.stroke();
    if (!song) { ctx.restore(); return; }
    const { measures, n, nq, nd, nm, nh, endQ } = E.get();
    const mi0 = E.measureIndexAt(q);
    const barLen = q < 0 ? E.lead / 2 : measures[mi0] ? measures[mi0].lenQ : 4;
    const look = Math.max(1, WF.lookBars * barLen);
    const ppq = h / look;
    const qTop = q + look;
    const yOf = (t) => h - (t - q) * ppq;
    // bar lines and numbers
    ctx.font = '12px ' + cssVar('--font-sans');
    ctx.textBaseline = 'bottom';
    for (let i = Math.max(0, mi0 - 1); i < measures.length && measures[i].q <= qTop; i++) {
      const y = Math.round(yOf(measures[i].q)) + 0.5;
      if (y > h) continue;
      ctx.strokeStyle = cssVar('--border'); ctx.beginPath(); ctx.moveTo(G.scrollX, y); ctx.lineTo(G.scrollX + w, y); ctx.stroke();
      ctx.fillStyle = cssVar('--muted-foreground'); ctx.fillText(String(i + 1), G.scrollX + 6, y - 2);
    }
    // the two empty lead-in bars before bar 1
    for (let k = 1; k <= 2; k++) {
      const lq = -k * E.lead / 2; if (lq < q - 1e-6 || lq > qTop) continue;
      const y = Math.round(yOf(lq)) + 0.5; ctx.strokeStyle = cssVar('--border'); ctx.beginPath(); ctx.moveTo(G.scrollX, y); ctx.lineTo(G.scrollX + w, y); ctx.stroke();
    }
    // notes
    const opts = E.opts;
    const prac = E.runMode === 'practice';
    const dim = prac && opts.hands !== 'both';
    const rhFill = cssVar('--primary'), border = cssVar('--input');
    const lhFill = cssVar('--hand-left');
    const destr = cssVar('--destructive'), ring = cssVar('--ring');
    const waiting = new Set();
    for (const wn of E.waitingFor()) waiting.add(wn.midi + ':' + wn.q.toFixed(4));
    // first note that can still be visible
    let lo = 0, hi = n; const target = q - E.songMax.maxDur - 1e-6;
    while (lo < hi) { const m = (lo + hi) >> 1; if (nq[m] < target) lo = m + 1; else hi = m; }
    for (let i = lo; i < n && nq[i] < qTop; i++) {
      const end = nq[i] + nd[i];
      if (end <= q) continue;
      const m = nm[i];
      if (!G.inRange(m)) continue;
      const kr = G.keyRect(m);
      const x = kr.x + 1, bw = Math.max(3, kr.w - 2);
      const yBot = yOf(nq[i]), yTop = Math.min(yBot - 6, yOf(end) + 2);
      const rect = [Math.round(x) + 0.5, Math.round(yTop) + 0.5, Math.round(bw) - 1, Math.round(yBot - yTop) - 1];
      const st = E.noteStatus(i);
      const isR = nh[i] === 0;
      const mine = !dim || (opts.hands === 'R') === isR;
      ctx.globalAlpha = mine ? 1 : 0.45;
      const dimmed = !mine;
      const fill = isR ? rhFill : lhFill;
      ctx.beginPath(); roundRect(ctx, rect[0], rect[1], rect[2], rect[3], 3);
      if (st === 1) { ctx.strokeStyle = isR ? rhFill : lhFill; ctx.lineWidth = 2; ctx.stroke(); }
      else if (st === 2) {
        ctx.save(); ctx.clip(); ctx.strokeStyle = destr; ctx.lineWidth = 1;
        ctx.beginPath();
        for (let d = -rect[3]; d < rect[2] + rect[3]; d += 6) { ctx.moveTo(rect[0] + d, rect[1] + rect[3]); ctx.lineTo(rect[0] + d + rect[3], rect[1]); }
        ctx.stroke(); ctx.restore();
        ctx.beginPath(); roundRect(ctx, rect[0], rect[1], rect[2], rect[3], 3);
        ctx.strokeStyle = destr; ctx.lineWidth = 2; ctx.stroke();
      } else { ctx.fillStyle = fill; ctx.fill(); ctx.globalAlpha = 1; ctx.strokeStyle = dimmed ? fill : border; ctx.lineWidth = 1; ctx.stroke(); }
      ctx.globalAlpha = 1;
      if (waiting.size && waiting.has(m + ':' + nq[i].toFixed(4))) {
        ctx.beginPath(); roundRect(ctx, rect[0] - 2, rect[1] - 2, rect[2] + 4, rect[3] + 4, 4);
        ctx.strokeStyle = ring; ctx.lineWidth = 2; ctx.stroke();
      }
    }
    WF.map = { q, ppq, h };
    if (WF.overlay) WF.overlay(ctx);
    ctx.restore();
    // strike line at the keyboard's top edge
    ctx.fillStyle = cssVar('--input'); ctx.fillRect(0, h - 1, w, 1);
  };

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r); ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r); ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
  }
})();
