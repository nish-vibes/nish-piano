/* Waterfall: falling glass bars aligned to the keys, over a quiet star field (dark appearance), with effects for a
   correct note (star burst), a wrong key (red beam up the lane) and a missed note (short shake).
   Canvas, redrawn only when something changed or an effect is running. Every colour comes from the design tokens. */
(function () {
  'use strict';
  const W = window.Wapiro, E = W.engine, G = W.geom;
  const WF = (W.waterfall = { canvas: null, ctx: null, w: 0, h: 0, dirty: true, colors: null, lookBars: 2 });
  const cache = {};
  function cssVar(n) { if (!(n in cache)) cache[n] = getComputedStyle(document.documentElement).getPropertyValue(n).trim(); return cache[n]; }
  let pal = null, layers = null, sprites = {};
  const grads = new Map();
  WF.themeChanged = function () { for (const k in cache) delete cache[k]; pal = null; layers = null; sprites = {}; grads.clear(); WF.dirty = true; };

  WF.mount = function (canvas) { WF.canvas = canvas; WF.ctx = canvas.getContext('2d'); };
  WF.resize = function () {
    const c = WF.canvas, r = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    WF.w = Math.max(1, Math.floor(r.width)); WF.h = Math.max(1, Math.floor(r.height));
    c.width = Math.floor(WF.w * dpr); c.height = Math.floor(WF.h * dpr);
    WF.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layers = null;
    WF.dirty = true;
  };
  WF.setLookBars = (n) => { WF.lookBars = n; WF.dirty = true; };

  // ---------------------------------------------------------------- colour
  const probe = document.createElement('canvas'); probe.width = probe.height = 1;
  const pctx = probe.getContext('2d', { willReadFrequently: true });
  function rgb(token) { pctx.clearRect(0, 0, 1, 1); pctx.fillStyle = cssVar(token); pctx.fillRect(0, 0, 1, 1); const d = pctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; }
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const css = (c, a) => 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + (a < 0 ? 0 : a > 1 ? 1 : a).toFixed(3) + ')';
  const lum = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
  /** The same hue at full saturation and lightness l (0..1). */
  function vivid(c, l) {
    const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let hue = 0;
    if (d) { hue = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; hue *= 60; if (hue < 0) hue += 360; }
    const C = 1 - Math.abs(2 * l - 1), X = C * (1 - Math.abs(((hue / 60) % 2) - 1)), m = l - C / 2, k = Math.floor(hue / 60) % 6;
    const o = [[C, X, 0], [X, C, 0], [0, C, X], [0, X, C], [X, 0, C], [C, 0, X]][k];
    return [(o[0] + m) * 255, (o[1] + m) * 255, (o[2] + m) * 255];
  }
  /** Tints of the hand colours, the wrong-note red and the neutrals, for the current appearance. */
  function palette() {
    if (pal) return pal;
    const bg = rgb('--background'), n0 = rgb('--neutral-0'), n950 = rgb('--neutral-950');
    const dark = lum(bg) < 0.4, hc = /-hc$/.test(document.documentElement.getAttribute('data-theme') || '');
    // light added to a dark sky is drawn in the pale tints; on a light ground the same shapes need the strong ones
    const ink = (t) => { t.spark = dark ? [t.pale, t.light] : [t.c, t.deep]; t.line = dark ? t.light : t.c; t.glint = dark ? t.pale : t.c; return t; };
    const tint = (token) => { const c = rgb(token); return ink({ c, light: mix(c, n0, 0.5), pale: mix(c, n0, 0.82), deep: mix(c, n950, 0.4) }); };
    // The wrong-note light: on dark the token is a soft salmon (made for text), so the beam uses the same hue at full strength.
    const bad = tint('--destructive'), red = dark && !hc ? vivid(bad.c, 0.55) : bad.c;
    pal = { dark, hc, space: dark && !hc, bg, n0, n950, R: tint('--primary'), L: tint('--hand-left'), bad, beam: ink({ c: red, light: mix(red, n0, 0.45), pale: mix(red, n0, 0.8), deep: mix(red, n950, 0.4) }) };
    return pal;
  }
  const mqMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const still = () => !!(mqMotion && mqMotion.matches);

  // ---------------------------------------------------------------- backdrop: nebula and stars (dark appearance only)
  function buildLayers() {
    const P = palette(), dpr = window.devicePixelRatio || 1, w = WF.w, h = WF.h;
    const mk = () => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.floor(w * dpr)); c.height = Math.max(1, Math.floor(h * dpr)); const x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); return [c, x]; };
    const [bgC, b] = mk();
    b.fillStyle = css(P.bg, 1); b.fillRect(0, 0, w, h);
    let stars = null; const tw = [];
    if (P.space) {
      const R = Math.max(w, h);
      const blob = (cx, cy, rad, c, a) => { const g = b.createRadialGradient(cx, cy, 0, cx, cy, rad); g.addColorStop(0, css(c, a)); g.addColorStop(0.5, css(c, a * 0.35)); g.addColorStop(1, css(c, 0)); b.fillStyle = g; b.fillRect(0, 0, w, h); };
      blob(w * 0.1, h * 1.05, R * 0.6, P.L.c, 0.2);
      blob(w * 0.9, h * 0.02, R * 0.5, P.R.c, 0.075);
      blob(w * 0.58, h * 1.15, R * 0.42, mix(P.L.c, P.R.c, 0.45), 0.1);
      const [sC, s] = mk();
      let seed = 20261116; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
      const count = Math.max(40, Math.min(420, Math.round((w * h) / 3000)));
      for (let k = 0; k < count; k++) {
        const x = rnd() * w, y = rnd() * h, z = rnd(), hue = rnd();
        const r = 0.35 + z * z * 0.85, a = 0.16 + z * 0.55;
        const c = hue > 0.86 ? P.L.pale : hue < 0.1 ? P.R.pale : P.n0;
        if (rnd() < 0.07) { tw.push({ x, y, r: r + 0.25, c, ph: rnd() * 6.283, sp: 0.7 + rnd() * 1.3 }); continue; }
        s.fillStyle = css(c, a); s.beginPath(); s.arc(x, y, r, 0, 6.2832); s.fill();
        if (z > 0.975) { s.strokeStyle = css(c, 0.32); s.lineWidth = 0.6; s.beginPath(); s.moveTo(x - 4, y); s.lineTo(x + 4, y); s.moveTo(x, y - 4); s.lineTo(x, y + 4); s.stroke(); }
      }
      stars = sC;
    }
    layers = { bg: bgC, stars, tw };
  }

  // ---------------------------------------------------------------- effects
  const FX = { bursts: [], parts: [], beams: [], beamTimes: [], shakes: new Map(), ignite: new Map(), lastSpark: new Map(), last: 0, drift: 0, lastQ: null };
  const MAX_PARTS = 260;
  WF.fxAlive = () => FX.bursts.length + FX.parts.length + FX.beams.length + FX.shakes.size + FX.ignite.size > 0;
  WF.clearFx = function () { FX.bursts.length = FX.parts.length = FX.beams.length = 0; FX.shakes.clear(); FX.ignite.clear(); FX.lastSpark.clear(); FX.lastQ = null; WF.dirty = true; };
  const R = Math.random;
  /** Star dust thrown up from the strike line above a key. */
  function dust(midi, hand, count, power) {
    const kr = G.keyRect(midi), H = palette()[hand];
    for (let k = 0; k < count && FX.parts.length < MAX_PARTS; k++) {
      const big = R() < 0.22;
      FX.parts.push({ kind: 0, x: kr.x + kr.w * (0.2 + 0.6 * R()), y: WF.h - 2, vx: (R() - 0.5) * 150 * power, vy: -(110 + R() * 250) * power, life: 0.55 + R() * 0.55, age: 0, size: big ? 1.6 + R() * 0.9 : 0.7 + R() * 0.8, c: H.spark[R() < 0.45 ? 0 : 1], tw: R() * 6.283 });
    }
  }
  const hidden = () => W.storage.settings.view === 'sheet'; // nothing is drawn then, so nothing is queued
  E.on('hit', (e) => {
    if (hidden() || !G.inRange(e.midi)) return;
    const t = performance.now();
    FX.bursts.push({ midi: e.midi, hand: e.hand, t0: t });
    if (!still()) {
      FX.ignite.set(e.i, t); dust(e.midi, e.hand, 14, 1);
      // a few stars let go along the edges of the bar itself
      const kr = G.keyRect(e.midi), H = palette()[e.hand], d = E.get().nd[e.i], len = WF.map ? Math.min(WF.h * 0.9, d * WF.map.ppq) : 40;
      for (let k = 0; k < 7 && FX.parts.length < MAX_PARTS; k++) { const left = R() < 0.5; FX.parts.push({ kind: 0, x: kr.x + (left ? 1 : kr.w - 1), y: WF.h - 4 - R() * len, vx: (left ? -1 : 1) * (18 + R() * 55), vy: -(8 + R() * 50), life: 0.45 + R() * 0.45, age: 0, size: R() < 0.3 ? 1.7 + R() * 0.6 : 0.7 + R() * 0.7, c: H.spark[R() < 0.5 ? 0 : 1], tw: R() * 6.283, float: true }); }
    }
    WF.dirty = true;
  });
  E.on('wrong', (e) => {
    if (hidden() || !G.inRange(e.midi)) return;
    const t = performance.now();
    // Calm the beam when wrong keys come faster than three a second, so a run of them never strobes (WCAG 2.3.1).
    FX.beamTimes = FX.beamTimes.filter((x) => t - x < 1000);
    const soft = FX.beamTimes.length >= 3; FX.beamTimes.push(t);
    const old = FX.beams.find((b) => b.midi === e.midi);
    if (old) { old.t0 = Math.min(t, Math.max(old.t0, t - old.attack)); old.grown = true; } // top up, do not flash again from dark
    else { FX.beams.push({ midi: e.midi, t0: t, peak: soft ? 0.4 : 1, attack: soft ? 170 : 55, grown: soft || still() }); if (FX.beams.length > 8) FX.beams.shift(); }
    if (!still() && !soft) {
      // embers pulled up the beam, like stars at speed
      const kr = G.keyRect(e.midi), B = palette().beam;
      for (let k = 0; k < 8 && FX.parts.length < MAX_PARTS; k++) FX.parts.push({ kind: 1, x: kr.x + kr.w * (0.14 + 0.72 * R()), y: WF.h - R() * WF.h * 0.45, vx: 0, vy: -(190 + R() * 330), life: 0.45 + R() * 0.4, age: 0, size: 0.7 + R() * 0.7, c: B.spark[R() < 0.5 ? 0 : 1], tw: 0 });
    }
    WF.dirty = true;
  });
  E.on('miss', (e) => { if (!hidden() && !still()) { FX.shakes.set(e.i, performance.now()); WF.dirty = true; } });
  E.on('seek', WF.clearFx); E.on('song', WF.clearFx);
  E.on('wrap', () => { FX.shakes.clear(); FX.ignite.clear(); });

  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  /** The red beam as a soft sprite: a flat-topped core as wide as the key, a wide faint halo, fading with height. */
  function beamSprite() {
    if (sprites.beam) return sprites.beam;
    const B = palette().beam, SW = 120, SH = 160, c = document.createElement('canvas'); c.width = SW; c.height = SH;
    const x = c.getContext('2d'), im = x.createImageData(SW, SH), d = im.data;
    for (let j = 0; j < SH; j++) {
      const up = 1 - j / (SH - 1), fall = 1 - up;
      for (let i = 0; i < SW; i++) {
        const u = (i / (SW - 1)) * 2 - 1; // the key spans u = -0.2 .. 0.2
        // fine upright streaks inside the light, like an aurora curtain
        const veil = 0.8 + 0.2 * Math.sin(u * 61 + 1.3) * Math.sin(u * 23 + 0.4);
        const core = Math.exp(-Math.pow(u / 0.2, 4)) * Math.pow(fall, 1.2) * veil;
        const halo = Math.exp(-Math.pow(u / 0.5, 2)) * 0.34 * Math.pow(fall, 2.1);
        const hot = Math.exp(-Math.pow(u / 0.12, 2)) * Math.pow(fall, 7);
        const col = mix(B.c, B.light, Math.min(1, hot)), o = (j * SW + i) * 4;
        d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = Math.min(255, Math.round((core * 0.78 + halo) * 255));
      }
    }
    x.putImageData(im, 0, 0);
    return (sprites.beam = c);
  }
  /** The beam sprite at its drawn size, so each frame is a plain copy. A few sizes are kept (white and black keys). */
  function beamAt(bw, h, dpr) {
    const cw = Math.max(1, Math.round(bw * dpr)), ch = Math.max(1, Math.round(h * dpr)), id = 'beam' + cw + 'x' + ch;
    if (sprites[id]) return sprites[id];
    const c = document.createElement('canvas'); c.width = cw; c.height = ch;
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(beamSprite(), 0, 0, cw, ch);
    const ids = (sprites.beamIds = sprites.beamIds || []); ids.push(id); if (ids.length > 4) delete sprites[ids.shift()];
    return (sprites[id] = c);
  }
  /** A soft light sitting on the strike line: pale centre, hand colour, nothing. Flattened to a low dome. */
  function lineGlow(ctx, cx, y, rad, flat, H, a) {
    if (a <= 0.004 || rad <= 0.5) return;
    ctx.save(); ctx.translate(cx, y); ctx.scale(1, flat);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
    g.addColorStop(0, css(H.pale, a)); g.addColorStop(0.3, css(H.light, a * 0.62)); g.addColorStop(0.65, css(H.c, a * 0.2)); g.addColorStop(1, css(H.c, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rad, 0, 6.2832); ctx.fill(); ctx.restore();
  }
  function star4(ctx, x, y, len, c, a, lw) {
    if (a <= 0.004) return;
    ctx.strokeStyle = css(c, a); ctx.lineWidth = lw; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - len, y); ctx.lineTo(x + len, y); ctx.moveTo(x, y - len * 0.72); ctx.lineTo(x, y + len * 0.72); ctx.stroke();
  }

  function drawBeams(ctx, P, now, h) {
    if (!FX.beams.length) return;
    const spr = beamSprite(), dpr = window.devicePixelRatio || 1;
    for (let k = FX.beams.length - 1; k >= 0; k--) {
      const b = FX.beams[k], t = now - b.t0, LIFE = 900;
      if (t >= LIFE) { FX.beams.splice(k, 1); continue; }
      const up = Math.min(1, t / b.attack);
      const I = b.peak * (t < b.attack ? up : Math.exp(-(t - b.attack) / 270)) * Math.min(1, (LIFE - t) / 160);
      const grow = b.grown ? 1 : easeOut(Math.min(1, t / 150));
      const kr = G.keyRect(b.midi), bw = kr.w * 5, bx = kr.x + kr.w / 2 - bw / 2, bh = h * grow;
      ctx.globalAlpha = Math.min(1, I * (P.dark ? 1 : 0.85));
      if (grow < 1) ctx.drawImage(spr, bx, h - bh, bw, bh); // rising: stretched for a few frames
      else { const c = beamAt(bw, h, dpr); ctx.drawImage(c, Math.round(bx * dpr) / dpr, 0, c.width / dpr, c.height / dpr); }
      ctx.globalAlpha = 1;
      lineGlow(ctx, kr.x + kr.w / 2, h, kr.w * (1.6 + 1.5 * I), 0.3, P.beam, 0.85 * I);
    }
  }
  function drawBursts(ctx, P, now, h) {
    for (let k = FX.bursts.length - 1; k >= 0; k--) {
      const b = FX.bursts[k], t = (now - b.t0) / 560;
      if (t >= 1) { FX.bursts.splice(k, 1); continue; }
      const kr = G.keyRect(b.midi), cx = kr.x + kr.w / 2, H = P[b.hand], calm = still();
      const u = Math.min(kr.w, 30) + 8; // effect size follows the key, within reason
      const e = calm ? 0.6 : easeOut(t), fade = (1 - t) * (1 - t);
      lineGlow(ctx, cx, h, u * (1.0 + 1.7 * e), 0.66, H, 0.8 * fade);
      if (calm) continue;
      // shock ring: a soft flat arc opening along the strike line, like a planet's ring seen from the side
      const rx = u * (0.45 + 1.3 * e), ry = Math.max(2, rx * 0.32);
      ctx.beginPath(); ctx.ellipse(cx, h - 1, rx, ry, 0, Math.PI, 2 * Math.PI);
      ctx.strokeStyle = css(H.c, 0.3 * (1 - t)); ctx.lineWidth = 4; ctx.stroke();
      ctx.strokeStyle = css(H.line, 0.8 * (1 - t)); ctx.lineWidth = 1.2; ctx.stroke();
      // four-point glint, quick
      const g = Math.max(0, 1 - t / 0.42);
      star4(ctx, cx, h - 3, u * (0.4 + 1.1 * easeOut(Math.min(1, t / 0.2))), H.glint, g * g, 1.3);
    }
  }
  function drawParts(ctx, dt) {
    for (let k = FX.parts.length - 1; k >= 0; k--) {
      const p = FX.parts[k];
      p.age += dt;
      if (p.age >= p.life) { FX.parts.splice(k, 1); continue; }
      const f = 1 - p.age / p.life;
      if (p.kind === 0) {
        p.vy += (p.float ? 30 : 230) * dt; p.vx *= 1 - Math.min(1, 1.6 * dt); p.x += p.vx * dt; p.y += p.vy * dt;
        const a = Math.pow(f, 1.4) * (0.72 + 0.28 * Math.sin(p.tw + p.age * 19));
        ctx.fillStyle = css(p.c, a); ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.55 + 0.45 * f), 0, 6.2832); ctx.fill();
        if (p.size > 1.6) star4(ctx, p.x, p.y, p.size * 3.1 * f, p.c, a * 0.75, 0.8);
      } else {
        p.y += p.vy * dt;
        const a = 0.7 * f * Math.min(1, p.age / 0.08), tail = Math.min(20, -p.vy * 0.04);
        ctx.strokeStyle = css(p.c, a * 0.45); ctx.lineWidth = p.size; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y + tail); ctx.stroke();
        ctx.fillStyle = css(p.c, a); ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 0.85, 0, 6.2832); ctx.fill();
      }
    }
  }

  // ---------------------------------------------------------------- glass
  /** Left-to-right shading of a bar: lit edge, clear body, deeper far edge. Cached per key position, hand and state. */
  function bodyGrad(ctx, P, H, key, x, w, hit) {
    const id = key + (hit ? 'h' : 'p') + x + '|' + w;
    let g = grads.get(id);
    if (g) return g;
    g = ctx.createLinearGradient(x, 0, x + w, 0);
    if (hit) { g.addColorStop(0, css(H.light, 0.34)); g.addColorStop(0.22, css(H.c, 0.14)); g.addColorStop(0.78, css(H.c, 0.14)); g.addColorStop(1, css(H.light, 0.26)); }
    else if (P.dark) { g.addColorStop(0, css(H.light, 0.78)); g.addColorStop(0.2, css(H.c, 0.56)); g.addColorStop(0.62, css(H.c, 0.42)); g.addColorStop(1, css(H.deep, 0.72)); }
    else { g.addColorStop(0, css(H.light, 0.7)); g.addColorStop(0.2, css(H.c, 0.56)); g.addColorStop(0.62, css(H.c, 0.46)); g.addColorStop(1, css(H.deep, 0.66)); }
    if (grads.size > 800) grads.clear();
    grads.set(id, g);
    return g;
  }
  function shared(ctx, P) {
    if (sprites.gloss) return;
    const g = ctx.createLinearGradient(0, 0, 0, 11);
    g.addColorStop(0, css(P.n0, P.dark ? 0.5 : 0.62)); g.addColorStop(0.35, css(P.n0, 0.16)); g.addColorStop(1, css(P.n0, 0));
    sprites.gloss = g;
    for (const k of ['R', 'L']) {
      const u = ctx.createLinearGradient(0, 0, 0, -90);
      u.addColorStop(0, css(P[k].light, 0.7)); u.addColorStop(0.35, css(P[k].c, 0.34)); u.addColorStop(1, css(P[k].c, 0));
      sprites['up' + k] = u;
    }
  }
  function glassBar(ctx, P, H, key, x, y, w, h, st, dimmed, sweep) {
    const r = Math.min(4, w / 2, h / 2);
    const path = () => { ctx.beginPath(); roundRect(ctx, x, y, w, h, r); };
    if (st === 2) {
      // missed: red glass, cracked
      const B = P.bad;
      path(); ctx.fillStyle = css(B.c, P.dark ? 0.16 : 0.1); ctx.fill();
      ctx.save(); ctx.clip(); ctx.strokeStyle = css(B.c, 0.9); ctx.lineWidth = 1;
      ctx.beginPath();
      for (let d = -h; d < w + h; d += 6) { ctx.moveTo(x + d, y + h); ctx.lineTo(x + d + h, y); }
      ctx.stroke(); ctx.restore();
      path(); ctx.strokeStyle = css(B.c, 1); ctx.lineWidth = 2; ctx.stroke();
      return;
    }
    const hit = st === 1;
    if (P.hc) {
      // high contrast: plain, solid, as before
      path();
      if (hit) { ctx.strokeStyle = css(H.c, 1); ctx.lineWidth = 2; ctx.stroke(); }
      else { ctx.fillStyle = css(H.c, 1); ctx.fill(); ctx.strokeStyle = dimmed ? css(H.c, 1) : cssVar('--input'); ctx.lineWidth = 1; ctx.stroke(); }
      return;
    }
    // soft light around the bar
    if (P.dark && !dimmed) { ctx.beginPath(); roundRect(ctx, x - 1.5, y - 1.5, w + 3, h + 3, r + 1.5); ctx.strokeStyle = css(H.c, hit ? 0.3 : 0.17); ctx.lineWidth = 3; ctx.stroke(); }
    path(); ctx.fillStyle = bodyGrad(ctx, P, H, key, x, w, hit); ctx.fill();
    // the thickness of the glass: colour gathers just inside the edge
    if (!hit && w >= 9 && h >= 9) { ctx.beginPath(); roundRect(ctx, x + 1.5, y + 1.5, w - 3, h - 3, Math.max(1, r - 1.5)); ctx.strokeStyle = css(H.c, P.dark ? 0.5 : 0.34); ctx.lineWidth = 2; ctx.stroke(); }
    if (hit) {
      // a played note is a clear shell lit from the strike line
      ctx.save(); ctx.clip(); ctx.translate(0, y + h); ctx.fillStyle = sprites['up' + key]; ctx.fillRect(x, -Math.min(h, 90), w, Math.min(h, 90)); ctx.restore();
    }
    if (h > 7) {
      // gloss under the top edge, and light pooling along the bottom edge
      ctx.translate(0, y + 1.5); ctx.fillStyle = sprites.gloss; ctx.beginPath(); roundRect(ctx, x + 1.5, 0, w - 3, Math.min(11, h - 3), Math.max(1, r - 1.5)); ctx.fill(); ctx.translate(0, -(y + 1.5));
      if (!hit) { ctx.fillStyle = css(H.pale, P.dark ? 0.42 : 0.5); ctx.fillRect(x + 2.5, y + h - 3, w - 5, 1.5); }
    }
    if (w >= 11 && h > 14) {
      // the streak of light down the lit edge
      ctx.strokeStyle = css(P.n0, hit ? 0.5 : P.dark ? 0.4 : 0.55); ctx.lineWidth = 1.5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x + 3.25, y + 5); ctx.lineTo(x + 3.25, y + h - 5); ctx.stroke();
    }
    if (sweep != null) {
      // just played: a band of light runs up through the glass
      const top = y + h - (h + 44) * easeOut(sweep);
      ctx.save(); path(); ctx.clip();
      const g = ctx.createLinearGradient(0, top, 0, top + 44);
      g.addColorStop(0, css(P.n0, 0)); g.addColorStop(0.5, css(P.n0, 0.75 * (1 - sweep))); g.addColorStop(1, css(P.n0, 0));
      ctx.fillStyle = g; ctx.fillRect(x, top, w, 44); ctx.restore();
    }
    path();
    ctx.strokeStyle = hit ? css(P.dark ? H.light : H.c, 1) : P.dark ? css(H.light, 0.95) : css(H.deep, 0.9);
    ctx.lineWidth = hit ? 1.5 : 1; ctx.stroke();
    if (sweep != null) {
      // and its outline lets go and widens, like a shock front
      const o = 2 + 11 * easeOut(sweep), a = (1 - sweep) * (1 - sweep);
      ctx.beginPath(); roundRect(ctx, x - o, y - o, w + 2 * o, h + 2 * o, r + o);
      ctx.strokeStyle = css(H.line, 0.75 * a); ctx.lineWidth = 1.5; ctx.stroke();
    }
  }

  WF.draw = function (q) {
    const ctx = WF.ctx, w = WF.w, h = WF.h;
    if (!ctx || !w || !h) return;
    const song = E.song, P = palette(), now = performance.now(), calm = still();
    const dt = Math.min(0.05, Math.max(0, (now - (FX.last || now)) / 1000)); FX.last = now;
    if (!layers) buildLayers();
    shared(ctx, P);
    // a shaken or lit bar may leave the screen before its effect ends: drop those by age, so the canvas can rest
    for (const [i, t] of FX.shakes) if (now - t >= 430) FX.shakes.delete(i);
    for (const [i, t] of FX.ignite) if (now - t >= 420) FX.ignite.delete(i);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.drawImage(layers.bg, 0, 0, w, h);
    if (!song) { ctx.save(); ctx.translate(-Math.round(G.scrollX || 0), 0); lanes(ctx, h); ctx.restore(); return; }
    const { measures, n, nq, nd, nm, nh, endQ } = E.get();
    const mi0 = E.measureIndexAt(q);
    const barLen = q < 0 ? E.lead / 2 : measures[mi0] ? measures[mi0].lenQ : 4;
    const look = Math.max(1, WF.lookBars * barLen);
    const ppq = h / look;
    const qTop = q + look;
    const yOf = (t) => h - (t - q) * ppq;
    // stars drift down a little as the music moves, far slower than the notes
    if (layers.stars) {
      if (!calm && FX.lastQ != null && Math.abs(q - FX.lastQ) < barLen) FX.drift = (((FX.drift + (q - FX.lastQ) * ppq * 0.07) % h) + h) % h;
      FX.lastQ = q;
      const dpr = window.devicePixelRatio || 1, d = calm ? 0 : Math.round(FX.drift * dpr) / dpr; // whole device pixels: a plain copy, no resampling
      ctx.drawImage(layers.stars, 0, d, w, h); if (d > 0) ctx.drawImage(layers.stars, 0, d - h, w, h);
      for (const s of layers.tw) {
        const a = calm || !E.playing ? 0.55 : 0.5 + 0.45 * Math.sin(s.ph + now * 0.001 * s.sp * 2.2);
        const y = (s.y + d) % h;
        ctx.fillStyle = css(s.c, a); ctx.beginPath(); ctx.arc(s.x, y, s.r, 0, 6.2832); ctx.fill();
        if (s.r > 1) star4(ctx, s.x, y, 3.5 * a, s.c, a * 0.5, 0.6);
      }
    }
    ctx.save(); ctx.translate(-Math.round(G.scrollX || 0), 0);
    lanes(ctx, h);
    // bar lines and numbers
    ctx.font = '12px ' + cssVar('--font-sans');
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 1;
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
    const ring = cssVar('--ring');
    const waiting = new Set();
    for (const wn of E.waitingFor()) waiting.add(wn.midi + ':' + wn.q.toFixed(4));
    const sounding = []; // bars crossing the strike line that are lit: [midi, hand key, strength, sparks]
    const add = P.dark ? 'lighter' : 'source-over';
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
      const isR = nh[i] === 0, key = isR ? 'R' : 'L';
      const mine = !dim || (opts.hands === 'R') === isR;
      // a missed note shakes briefly
      let dx = 0;
      if (FX.shakes.size && FX.shakes.has(i)) {
        const t = (now - FX.shakes.get(i)) / 430;
        if (t >= 1) FX.shakes.delete(i); else dx = 3.2 * Math.sin(t * Math.PI * 7) * (1 - t) * (1 - t);
      }
      let sweep = null;
      if (FX.ignite.size && FX.ignite.has(i)) {
        const t = (now - FX.ignite.get(i)) / 420;
        if (t >= 1) FX.ignite.delete(i); else sweep = t;
      }
      ctx.globalAlpha = mine ? 1 : 0.45;
      if (dx) ctx.translate(dx, 0);
      glassBar(ctx, P, P[key], key, rect[0], rect[1], rect[2], rect[3], st, !mine, sweep);
      if (dx) ctx.translate(-dx, 0);
      ctx.globalAlpha = 1;
      if (waiting.size && waiting.has(m + ':' + nq[i].toFixed(4))) {
        // the note the music is waiting for: a ring that breathes
        const breath = calm ? 1 : 0.62 + 0.38 * Math.sin(now * 0.0042);
        ctx.beginPath(); roundRect(ctx, rect[0] - 2.5, rect[1] - 2.5, rect[2] + 5, rect[3] + 5, 5.5);
        ctx.globalAlpha = breath; ctx.strokeStyle = ring; ctx.lineWidth = 2; ctx.stroke(); ctx.globalAlpha = 1;
      }
      if (E.playing && nq[i] <= q + 1e-3) {
        if (st === 1 && E.activeKeys.has(m)) sounding.push([m, key, 1, true]);            // played and still held
        else if (E.runMode === 'listen' || (prac && !E.isPractised(i) && opts.playAlong)) sounding.push([m, key, 0.5, false]); // played by the app
      }
    }
    // light on the strike line under sounding notes; a held correct note keeps throwing sparks
    ctx.globalCompositeOperation = add;
    for (const [m, key, k, sparks] of sounding) {
      const kr = G.keyRect(m), flick = calm ? 1 : 0.86 + 0.14 * Math.sin(now * 0.021 + m);
      lineGlow(ctx, kr.x + kr.w / 2, h, kr.w * 1.5, 0.6, P[key], 0.62 * k * flick);
      if (sparks && !calm && now - (FX.lastSpark.get(m) || 0) > 85) { FX.lastSpark.set(m, now); dust(m, key, 1, 0.62); }
    }
    drawBeams(ctx, P, now, h);
    drawBursts(ctx, P, now, h);
    drawParts(ctx, dt);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    WF.map = { q, ppq, h };
    if (WF.overlay) WF.overlay(ctx);
    ctx.restore();
    // strike line at the keyboard's top edge, with a low glow like a horizon
    if (P.space) { const g = ctx.createLinearGradient(0, h - 40, 0, h); g.addColorStop(0, css(P.R.c, 0)); g.addColorStop(1, css(P.R.c, 0.13)); ctx.fillStyle = g; ctx.fillRect(0, h - 40, w, 40); }
    ctx.fillStyle = cssVar('--primary'); ctx.fillRect(0, h - 2, w, 2);
  };

  /** Lane guides: a line at every C. */
  function lanes(ctx, h) {
    ctx.strokeStyle = cssVar('--border'); ctx.lineWidth = 1;
    ctx.beginPath();
    for (let m = G.lo; m <= G.hi; m++) if (m % 12 === 0) { const x = Math.round(G.keyRect(m).x) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    ctx.stroke();
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r); ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r); ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
  }
})();
