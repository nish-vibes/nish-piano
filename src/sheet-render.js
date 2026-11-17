/* Sheet renderer: draws song.notation as SVG, with cursor, missed-note marks and bar clicks. */
(function () {
  'use strict';
  const W = window.Wapiro, E = W.engine, L = W.sheetLayout, U = W.util;
  const NS = 'http://www.w3.org/2000/svg';
  const G = window.WAPIRO_GLYPHS || (typeof WAPIRO_GLYPHS !== 'undefined' ? WAPIRO_GLYPHS : {});
  const SH = (W.sheet = { root: null, svg: null, lay: null, S: 10, rendered: new Set(), cursor: null, curSys: -1, spots: null });

  const el = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const f = (v) => (Math.round(v * 100) / 100);

  // ------------------------------------------------------------------ glyph helpers
  /** Place a glyph so that glyph point (gx, gy) lands on (x, y); scale in px per font unit. */
  function glyph(parent, name, x, y, gx, gy, sc, flipY) {
    const g = G[name];
    if (!g) return null;
    const tm = SH.textGlyphs; // test tool only: draw symbols as text in an SMuFL font so a printed PDF looks like MuseScore output
    const tname = flipY && /^flag/.test(name) ? name.replace('Up', 'Down') : name;
    if (tm && tm.map[tname]) {
      const [cp, ax] = tm.map[tname];
      const t = el('text', { x: f(x + (ax - gx) * sc), y: f(y), 'font-family': tm.family, 'font-size': f(1000 * sc), class: 'sh-ink' }, parent);
      t.textContent = String.fromCodePoint(cp);
      return t;
    }
    const t = flipY ? 'translate(' + f(x - gx * sc) + ' ' + f(y - gy * sc) + ') scale(' + sc + ' ' + sc + ')' : 'translate(' + f(x - gx * sc) + ' ' + f(y + gy * sc) + ') scale(' + sc + ' ' + -sc + ')';
    return el('path', { d: g.d, transform: t, class: 'sh-ink' }, parent);
  }
  const bb = (name) => G[name].bbox;

  const REST_GLYPH = { whole: 'restWhole', half: 'restHalf', quarter: 'restQuarter', eighth: 'rest8th', '16th': 'rest16th', '32nd': 'rest32nd', '64th': 'rest32nd' };
  const ACC_GLYPH = { s: 'sharp', f: 'flat', n: 'natural', x: 'doubleSharp', ff: 'doubleFlat' };
  const FLAG_GLYPH = { eighth: 'flag8thUp', '16th': 'flag16thUp', '32nd': 'flag32ndUp', '64th': 'flag32ndUp' };
  const ACC_SCALE = 0.58;

  // ------------------------------------------------------------------ drawing one system
  function drawSystem(lay, si, g) {
    const S = lay.S, sc = S / 200, nota = lay.nota, sys = lay.systems[si];
    const half = S / 2;
    const sw = Math.max(1, S * 0.09), stemW = Math.max(1, S * 0.11);
    const staffY = [sys.y1].concat(sys.y2 != null ? [sys.y2] : []);
    const yOf = (staff, pos) => staffY[staff] + 4 * S - pos * half;
    const lines = [];       // staff lines, barlines, ledger lines, stems (stroke paths)
    const L1 = (x1, y1, x2, y2) => lines.push('M' + f(x1) + ' ' + f(y1) + 'L' + f(x2) + ' ' + f(y2));
    const ns = nota.nstaves;
    const botY = staffY[ns - 1] + 4 * S;

    // staff lines
    const staffLines = [];
    for (let s = 0; s < ns; s++) for (let k = 0; k < 5; k++) staffLines.push('M' + f(sys.x0) + ' ' + f(staffY[s] + k * S) + 'L' + f(sys.x1) + ' ' + f(staffY[s] + k * S));
    el('path', { d: staffLines.join(''), class: 'sh-staff', 'stroke-width': f(sw) }, g);
    const first = sys.measures[0];
    const st0 = lay.state[first];
    // system start line and brace
    L1(sys.x0, staffY[0], sys.x0, botY);
    if (ns > 1 && G.brace) {
      const b = G.brace.bbox, H = botY - staffY[0], bw = 1.1 * S;
      const sx = bw / (b[2] - b[0]), sy = H / (b[3] - b[1]);
      el('path', { d: G.brace.d, class: 'sh-ink', transform: 'translate(' + f(sys.x0 - 0.25 * S - bw - b[0] * sx) + ' ' + f(botY + b[1] * sy) + ') scale(' + f(sx * 1000) / 1000 + ' ' + -f(sy * 1000) / 1000 + ')' }, g);
    }
    // clefs, key and time signature at the system start
    let hx = sys.x0 + 0.7 * S;
    const drawClef = (s, clef, x) => {
      if (clef === 'F') { const b = bb('fClef'); glyph(g, 'fClef', x, yOf(s, 6), b[0], (b[1] + b[3]) / 2 + 20, sc * 1.0); }
      else { const b = bb('gClef'); glyph(g, 'gClef', x, yOf(s, 2), b[0], 232, sc * 0.98); }
    };
    const keySig = (s, clef, fifths, x) => {
      const arr = fifths > 0 ? L.KEY_POS[clef].s : L.KEY_POS[clef].f, n = Math.abs(fifths);
      const name = fifths > 0 ? 'sharp' : 'flat';
      for (let k = 0; k < n; k++) accGlyph(g, name, x + k * 1.05 * S, yOf(s, arr[k]), S);
      return n ? n * 1.05 * S + 0.7 * S : 0;
    };
    const timeSig = (s, t, x) => {
      const size = 2.8 * S;
      for (const [txt, p] of [[String(t.num), 6], [String(t.den), 2]]) {
        const e = el('text', { x: f(x + 0.9 * S), y: f(yOf(s, p) + 0.35 * size), 'text-anchor': 'middle', class: 'sh-time', 'font-size': f(size) }, g);
        e.textContent = txt;
      }
    };
    for (let s = 0; s < ns; s++) drawClef(s, st0.clef[s], hx);
    let kx = hx + 3.1 * S;
    let kw = 0;
    for (let s = 0; s < ns; s++) kw = keySig(s, st0.clef[s], st0.key, kx);
    if (st0.time) for (let s = 0; s < ns; s++) timeSig(s, st0.time, kx + kw + 0.2 * S);
    // bar number at the system start
    const lab = nota.written[first].label;
    if (lab != null) { const t = el('text', { x: f(sys.x0 + 0.1 * S), y: f(staffY[0] - 1.6 * S), class: 'sh-num' }, g); t.textContent = String(lab); }

    // measures
    const spotKey = [];
    sys.measures.forEach((wi, mk) => {
      const it = sys.items[mk], wm = nota.written[wi], p = L.prepare(lay, wi), st = lay.state[wi];
      // marks at the start of a measure inside the system
      if (mk > 0) {
        let x = it.x0 + 0.5 * S;
        if (st.clefChanged) { for (let s = 0; s < ns; s++) drawClef(s, st.clef[s], x); x += 2.6 * S; }
        if (st.keyChanged) { let w2 = 0; for (let s = 0; s < ns; s++) w2 = keySig(s, st.clef[s], st.key, x); x += w2; }
        if (st.time) for (let s = 0; s < ns; s++) timeSig(s, st.time, x);
      }
      // barlines
      const xr = it.x1;
      barline(g, lines, wm, it, botY, staffY, S, sw, mk === 0);
      // events
      for (let s = 0; s < ns; s++) {
        const staffRecs = p.staves[s];
        staffRecs.forEach((vrecs, vi) => vrecs.forEach((rec) => drawRec(g, lines, lay, rec, it, s, yOf, S, sc, stemW, sw, p)));
        for (const grp of p.groups[s]) drawBeams(g, grp, it, s, yOf, S, stemW, lay);
        drawTuplets(g, lines, p, s, it, yOf, S, lay);
        // ties
        staffRecs.forEach((vrecs, vi) => vrecs.forEach((rec, ri) => { if (rec.notes) drawTies(g, lay, wi, s, vi, ri, rec, it, yOf, S); }));
      }
      // ending bracket
      if (wm.ending) {
        const e = wm.ending, y = sys.y1 - Math.max(5.4 * S, (sys.ext[0].up * 0.5 + 3) * S);
        const x0 = e.first || mk === 0 ? it.x0 + 0.2 * S : it.x0;
        L1(x0, y, xr - 0.2 * S, y);
        if (e.first) L1(x0, y, x0, y + 1.5 * S);
        if (e.last && !e.open) L1(xr - 0.2 * S, y, xr - 0.2 * S, y + 1.5 * S);
        if (e.first || mk === 0) { const t = el('text', { x: f(x0 + 0.4 * S), y: f(y + 1.35 * S), class: 'sh-num' }, g); t.textContent = String(e.label).replace(/\s+/g, '') + '.'; }
      }
    });
    el('path', { d: lines.join(''), class: 'sh-line', 'stroke-width': f(sw) }, g).setAttribute('stroke-linecap', 'butt');
    void spotKey;
  }

  function accGlyph(g, name, x, y, S) {
    const b = bb(name), sc = (S / 200) * ACC_SCALE;
    const gy = name === 'flat' || name === 'doubleFlat' ? b[1] + (b[3] - b[1]) * 0.2 : (b[1] + b[3]) / 2;
    glyph(g, name, x, y, b[0], gy, sc);
    return (b[2] - b[0]) * sc;
  }

  function barline(g, lines, wm, it, botY, staffY, S, sw, firstInSys) {
    const x = it.x1, top = staffY[0];
    const v = (xx, w) => { g.appendChild(el('rect', { x: f(xx - w / 2), y: f(top), width: f(w), height: f(botY - top), class: 'sh-ink' })); };
    const dots = (xx) => {
      for (let s = 0; s < staffY.length; s++) for (const k of [1.5, 2.5]) g.appendChild(el('circle', { cx: f(xx), cy: f(staffY[s] + k * S), r: f(0.2 * S), class: 'sh-ink' }));
    };
    if (wm.repEnd) {
      v(x - 0.12 * S, 0.5 * S); v(x - 0.12 * S - 0.55 * S, sw); dots(x - 1.2 * S);
    } else if (wm.bar === 'light-heavy') { v(x - 0.1 * S, 0.5 * S); v(x - 0.1 * S - 0.55 * S, sw); }
    else if (wm.bar === 'light-light') { v(x, sw); v(x - 0.4 * S, sw); }
    else if (wm.bar === 'heavy-heavy') { v(x - 0.1 * S, 0.5 * S); v(x - 0.1 * S - 0.55 * S, 0.5 * S); }
    else lines.push('M' + f(x) + ' ' + f(top) + 'L' + f(x) + ' ' + f(botY));
    if (wm.repStart) {
      const x0 = it.x0 + (firstInSys ? 0 : 0);
      v(x0 + 0.3 * S, 0.5 * S); v(x0 + 0.3 * S + 0.55 * S, sw); dots(x0 + 1.6 * S);
    }
  }

  // ------------------------------------------------------------------ events
  function colX(it, rec) { return it.colX[rec.col]; }

  function drawRec(g, lines, lay, rec, it, s, yOf, S, sc, stemW, sw, p) {
    const half = S / 2;
    const x = colX(it, rec);
    if (!rec.notes) {
      // rests
      let name = REST_GLYPH[rec.ty] || 'restQuarter';
      let rx = x;
      let off = 0;
      if (rec.nVoices > 1 && !rec.wm) {
        // keep clear of the other voice's notes sounding at this time
        let other = null;
        for (const v of p.staves[s]) for (const o of v) if (o !== rec && o.notes && o.voice !== rec.voice && o.t < rec.t + rec.d - 1e-4 && o.t + o.d > rec.t + 1e-4) {
          other = other || { top: -99, bot: 99 }; other.top = Math.max(other.top, o.top); other.bot = Math.min(other.bot, o.bot);
        }
        if (rec.voice === 0) off = Math.max(2, other ? other.top + 5 - 4 : 2);
        else off = Math.min(-2, other ? other.bot - 5 - 4 : -2);
        off = off % 2 ? off + (rec.voice === 0 ? 1 : -1) : off;
      }
      if (rec.wm) { name = 'restWhole'; const b = bb(name); rx = (it.x0 + it.x1) / 2 - ((b[2] - b[0]) * sc) / 2 + 0.3 * S; }
      const b = bb(name);
      let gy, pos;
      if (name === 'restWhole') { gy = b[3]; pos = 6; } else if (name === 'restHalf') { gy = b[1]; pos = 4; } else { gy = (b[1] + b[3]) / 2; pos = 4; }
      glyph(g, name, rx, yOf(s, pos + off), b[0], gy, sc);
      if (rec.dots) for (let d = 0; d < rec.dots; d++) g.appendChild(el('circle', { cx: f(rx + (b[2] - b[0]) * sc + (0.45 + d * 0.5) * S), cy: f(yOf(s, 4 + off + 1) ), r: f(0.2 * S), class: 'sh-ink' }));
      return;
    }
    const dir = rec.dir;
    const hw = L.HW * S;
    // ledger lines
    const ledger = (pos) => { const y = yOf(s, pos); lines.push('M' + f(x - 0.45 * S) + ' ' + f(y) + 'L' + f(x + hw + 0.45 * S + (rec.dispR ? hw : 0)) + ' ' + f(y)); };
    for (let p = 10; p <= rec.top; p += 2) ledger(p);
    for (let p = -2; p >= rec.bot; p -= 2) ledger(p);
    // noteheads
    const headName = rec.ty === 'whole' ? 'noteWhole' : rec.ty === 'half' ? 'noteheadVoid' : 'noteheadBlack';
    const hb = bb(headName);
    for (const nt of rec.notes) {
      const xx = x + (nt.disp > 0 ? hw - 0.1 * S : nt.disp < 0 ? -hw + 0.1 * S : 0);
      const y = yOf(s, nt.pos);
      if (rec.ty === 'whole') glyph(g, headName, xx + hw / 2 - ((hb[2] - hb[0]) * sc) / 2, y, hb[0], 90, sc);
      else glyph(g, headName, xx, y, hb[0], 91, sc);
      nt.x = xx; nt.y = y;
      if (hits && nt.n.src) hits.push({ x: xx + hw / 2, y, r: 0.9 * S, n: nt.n.src, sys: g });
      // accidental
      if (nt.n.acc) {
        const gname = ACC_GLYPH[nt.n.acc];
        const b = bb(gname), w = (b[2] - b[0]) * S / 200 * ACC_SCALE;
        const right = x - (rec.dispL ? hw - 0.1 * S : 0) - 0.6 * S - nt.accCol * 1.45 * S;
        const ax = right - w;
        accGlyph(g, gname, ax, y, S);
      }
    }
    // dots
    if (rec.dots) {
      for (const nt of rec.notes) {
        const dy = nt.pos % 2 === 0 ? yOf(s, nt.pos + 1) : yOf(s, nt.pos);
        for (let d = 0; d < rec.dots; d++) g.appendChild(el('circle', { cx: f(x + hw + (rec.dispR ? hw : 0) + (0.45 + d * 0.5) * S), cy: f(dy), r: f(0.2 * S), class: 'sh-ink' }));
      }
    }
    // stem
    if (dir && rec.ty !== 'whole') {
      const up = dir === 'up';
      const sx = up ? x + hw - stemW / 2 + 0.02 * S : x + stemW / 2 - 0.02 * S;
      const extra = rec.ty === '16th' ? 1 : rec.ty === '32nd' ? 2 : 0; // extra half-steps for more flags
      const startPos = up ? rec.bot : rec.top;
      const tipPos = rec.inBeam ? null : up ? Math.max(rec.top + 7 + extra, 4) : Math.min(rec.bot - 7 - extra, 4);
      rec.sx = sx; rec.up = up;
      if (!rec.inBeam) {
        L1s(lines, sx, yOf(s, startPos), sx, yOf(s, tipPos));
        rec.tipPos = tipPos; rec.tipY = yOf(s, tipPos);
        if (FLAG_GLYPH[rec.ty]) {
          const gn = FLAG_GLYPH[rec.ty], b = bb(gn);
          const tipG = rec.ty === '32nd' || rec.ty === '64th' ? b[3] : 767;
          if (up) glyph(g, gn, sx - stemW / 2, yOf(s, tipPos), 0, tipG, sc);
          else glyph(g, gn, sx - stemW / 2, yOf(s, tipPos), 0, tipG, sc, true);
        }
      }
    }
  }
  function L1s(lines, x1, y1, x2, y2) { lines.push('M' + f(x1) + ' ' + f(y1) + 'L' + f(x2) + ' ' + f(y2)); }

  function drawBeams(g, grp, it, s, yOf, S, stemW) {
    const half = S / 2, dir = grp[0].dir, up = dir === 'up';
    const maxLevels = Math.max(...grp.map((r) => (r.ev.bm ? r.ev.bm.length : 1)));
    const extraMin = (maxLevels - 1) * 1.5;
    const x = grp.map((r) => r.sx);
    for (const r of grp) {
      const hw = L.HW * S, xc = colX(it, r);
      r.sx = up ? xc + hw - stemW / 2 + 0.02 * S : xc + stemW / 2 - 0.02 * S;
    }
    const xs = grp.map((r) => r.sx);
    const nat = grp.map((r) => (up ? Math.max(r.top + 7, 4) : Math.min(r.bot - 7, 4)));
    const dx = xs[xs.length - 1] - xs[0] || 1;
    const mid = (nat[0] + nat[nat.length - 1]) / 2;
    let delta = Math.max(-3, Math.min(3, nat[nat.length - 1] - nat[0]));
    let line = (xx) => mid + delta * ((xx - xs[0]) / dx - 0.5);
    let shift = 0;
    grp.forEach((r, i) => {
      const need = up ? r.top + 6 + extraMin - line(xs[i]) : r.bot - 6 - extraMin - line(xs[i]);
      if (up) shift = Math.max(shift, need); else shift = Math.min(shift, need);
    });
    const p = (xx) => line(xx) + shift;
    // stems
    grp.forEach((r, i) => {
      const startPos = up ? r.bot : r.top, tip = p(xs[i]);
      g.appendChild(el('rect', { x: f(xs[i] - stemW / 2), y: f(Math.min(yOf(s, startPos), yOf(s, tip))), width: f(stemW), height: f(Math.abs(yOf(s, startPos) - yOf(s, tip))), class: 'sh-ink' }));
      r.tipPos = tip; r.tipY = yOf(s, tip);
    });
    const th = 0.5 * S, gap = 0.75 * S;
    const polys = [];
    for (let lv = 0; lv < maxLevels; lv++) {
      let start = null;
      grp.forEach((r, i) => {
        const mk = r.ev.bm ? r.ev.bm[lv] : null;
        const yoff = lv * gap * (up ? 1 : -1);
        if (mk === 'begin') start = i;
        else if (mk === 'continue') { /* extend */ }
        else if (mk === 'end' && start != null) { poly(start, i, yoff); start = null; }
        else if (mk === 'forward hook') hook(i, 1, yoff);
        else if (mk === 'backward hook') hook(i, -1, yoff);
      });
    }
    function poly(a, b, yoff) {
      const x1 = xs[a] - stemW / 2, x2 = xs[b] + stemW / 2;
      const y1 = yOf(s, p(x1)) + yoff, y2 = yOf(s, p(x2)) + yoff;
      const t = up ? th : -th;
      polys.push('M' + f(x1) + ' ' + f(y1) + 'L' + f(x2) + ' ' + f(y2) + 'L' + f(x2) + ' ' + f(y2 + t) + 'L' + f(x1) + ' ' + f(y1 + t) + 'Z');
    }
    function hook(i, d, yoff) {
      const len = 1.1 * S;
      const xa = d > 0 ? xs[i] - stemW / 2 : xs[i] - len, xb = d > 0 ? xs[i] + len : xs[i] + stemW / 2;
      const y1 = yOf(s, p(xa)) + yoff, y2 = yOf(s, p(xb)) + yoff, t = up ? th : -th;
      polys.push('M' + f(xa) + ' ' + f(y1) + 'L' + f(xb) + ' ' + f(y2) + 'L' + f(xb) + ' ' + f(y2 + t) + 'L' + f(xa) + ' ' + f(y1 + t) + 'Z');
    }
    el('path', { d: polys.join(''), class: 'sh-ink' }, g);
    void x; void half;
  }

  function drawTuplets(g, lines, p, s, it, yOf, S, lay) {
    for (const vrecs of p.staves[s]) {
      let i = 0;
      while (i < vrecs.length) {
        const r = vrecs[i];
        if (r.ev.tu && r.ev.tu.start) {
          let j = i;
          while (j + 1 < vrecs.length && !(vrecs[j].ev.tu && vrecs[j].ev.tu.stop)) j++;
          const grp = vrecs.slice(i, j + 1);
          const notesGrp = grp.filter((x) => x.notes);
          const up = notesGrp.length ? notesGrp[0].dir !== 'down' : (r.nVoices > 1 ? r.voice === 0 : true);
          const beamed = notesGrp.length === grp.length && grp.every((x) => x.inBeam);
          const x1 = colX(it, grp[0]) + (L.HW * S) / 2, x2 = colX(it, grp[grp.length - 1]) + (L.HW * S) / 2;
          let pos;
          if (notesGrp.length) pos = up ? Math.max(...notesGrp.map((x) => (x.tipPos != null ? x.tipPos : x.top + 7))) + 3 : Math.min(...notesGrp.map((x) => (x.tipPos != null ? x.tipPos : x.bot - 7))) - 3;
          else pos = up ? 11 : -3;
          const y = yOf(s, pos);
          const bracket = r.ev.tu.bracket === true || (!beamed && r.ev.tu.bracket !== false);
          const xm = (x1 + x2) / 2;
          el('rect', { x: f(xm - 0.7 * S), y: f(y - 0.8 * S), width: f(1.4 * S), height: f(1.6 * S), class: 'sh-paper' }, g);
          const t = el('text', { x: f(xm), y: f(y + 0.4 * S), 'text-anchor': 'middle', class: 'sh-tup', 'font-size': f(Math.max(12, 1.3 * S)) }, g);
          t.textContent = String(r.ev.tu.a);
          if (bracket && x2 - x1 > 2.5 * S) {
            const dy = up ? 0.7 * S : -0.7 * S;
            lines.push('M' + f(x1) + ' ' + f(y + dy) + 'L' + f(x1) + ' ' + f(y) + 'L' + f(xm - 0.9 * S) + ' ' + f(y));
            lines.push('M' + f(xm + 0.9 * S) + ' ' + f(y) + 'L' + f(x2) + ' ' + f(y) + 'L' + f(x2) + ' ' + f(y + dy));
          }
          i = j + 1;
        } else i++;
      }
    }
  }

  /** x and y of a notehead, without drawing (used for ties and cross marks). */
  function spotOf(lay, wi, s, rec, nt) {
    const wh = lay.where[wi], sys = lay.systems[wh.sys], it = sys.items[wh.idx];
    const S = lay.S, hw = L.HW * S;
    const x = it.colX[rec.col] + (nt.disp > 0 ? hw - 0.1 * S : nt.disp < 0 ? -hw + 0.1 * S : 0);
    const y = (s === 0 ? sys.y1 : sys.y2) + 4 * S - nt.pos * S / 2;
    return { x, y, sys: wh.sys, it };
  }

  function drawTies(g, lay, wi, s, vi, ri, rec, it, yOf, S) {
    const nota = lay.nota, half = S / 2;
    for (const nt of rec.notes) {
      if (!nt.n.ts) continue;
      // find the partner: next event of this voice with the same pitch
      let partner = null, pwi = wi;
      const p = lay.prep[wi];
      const list = p.staves[s][vi];
      for (let k = ri + 1; k < list.length && !partner; k++) { const q = list[k]; if (q.notes) { const m = q.notes.find((x) => x.n.m === nt.n.m); if (m) partner = { rec: q, nt: m }; break; } }
      if (!partner) {
        pwi = wi + 1;
        if (pwi < nota.written.length) {
          const pp = L.prepare(lay, pwi), v2 = pp.staves[s][vi] || pp.staves[s][0] || [];
          for (const q of v2) { if (q.notes) { const m = q.notes.find((x) => x.n.m === nt.n.m); if (m) partner = { rec: q, nt: m }; break; } }
        }
      }
      const above = rec.nVoices > 1 ? rec.voice === 0 : rec.dir ? rec.dir === 'down' : nt.pos >= 4;
      const sgn = above ? -1 : 1;
      const hw = L.HW * S;
      const y = nt.y + sgn * 0.5 * S;
      const a = spotOf(lay, wi, s, rec, nt);
      const xa = a.x + hw + (rec.dots ? 0.7 * S : 0.15 * S);
      let xb, xa2 = xa;
      if (partner) {
        const b = spotOf(lay, pwi, s, partner.rec, partner.nt);
        if (b.sys === a.sys) xb = b.x - 0.15 * S;
        else { xb = a.it.x1 - 0.5 * S; tieCurve(g, b.x - 2.6 * S, b.x - 0.15 * S, b.y + sgn * 0.5 * S, sgn, S); }
      } else xb = a.it.x1 - 0.5 * S;
      if (xb - xa2 < 1.2 * S) xb = xa2 + 1.2 * S;
      tieCurve(g, xa2, xb, y, sgn, S);
    }
  }
  function tieCurve(g, x1, x2, y, sgn, S) {
    const len = x2 - x1, h = Math.min(1.5 * S, 0.5 * S + len * 0.05) * sgn, h2 = h * 0.6;
    const cx = (x1 + x2) / 2;
    el('path', { d: 'M' + f(x1) + ' ' + f(y) + 'Q' + f(cx) + ' ' + f(y + h * 1.9) + ' ' + f(x2) + ' ' + f(y) + 'Q' + f(cx) + ' ' + f(y + h2 * 1.9) + ' ' + f(x1) + ' ' + f(y) + 'Z', class: 'sh-ink' }, g);
  }

  /** Every system of a song in one standalone SVG, with a list of the drawn noteheads and the song notes they show
   * (used by the import review to tap a note and fix it). Notation is rebuilt from the notes so each head links back. */
  let hits = null;
  SH.fixView = function (song, width, S) {
    const svg = el('svg', { class: 'sheet-svg fix-svg', role: 'img', 'aria-label': 'The music as read. Tap a note to fix it.' });
    const nota = W.notation.fromNotes(song);
    const lay = L.compute(nota, width, S);
    hits = [];
    try { lay.systems.forEach((_, si) => drawSystem(lay, si, el('g', { class: 'sh-sys', 'data-sys': si }, svg))); }
    finally { svg.hits = hits; hits = null; }
    svg.setAttribute('width', f(lay.width)); svg.setAttribute('height', f(lay.height));
    svg.setAttribute('viewBox', '0 0 ' + f(lay.width) + ' ' + f(lay.height));
    svg.lay = lay;
    return svg;
  };

  /** Draw the first system of a song into a standalone SVG (used by the import review). */
  SH.preview = function (song, width, S) {
    const svg = el('svg', { class: 'sheet-svg preview-svg', role: 'img', 'aria-label': 'Preview of the first bars' });
    if (!song || !song.notation) return svg;
    const lay = L.compute(song.notation, width, S);
    const sys = lay.systems[0];
    if (!sys) return svg;
    const g = el('g', { class: 'sh-sys' }, svg);
    drawSystem(lay, 0, g);
    const hgt = sys.bottom + S;
    svg.setAttribute('width', f(lay.width)); svg.setAttribute('height', f(hgt));
    svg.setAttribute('viewBox', '0 0 ' + f(lay.width) + ' ' + f(hgt));
    return svg;
  };

  // ------------------------------------------------------------------ the sheet pane
  SH.mount = function (scroller) {
    SH.scroller = scroller;
    SH.svg = el('svg', { class: 'sheet-svg', role: 'img', 'aria-label': 'Sheet music' });
    scroller.appendChild(SH.svg);
    SH.cursor = el('rect', { class: 'sh-cursor', width: 2, height: 10, x: -10, y: 0 }, SH.svg);
    SH.missG = el('g', { class: 'sh-miss' }, SH.svg);
    SH.svg.addEventListener('click', onClick);
    scroller.addEventListener('scroll', () => { SH.renderVisible(); }, { passive: true });
  };

  SH.layout = function (width, S) {
    const song = E.song;
    SH.S = S;
    SH.rendered.clear(); SH.curSys = -1; SH.missKey = '';
    // keep the cursor and miss group, drop the systems
    [...SH.svg.querySelectorAll('g.sh-sys')].forEach((n) => n.remove());
    if (!song || !song.notation) { SH.lay = null; return; }
    SH.lay = L.compute(song.notation, width, S);
    SH.svg.setAttribute('width', f(SH.lay.width)); SH.svg.setAttribute('height', f(SH.lay.height));
    SH.svg.setAttribute('viewBox', '0 0 ' + f(SH.lay.width) + ' ' + f(SH.lay.height));
    SH.renderVisible();
  };

  SH.renderSystem = function (si) {
    if (SH.rendered.has(si) || !SH.lay) return;
    SH.rendered.add(si);
    const g = el('g', { class: 'sh-sys', 'data-sys': si });
    SH.svg.insertBefore(g, SH.cursor);
    drawSystem(SH.lay, si, g);
  };
  SH.renderVisible = function () {
    const lay = SH.lay;
    if (!lay) return;
    const top = SH.scroller.scrollTop, h = SH.scroller.clientHeight || 600;
    for (let i = 0; i < lay.systems.length; i++) {
      const s = lay.systems[i];
      if (s.bottom >= top - h && s.top <= top + 2 * h) SH.renderSystem(i);
    }
  };

  function onClick(e) {
    const lay = SH.lay;
    if (!lay) return;
    const r = SH.svg.getBoundingClientRect();
    const x = (e.clientX - r.left) * (lay.width / r.width), y = (e.clientY - r.top) * (lay.height / r.height);
    const si = lay.systems.findIndex((s) => y >= s.top - lay.S * 0.5 && y <= s.bottom + lay.S * 0.5);
    if (si < 0) return;
    const sys = lay.systems[si];
    let mk = sys.items.findIndex((it) => x >= it.x0 && x < it.x1);
    if (mk < 0) mk = x < sys.items[0].x0 ? 0 : sys.items.length - 1;
    const wi = sys.items[mk].wi;
    // first playback bar that plays this written bar (after the current one when repeats play it twice)
    const pm = lay.nota.playMap;
    const cur = E.measureIndexAt(E.q);
    let target = pm.indexOf(wi);
    for (let i = cur + 1; i < pm.length; i++) if (pm[i] === wi && pm[cur] !== wi) { target = pm.indexOf(wi); break; }
    if (target < 0) return;
    E.seekMeasure(target + 1);
  }

  /** Update the cursor and scroll by whole systems. */
  SH.update = function (q, force) {
    const lay = SH.lay, song = E.song;
    if (!lay || !song || !SH.scroller.clientHeight) return;
    const mi = E.measureIndexAt(q);
    const c = L.cursorAt(lay, song, q, mi);
    if (!c) return;
    SH.cursor.setAttribute('x', f(c.x)); SH.cursor.setAttribute('y', f(c.top + lay.S * 1.2)); SH.cursor.setAttribute('height', f(c.y2 - c.top - lay.S * 1.2));
    if (c.sys !== SH.curSys || force) {
      SH.curSys = c.sys;
      const sys = lay.systems[c.sys];
      const top = SH.scroller.scrollTop, h = SH.scroller.clientHeight;
      if (sys.top < top + 2 || sys.bottom > top + h - 2) SH.scroller.scrollTop = Math.max(0, Math.min(sys.top - lay.S * 0.8, sys.bottom + lay.S - h));
      SH.renderVisible();
      SH.renderSystem(c.sys);
    }
  };

  /** Small crosses under the notes that were missed. */
  SH.updateMisses = function () {
    const lay = SH.lay, song = E.song;
    if (!lay || !song) return;
    const { n, nq, nm, nh } = E.get();
    const marks = [];
    for (let i = 0; i < n; i++) if (E.noteStatus(i) === 2 && E.isPractised(i)) marks.push(i);
    const key = marks.join(',');
    if (key === SH.missKey) return;
    SH.missKey = key;
    SH.missG.textContent = '';
    const S = lay.S;
    const idx = new Map();
    for (const i of marks.slice(0, 600)) {
      const mi = E.measureIndexAt(nq[i]), wi = lay.nota.playMap[mi], m = song.measures[mi];
      if (!lay.where[wi]) continue;
      const p = L.prepare(lay, wi), t = nq[i] - m.q;
      const s = nh[i] === 0 ? 0 : (lay.nota.nstaves > 1 ? 1 : 0);
      for (const v of p.staves[s] || []) for (const rec of v) {
        if (!rec.notes || Math.abs(rec.t - t) > 0.02) continue;
        const nt = rec.notes.find((x) => x.n.m === nm[i]);
        if (!nt) continue;
        const sp = spotOf(lay, wi, s, rec, nt);
        const k = sp.x + ':' + sp.y;
        if (idx.has(k)) continue; idx.set(k, 1);
        const cx = sp.x + L.HW * S / 2, cy = sp.y + 1.6 * S, d = 0.45 * S;
        el('path', { d: 'M' + f(cx - d) + ' ' + f(cy - d) + 'L' + f(cx + d) + ' ' + f(cy + d) + 'M' + f(cx + d) + ' ' + f(cy - d) + 'L' + f(cx - d) + ' ' + f(cy + d), class: 'sh-cross' }, SH.missG);
      }
    }
  };
})();
