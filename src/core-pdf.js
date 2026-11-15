/* PDF reader: turns a PDF exported from notation software (MuseScore, Dorico, Finale and others that use an SMuFL music font)
 * into MusicXML. It reads the vector drawing, not pixels: staff lines, barlines, stems and beams are drawn lines and shapes,
 * and noteheads, clefs, accidentals, rests and flags are font symbols with standard SMuFL codes. Scans and photos have neither,
 * so they are refused with a clear message.
 *
 * W.pdf.read(u8, fileName) -> Promise<{ xml, title, report: { pages, systems, measures, notes, staves, warnings } }>
 */
(function () {
  'use strict';
  const W = window.Wapiro, U = W.util;
  const P = (W.pdf = {});

  // ---------------------------------------------------------------- pdf.js, bundled in this file and loaded only when a PDF is opened
  let libP = null;
  P.lib = function () {
    if (!libP) libP = (async () => {
      const a = document.getElementById('pdfjs-main'), b = document.getElementById('pdfjs-worker');
      if (!a || !b) throw new Error('The PDF reader is not included in this copy of the app.');
      const url = (s) => URL.createObjectURL(new Blob([s], { type: 'text/javascript' }));
      const lib = await import(url(a.textContent));
      // run the pdf.js worker code on the main thread: no extra files and no network
      globalThis.pdfjsWorker = await import(url(b.textContent));
      if (lib.GlobalWorkerOptions) lib.GlobalWorkerOptions.workerSrc = '';
      return lib;
    })();
    libP.catch(() => { libP = null; });
    return libP;
  };

  // ---------------------------------------------------------------- SMuFL symbols the reader understands
  const SYM = {};
  const def = (cp, name, extra) => { SYM[cp] = Object.assign({ name }, extra || {}); };
  def(0xE0A0, 'head', { kind: 'breve' }); def(0xE0A2, 'head', { kind: 'whole' }); def(0xE0A3, 'head', { kind: 'half' }); def(0xE0A4, 'head', { kind: 'black' });
  def(0xE0A5, 'head', { kind: 'black' }); def(0xE0A9, 'head', { kind: 'black', x: 1 }); def(0xE0FA, 'head', { kind: 'black' }); def(0xE0FB, 'head', { kind: 'half' });
  def(0xE050, 'clef', { clef: 'G' }); def(0xE052, 'clef', { clef: 'G', oct: -1 }); def(0xE053, 'clef', { clef: 'G', oct: 1 }); def(0xE07A, 'clef', { clef: 'G' });
  def(0xE062, 'clef', { clef: 'F' }); def(0xE064, 'clef', { clef: 'F', oct: -1 }); def(0xE07C, 'clef', { clef: 'F' }); def(0xE05C, 'clef', { clef: 'C' });
  def(0xE260, 'acc', { alter: -1 }); def(0xE261, 'acc', { alter: 0 }); def(0xE262, 'acc', { alter: 1 }); def(0xE263, 'acc', { alter: 2 }); def(0xE264, 'acc', { alter: -2 });
  def(0xE4E2, 'rest', { q: 8 }); def(0xE4E3, 'rest', { q: 4 }); def(0xE4E4, 'rest', { q: 2 }); def(0xE4E5, 'rest', { q: 1 }); def(0xE4E6, 'rest', { q: 0.5 });
  def(0xE4E7, 'rest', { q: 0.25 }); def(0xE4E8, 'rest', { q: 0.125 }); def(0xE4E9, 'rest', { q: 0.0625 });
  def(0xE240, 'flag', { n: 1 }); def(0xE241, 'flag', { n: 1 }); def(0xE242, 'flag', { n: 2 }); def(0xE243, 'flag', { n: 2 }); def(0xE244, 'flag', { n: 3 }); def(0xE245, 'flag', { n: 3 });
  def(0xE246, 'flag', { n: 4 }); def(0xE247, 'flag', { n: 4 });
  def(0xE1E7, 'dot');
  for (let d = 0; d <= 9; d++) { def(0xE080 + d, 'tdigit', { d }); def(0xE880 + d, 'tupdigit', { d }); }
  def(0xE08A, 'tcommon'); def(0xE08B, 'tcut');
  def(0xE000, 'brace'); def(0xE043, 'repeatDots'); def(0xE044, 'repeatDot');
  const isMusicCp = (cp) => cp >= 0xE000 && cp <= 0xF8FF;

  // ---------------------------------------------------------------- 1. read the drawing of a page
  const mul = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
  const app = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

  async function extractPage(page, lib) {
    const O = lib.OPS;
    const view = page.view, H = view[3], X0 = view[0], Y0 = view[1];
    const toPage = (m, x, y) => { const p = app(m, x, y); return [p[0] - X0, H - (p[1] - Y0) - 0]; };
    const ol = await page.getOperatorList();
    const out = { glyphs: [], texts: [], segs: [], beams: [], blobs: [], curves: [], width: view[2] - view[0], height: view[3] - view[1] };
    let ctm = [1, 0, 0, 1, 0, 0], lw = 1;
    const stack = [];
    let tm = [1, 0, 0, 1, 0, 0], tlm = tm, fs = 12, cs = 0, ws = 0, hs = 1, rise = 0, leading = 0, font = '';
    const scaleOf = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
    const moveText = (tx, ty) => { tlm = mul([1, 0, 0, 1, tx, ty], tlm); tm = tlm; };
    const showGlyphs = (arr) => {
      for (const g of arr) {
        if (typeof g === 'number') { tm = mul([1, 0, 0, 1, -g / 1000 * fs * hs, 0], tm); continue; }
        if (!g) continue;
        const full = mul(tm, ctm);
        const p = toPage(full, 0, rise);
        const size = fs * scaleOf(full);
        const uni = g.unicode || '';
        const cp = uni.codePointAt(0);
        if (cp != null && isMusicCp(cp)) out.glyphs.push({ cp, sym: SYM[cp] || null, x: p[0], y: p[1], size });
        else if (uni.trim()) out.texts.push({ ch: uni, x: p[0], y: p[1], size, font, w: (g.width || 500) / 1000 * size * hs });
        const adv = ((g.width || 0) / 1000 * fs + cs + (g.isSpace ? ws : 0)) * hs;
        tm = mul([1, 0, 0, 1, adv, 0], tm);
      }
    };
    const fnA = ol.fnArray, argA = ol.argsArray;
    for (let i = 0; i < fnA.length; i++) {
      const fn = fnA[i], a = argA[i];
      switch (fn) {
        case O.save: stack.push([ctm, lw]); break;
        case O.restore: if (stack.length) [ctm, lw] = stack.pop(); break;
        case O.transform: ctm = mul(a, ctm); break;
        case O.paintFormXObjectBegin: stack.push([ctm, lw]); if (a && a[0]) ctm = mul(a[0], ctm); break;
        case O.paintFormXObjectEnd: if (stack.length) [ctm, lw] = stack.pop(); break;
        case O.setLineWidth: lw = a[0]; break;
        case O.setGState: for (const kv of a[0] || []) if (kv[0] === 'LW') lw = kv[1]; break;
        case O.beginText: tm = tlm = [1, 0, 0, 1, 0, 0]; break;
        case O.setFont: font = a[0]; fs = a[1]; break;
        case O.setTextMatrix: { const m = Array.isArray(a[0]) || ArrayBuffer.isView(a[0]) ? a[0] : a; tm = tlm = Array.from(m); break; }
        case O.moveText: moveText(a[0], a[1]); break;
        case O.setLeadingMoveText: leading = -a[1]; moveText(a[0], a[1]); break;
        case O.setLeading: leading = a[0]; break;
        case O.nextLine: moveText(0, -leading); break;
        case O.setCharSpacing: cs = a[0]; break;
        case O.setWordSpacing: ws = a[0]; break;
        case O.setHScale: hs = a[0] / 100; break;
        case O.setTextRise: rise = a[0]; break;
        case O.showText: case O.showSpacedText: showGlyphs(a[0]); break;
        case O.nextLineShowText: moveText(0, -leading); showGlyphs(a[0]); break;
        case O.nextLineSetSpacingShowText: ws = a[0]; cs = a[1]; moveText(0, -leading); showGlyphs(a[2]); break;
        case O.constructPath: readPath(a, ctm, lw, toPage, scaleOf, O, out); break;
        default: break;
      }
    }
    return out;
  }

  function readPath(a, ctm, lw, toPage, scaleOf, O, out) {
    const paint = a[0], data = a[1] && a[1][0];
    if (!data) return;
    const stroke = paint === O.stroke || paint === O.closeStroke;
    const fill = paint === O.fill || paint === O.eoFill || paint === O.fillStroke || paint === O.eoFillStroke || paint === O.closeFillStroke || paint === O.closeEOFillStroke;
    if (!stroke && !fill) return;
    const subs = [];
    let cur = null;
    for (let k = 0; k < data.length;) {
      const op = data[k++];
      if (op === 0) { cur = { pts: [toPage(ctm, data[k], data[k + 1])], curve: false }; subs.push(cur); k += 2; }
      else if (op === 1) { if (cur) cur.pts.push(toPage(ctm, data[k], data[k + 1])); k += 2; }
      else if (op === 2) { if (cur) { cur.curve = true; cur.pts.push(toPage(ctm, data[k], data[k + 1]), toPage(ctm, data[k + 2], data[k + 3]), toPage(ctm, data[k + 4], data[k + 5])); } k += 6; }
      else if (op === 3) { if (cur) { cur.curve = true; cur.pts.push(toPage(ctm, data[k], data[k + 1]), toPage(ctm, data[k + 2], data[k + 3])); } k += 4; }
      else if (op === 4) { if (cur) cur.closed = true; }
      else break;
    }
    const w = lw * scaleOf(ctm);
    for (const s of subs) {
      const xs = s.pts.map((p) => p[0]), ys = s.pts.map((p) => p[1]);
      const bb = { x1: Math.min(...xs), x2: Math.max(...xs), y1: Math.min(...ys), y2: Math.max(...ys) };
      const bw = bb.x2 - bb.x1, bh = bb.y2 - bb.y1;
      if (stroke) {
        if (s.curve) { out.curves.push({ bb, pts: s.pts }); continue; }
        for (let k = 1; k < s.pts.length; k++) out.segs.push(seg(s.pts[k - 1], s.pts[k], w));
        if (s.closed && s.pts.length > 2) out.segs.push(seg(s.pts[s.pts.length - 1], s.pts[0], w));
        continue;
      }
      if (s.curve) {
        if (bw > 0 && bh > 0 && Math.abs(bw - bh) < 0.3 * Math.max(bw, bh)) out.blobs.push({ x: (bb.x1 + bb.x2) / 2, y: (bb.y1 + bb.y2) / 2, r: (bw + bh) / 4 });
        else out.curves.push({ bb, pts: s.pts });
        continue;
      }
      const uniq = s.pts.filter((p, k) => k === 0 || Math.abs(p[0] - s.pts[k - 1][0]) + Math.abs(p[1] - s.pts[k - 1][1]) > 1e-3);
      if (uniq.length > 1 && Math.abs(uniq[0][0] - uniq[uniq.length - 1][0]) + Math.abs(uniq[0][1] - uniq[uniq.length - 1][1]) < 1e-3) uniq.pop();
      if (uniq.length !== 4) continue;
      const axis = uniq.every((p) => (Math.abs(p[0] - bb.x1) < 0.05 || Math.abs(p[0] - bb.x2) < 0.05) && (Math.abs(p[1] - bb.y1) < 0.05 || Math.abs(p[1] - bb.y2) < 0.05));
      if (axis) {
        if (bw <= bh) out.segs.push({ x1: (bb.x1 + bb.x2) / 2, y1: bb.y1, x2: (bb.x1 + bb.x2) / 2, y2: bb.y2, w: bw, v: true });
        else out.segs.push({ x1: bb.x1, y1: (bb.y1 + bb.y2) / 2, x2: bb.x2, y2: (bb.y1 + bb.y2) / 2, w: bh, h: true, rect: true });
        if (bw > bh * 2 && bh > 0) out.beams.push(beamOf(uniq));
        continue;
      }
      out.beams.push(beamOf(uniq));
    }
  }
  function seg(p, q, w) {
    const x1 = Math.min(p[0], q[0]), x2 = Math.max(p[0], q[0]);
    const v = Math.abs(p[0] - q[0]) < 0.25 && Math.abs(p[1] - q[1]) > 0.5, hz = Math.abs(p[1] - q[1]) < 0.25;
    return v ? { x1: (p[0] + q[0]) / 2, x2: (p[0] + q[0]) / 2, y1: Math.min(p[1], q[1]), y2: Math.max(p[1], q[1]), w, v: true } : hz ? { x1, x2, y1: (p[1] + q[1]) / 2, y2: (p[1] + q[1]) / 2, w, h: true } : { x1: p[0], y1: p[1], x2: q[0], y2: q[1], w };
  }
  /** A filled quadrilateral as a beam candidate: centre line from the left edge to the right edge, and its thickness. */
  function beamOf(pts) {
    const s = pts.slice().sort((a, b) => a[0] - b[0]);
    const L = [s[0], s[1]], R = [s[2], s[3]];
    const lx = (L[0][0] + L[1][0]) / 2, rx = (R[0][0] + R[1][0]) / 2;
    const ly = (L[0][1] + L[1][1]) / 2, ry = (R[0][1] + R[1][1]) / 2;
    return { x1: lx, x2: rx, y1: ly, y2: ry, th: Math.abs(L[0][1] - L[1][1]), vert: Math.abs(L[0][0] - L[1][0]) < 0.3 };
  }

  // ---------------------------------------------------------------- 2. staves and systems
  function findStaves(pg) {
    const hs = pg.segs.filter((s) => s.h && s.x2 - s.x1 > 30).sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1);
    // merge collinear pieces
    const lines = [];
    for (const s of hs) {
      const l = lines.find((t) => Math.abs(t.y - s.y1) < 0.3 && s.x1 <= t.x2 + 3 && s.x2 >= t.x1 - 3);
      if (l) { l.x1 = Math.min(l.x1, s.x1); l.x2 = Math.max(l.x2, s.x2); } else lines.push({ y: s.y1, x1: s.x1, x2: s.x2, w: s.w });
    }
    lines.sort((a, b) => a.y - b.y);
    const used = new Set(), staves = [];
    for (let i = 0; i < lines.length; i++) {
      if (used.has(i)) continue;
      const a = lines[i], grp = [i];
      for (let j = i + 1; j < lines.length && grp.length < 5; j++) {
        if (used.has(j)) continue;
        const b = lines[j];
        const ov = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
        if (ov < 0.8 * Math.min(a.x2 - a.x1, b.x2 - b.x1)) continue;
        const prev = lines[grp[grp.length - 1]];
        const gap = b.y - prev.y;
        if (grp.length === 1) { if (gap > 2 && gap < 40) grp.push(j); else if (gap >= 40) break; }
        else { const d0 = lines[grp[1]].y - lines[grp[0]].y; if (Math.abs(gap - d0) < 0.18 * d0) grp.push(j); else if (gap > d0 * 1.2) break; }
      }
      if (grp.length === 5) {
        grp.forEach((k) => used.add(k));
        const ys = grp.map((k) => lines[k].y);
        staves.push({ ys, top: ys[0], bot: ys[4], sp: (ys[4] - ys[0]) / 4, x1: Math.min(...grp.map((k) => lines[k].x1)), x2: Math.max(...grp.map((k) => lines[k].x2)) });
      }
    }
    return staves;
  }
  function pairSystems(pg, staves) {
    const vs = pg.segs.filter((s) => s.v);
    const systems = [];
    for (let i = 0; i < staves.length; i++) {
      const A = staves[i], B = staves[i + 1];
      let joined = false;
      if (B && B.top > A.bot && B.top - A.bot < 14 * A.sp) {
        joined = vs.some((s) => s.y1 <= A.top + 0.4 * A.sp && s.y2 >= B.bot - 0.4 * A.sp && s.x1 >= Math.min(A.x1, B.x1) - A.sp && s.x1 <= Math.max(A.x2, B.x2) + A.sp) ||
          pg.glyphs.some((g) => g.sym && g.sym.name === 'brace' && g.x < A.x1 + A.sp && Math.abs(g.y - B.bot) < 3 * A.sp);
      }
      if (joined) { systems.push({ staves: [A, B] }); i++; } else systems.push({ staves: [A] });
    }
    // each system owns the page band up to halfway to its neighbours
    systems.forEach((sy, k) => {
      const sp = sy.staves[0].sp, t = sy.staves[0].top, b = sy.staves[sy.staves.length - 1].bot;
      const prev = systems[k - 1], next = systems[k + 1];
      sy.bandTop = prev ? (prev.staves[prev.staves.length - 1].bot + t) / 2 : t - 12 * sp;
      sy.bandBot = next ? (b + next.staves[0].top) / 2 : b + 12 * sp;
    });
    return systems;
  }

  // ---------------------------------------------------------------- 3. symbols per staff
  function staffOf(sys, y) {
    let best = null, bd = Infinity;
    sys.staves.forEach((s, k) => { const d = y < s.top ? s.top - y : y > s.bot ? y - s.bot : 0; if (d < bd) { bd = d; best = k; } });
    return bd <= 9 * sys.staves[0].sp ? best : null;
  }
  const BASE = { G: 30, F: 18, C: 24 }; // diatonic number of the bottom line (E4, G2, F3 for an alto clef)

  function readSystem(pg, sys, ctx) {
    const sp = sys.staves[0].sp, x1 = Math.min(...sys.staves.map((s) => s.x1)), x2 = Math.max(...sys.staves.map((s) => s.x2));
    const inX = (x) => x >= x1 - 2 * sp && x <= x2 + sp;
    const top = sys.bandTop != null ? sys.bandTop : sys.staves[0].top - 9 * sp, bot = sys.bandBot != null ? sys.bandBot : sys.staves[sys.staves.length - 1].bot + 9 * sp;
    const mine = (o) => inX(o.x) && o.y >= top && o.y <= bot;
    const glyphs = pg.glyphs.filter(mine).map((g) => Object.assign({ staff: staffOf(sys, g.y) }, g)).filter((g) => g.staff != null);
    const kind = (n) => glyphs.filter((g) => g.sym && g.sym.name === n);
    const HW = 1.18 * sp;
    const heads = kind('head').map((g) => {
      const s = sys.staves[g.staff];
      return { g, staff: g.staff, x: g.x, xr: g.x + HW, y: g.y, pos: Math.round((s.bot - g.y) / (sp / 2)), kind: g.sym.kind, chord: null };
    });
    if (!heads.length) return null;
    // stems: vertical lines next to a notehead edge
    const vsegs = pg.segs.filter((s) => s.v && inX(s.x1) && s.y2 >= top && s.y1 <= bot);
    const barlines = [];
    const near = (a, b) => Math.abs(a - b) < 0.25 * sp;
    const tops = sys.staves.map((st) => st.top), bots = sys.staves.map((st) => st.bot);
    for (const s of vsegs) {
      // a barline starts and ends exactly on staff lines (top of a staff to the bottom of the same or a lower staff)
      const ti = tops.findIndex((t) => near(s.y1, t)), bi = bots.findIndex((b) => near(s.y2, b));
      if (ti < 0 || bi < 0 || bi < ti) continue;
      const atHead = heads.some((h) => (Math.abs(h.x - s.x1) < 0.3 * sp || Math.abs(h.xr - s.x1) < 0.3 * sp) && h.y > s.y1 - 0.6 * sp && h.y < s.y2 + 0.6 * sp && (near(h.y, s.y1) || near(h.y, s.y2) || Math.abs(h.y - s.y1) < 0.6 * sp || Math.abs(h.y - s.y2) < 0.6 * sp));
      if (atHead && bi === ti) continue;
      for (let k = ti; k <= bi; k++) barlines.push({ x: s.x1, w: s.w, staff: k });
      s.bar = true;
    }
    const stems = vsegs.filter((s) => !s.bar && s.y2 - s.y1 > 1.5 * sp && s.y2 - s.y1 < 12 * sp);
    const chords = [];
    for (const st of stems) {
      const att = heads.filter((h) => h.kind !== 'whole' && h.kind !== 'breve' && h.y >= st.y1 - 0.6 * sp && h.y <= st.y2 + 0.6 * sp && (Math.abs(h.x - st.x1) < 0.4 * sp || Math.abs(h.xr - st.x1) < 0.4 * sp));
      if (!att.length) continue;
      const lo = Math.max(...att.map((h) => h.y)), hi = Math.min(...att.map((h) => h.y));
      const up = Math.abs(lo - st.y2) < Math.abs(hi - st.y1);
      const tipY = up ? st.y1 : st.y2;
      if (up ? (hi - st.y1 < 1.5 * sp) : (st.y2 - lo < 1.5 * sp)) continue;
      const free = att.filter((h) => !h.chord || h.chord.stemLen < st.y2 - st.y1);
      if (!free.length) continue;
      const c = { heads: [], stemX: st.x1, up, tipY, staff: free[0].staff, stemLen: st.y2 - st.y1, beams: 0, flags: 0, dots: 0, beamIds: new Set() };
      for (const h of free) { if (h.chord) h.chord.heads = h.chord.heads.filter((x) => x !== h); h.chord = c; c.heads.push(h); }
      chords.push(c);
    }
    for (const h of heads) if (!h.chord) {
      // whole notes (and heads without a stem): group heads at the same x into one chord
      const c = chords.find((c) => !c.stemX && c.staff === h.staff && Math.abs(c.heads[0].x - h.x) < 0.5 * sp) || null;
      if (c) { c.heads.push(h); h.chord = c; } else { const n = { heads: [h], stemX: 0, up: true, tipY: h.y, staff: h.staff, beams: 0, flags: 0, dots: 0, beamIds: new Set() }; h.chord = n; chords.push(n); }
    }
    const live = chords.filter((c) => c.heads.length);
    live.forEach((c) => {
      c.x = Math.min(...c.heads.map((h) => h.x));
      c.xr = Math.max(...c.heads.map((h) => h.xr));
      // the column x of a chord: the heads on the normal side of the stem
      const normal = c.stemX ? c.heads.filter((h) => (c.up ? Math.abs(h.xr - c.stemX) < 0.45 * sp : Math.abs(h.x - c.stemX) < 0.45 * sp)) : c.heads;
      c.col = normal.length ? Math.min(...normal.map((h) => h.x)) : c.x;
      c.kind = c.heads.some((h) => h.kind === 'breve') ? 'breve' : c.heads.some((h) => h.kind === 'whole') ? 'whole' : c.heads.some((h) => h.kind === 'half') ? 'half' : 'black';
    });
    // beams crossing the stem near its tip
    const beams = pg.beams.filter((b) => inX(b.x1) && b.th > 0.25 * sp && b.th < 1.2 * sp && b.x2 - b.x1 > 0.6 * sp && Math.abs(b.y2 - b.y1) < (b.x2 - b.x1) * 0.8);
    beams.forEach((b, k) => { b.id = k; });
    for (const c of live) {
      if (!c.stemX || c.kind !== 'black') continue;
      for (const b of beams) {
        if (c.stemX < b.x1 - 0.3 * sp || c.stemX > b.x2 + 0.3 * sp) continue;
        const t = (c.stemX - b.x1) / Math.max(1e-6, b.x2 - b.x1), by = b.y1 + (b.y2 - b.y1) * t;
        const d = c.up ? by - c.tipY : c.tipY - by;
        if (d > -0.6 * sp && d < 3.2 * sp) { c.beams++; c.beamIds.add(b.id); }
      }
    }
    for (const g of kind('flag')) {
      const c = live.find((c) => c.stemX && Math.abs(g.x - c.stemX) < 0.5 * sp && Math.abs(g.y - c.tipY) < 0.8 * sp);
      if (c) c.flags = Math.max(c.flags, g.sym.n);
    }
    // rests
    const rests = kind('rest').map((g) => ({ rest: true, x: g.x, col: g.x, xr: g.x + 1.1 * sp, y: g.y, staff: g.staff, q: g.sym.q, dots: 0, whole: g.sym.q >= 4 }));
    // dots: SMuFL dot glyphs or small filled circles to the right of a head or rest
    const dotPts = kind('dot').map((g) => ({ x: g.x + 0.2 * sp, y: g.y })).concat(pg.blobs.filter((b) => mine(b) && b.r > 0.1 * sp && b.r < 0.35 * sp).map((b) => ({ x: b.x, y: b.y })));
    const events = live.concat(rests);
    for (const d of dotPts) {
      let best = null, bd = Infinity;
      for (const e of events) {
        const ys = e.rest ? [e.y] : e.heads.map((h) => h.y);
        if (!ys.some((y) => Math.abs(d.y - y) < 0.75 * sp)) continue;
        const dx = d.x - e.xr;
        if (dx > 0 && dx < 2.4 * sp && dx < bd) { bd = dx; best = e; }
      }
      if (best) { (best.dotX = best.dotX || []).push(d.x); }
    }
    for (const e of events) if (e.dotX) { const cols = []; for (const x of e.dotX.sort((a, b) => a - b)) if (!cols.some((c) => Math.abs(c - x) < 0.3 * sp)) cols.push(x); e.dots = cols.length; }
    // tuplet numbers (SMuFL tuplet digits, or plain digits outside the staff) over a beamed group
    const tupGlyphs = kind('tupdigit').map((g) => ({ d: g.sym.d, x: g.x + 0.25 * g.size, y: g.y }));
    for (const t of pg.texts) if (/^[356]$/.test(t.ch) && mine(t)) { const k = staffOf(sys, t.y), s = sys.staves[k]; if (s && (t.y < s.top - 0.3 * sp || t.y > s.bot + 0.8 * sp || t.size < 2.2 * sp)) tupGlyphs.push({ d: +t.ch, x: t.x + t.w / 2, y: t.y, text: true }); }
    for (const t of tupGlyphs) {
      const grpIds = new Set();
      let cands = live.filter((c) => c.beams && Math.abs(c.stemX - t.x) < 4 * sp && Math.abs((c.up ? c.tipY : c.tipY) - t.y) < 4 * sp);
      if (!cands.length) continue;
      cands.forEach((c) => c.beamIds.forEach((id) => grpIds.add(id)));
      const grp = live.filter((c) => [...c.beamIds].some((id) => grpIds.has(id)) && Math.abs(c.stemX - t.x) < 6 * sp);
      const factor = t.d === 3 ? 2 / 3 : t.d === 5 ? 4 / 5 : t.d === 6 ? 4 / 6 : 1;
      for (const c of grp) if (!c.tup) c.tup = { a: t.d, n: Math.round(t.d * factor), f: factor };
    }
    // accidentals: to the left of a head at the same height
    const accs = kind('acc');
    for (const a of accs) {
      let best = null, bd = Infinity;
      for (const h of heads) { const dx = h.x - a.x; if (dx > 0.2 * sp && dx < 4.5 * sp && Math.abs(h.y - a.y) < 0.3 * sp && dx < bd) { bd = dx; best = h; } }
      if (best && (!best.acc || bd < best.accD)) { best.acc = a.sym.alter; best.accD = bd; a.used = true; }
    }
    // clefs and time signatures
    const clefs = kind('clef').map((g) => ({ x: g.x, staff: g.staff, clef: g.sym.clef, oct: g.sym.oct || 0 }));
    const firstEventX = Math.min(...events.map((e) => e.x));
    const digits = kind('tdigit').map((g) => ({ d: g.sym.d, x: g.x, y: g.y, staff: g.staff }));
    for (const t of pg.texts) if (/^\d$/.test(t.ch) && mine(t)) { const k = staffOf(sys, t.y), s = sys.staves[k]; if (s && t.y >= s.top - 0.2 * sp && t.y <= s.bot + 0.6 * sp && t.size >= 2.2 * sp) digits.push({ d: +t.ch, x: t.x, y: t.y, staff: k }); }
    const times = [];
    for (const k of [0]) {
      const ds = digits.filter((d) => d.staff === k).sort((a, b) => a.x - b.x);
      const st = sys.staves[k];
      const used = new Set();
      for (const d of ds) {
        if (used.has(d)) continue;
        const col = ds.filter((e) => !used.has(e) && Math.abs(e.x - d.x) < 1.6 * sp);
        col.forEach((e) => used.add(e));
        const mid = (st.top + st.bot) / 2;
        const upper = col.filter((e) => e.y <= mid + 0.3 * sp).sort((a, b) => a.x - b.x), lower = col.filter((e) => e.y > mid + 0.3 * sp).sort((a, b) => a.x - b.x);
        if (upper.length && lower.length) times.push({ x: d.x, num: +upper.map((e) => e.d).join(''), den: +lower.map((e) => e.d).join('') });
      }
      for (const g of kind('tcommon').filter((g) => g.staff === k)) times.push({ x: g.x, num: 4, den: 4 });
      for (const g of kind('tcut').filter((g) => g.staff === k)) times.push({ x: g.x, num: 2, den: 2 });
    }
    // key signature: accidentals after the first clef and before the first note that are not note accidentals
    let fifths = null;
    const firstClefX = Math.min(...clefs.filter((c) => c.x < firstEventX).map((c) => c.x), x1);
    const keyAcc = accs.filter((a) => !a.used && a.staff === 0 && a.x > firstClefX && a.x < firstEventX);
    if (keyAcc.length) { const n = keyAcc.length, sharp = keyAcc.filter((a) => a.sym.alter > 0).length >= n / 2; fifths = sharp ? n : -n; }
    else if (clefs.some((c) => c.x < firstEventX)) fifths = 0;
    // barlines: merge per x, find thick ones and repeat dots
    const bars = [];
    for (const b of barlines.sort((a, b) => a.x - b.x)) { const g = bars.find((x) => Math.abs(x.x2 - b.x) < 0.9 * sp); if (g) { g.x2 = Math.max(g.x2, b.x); g.x1 = Math.min(g.x1, b.x); g.thick = g.thick || b.w > 0.3 * sp; g.n++; } else bars.push({ x1: b.x, x2: b.x, thick: b.w > 0.3 * sp, n: 1 }); }
    const s0 = sys.staves[0];
    const rdots = pg.blobs.filter((b) => mine(b) && b.r > 0.1 * sp && b.r < 0.35 * sp && Math.abs(b.y - (s0.top + 1.5 * sp)) < 0.35 * sp).concat(kind('repeatDots').filter((g) => g.staff === 0).map((g) => ({ x: g.x, y: s0.top + 1.5 * sp })));
    for (const b of bars) {
      b.repEnd = rdots.some((d) => d.x < b.x1 && b.x1 - d.x < 1.6 * sp);
      b.repStart = rdots.some((d) => d.x > b.x2 && d.x - b.x2 < 1.6 * sp);
    }
    // ties: curves from one head to the next head at the same staff position
    const ties = [];
    for (const cv of pg.curves.filter((c) => inX(c.bb.x1) && c.bb.y1 >= top && c.bb.y2 <= bot && c.bb.x2 - c.bb.x1 > 0.8 * sp && c.bb.y2 - c.bb.y1 < 2.5 * sp)) {
      const left = cv.pts.reduce((m, p) => (p[0] < m[0] ? p : m)), right = cv.pts.reduce((m, p) => (p[0] > m[0] ? p : m));
      let A = null, ad = Infinity;
      for (const h of heads) { const dx = left[0] - h.xr; if (dx > -0.8 * sp && dx < 2.6 * sp && Math.abs(left[1] - h.y) < 1.2 * sp && dx < ad) { ad = dx; A = h; } }
      if (!A) continue;
      let B = null, bd = Infinity;
      for (const h of heads) { if (h === A || h.staff !== A.staff || h.pos !== A.pos || h.x <= A.x) continue; const dx = h.x - right[0]; if (dx > -0.8 * sp && dx < 1.8 * sp && dx < bd) { bd = dx; B = h; } }
      if (B) ties.push([A, B]);
      else if (x2 - right[0] < 2.5 * sp) A.tieOut = true; // continues on the next system
    }
    for (const [A, B] of ties) { A.tieStart = true; B.tieStop = true; }
    // endings: "1." "2." text above the top staff
    const endings = [];
    for (const t of pg.texts) if (/^[1-4]$/.test(t.ch) && mine(t) && t.y < s0.top - 2 * sp && t.y > s0.top - 8 * sp && t.size < 2 * sp) endings.push({ x: t.x, n: +t.ch });
    return { sp, x1, x2, staves: sys.staves, events, chords: live, rests, bars, clefs, times, fifths, endings, beams };
  }

  // ---------------------------------------------------------------- 4. measures, voices and durations
  const TYPES = [[8, 'breve'], [4, 'whole'], [2, 'half'], [1, 'quarter'], [0.5, 'eighth'], [0.25, '16th'], [0.125, '32nd'], [0.0625, '64th']];
  const typeOf = (base) => (TYPES.find((t) => Math.abs(t[0] - base) < 1e-6) || [1, 'quarter'])[1];

  function baseOf(e) {
    if (e.rest) return e.q;
    if (e.kind === 'breve') return 8;
    if (e.kind === 'whole') return 4;
    if (e.kind === 'half') return 2;
    const n = Math.max(e.beams, e.flags);
    return 1 / Math.pow(2, n);
  }
  function durOf(e, base) {
    let d = base, add = base / 2;
    for (let k = 0; k < e.dots; k++) { d += add; add /= 2; }
    if (e.tup) d *= e.tup.f;
    return d;
  }

  function measuresOf(sysR, nStaves) {
    const sp = sysR.sp;
    const xs = sysR.bars.map((b) => b);
    const firstEventX = Math.min(...sysR.events.map((e) => e.x));
    const cuts = [{ x2: sysR.x1 - 1, x1: sysR.x1 - 1, start: true }].concat(xs.filter((b) => b.x1 > sysR.x1 + sp));
    if (!xs.some((b) => b.x2 > sysR.x2 - 1.5 * sp)) cuts.push({ x1: sysR.x2, x2: sysR.x2, implicit: true });
    const out = [];
    for (let k = 0; k + 1 < cuts.length; k++) {
      const a = cuts[k], b = cuts[k + 1];
      const evs = sysR.events.filter((e) => e.col > a.x2 + 0.1 * sp && e.col < b.x1 - 0.1 * sp);
      if (!evs.length && b.x1 < firstEventX) continue;
      const time = sysR.times.find((t) => t.x > a.x2 - sp && t.x < (evs.length ? Math.min(...evs.map((e) => e.x)) : b.x1));
      const clefCh = sysR.clefs.filter((c) => c.x > a.x2 && c.x < b.x1);
      const ending = sysR.endings.find((en) => en.x > a.x2 - 0.5 * sp && en.x < b.x1);
      out.push({ x1: a.x2, x2: b.x1, evs, time: time || null, repStart: !!a.repStart, repEnd: !!b.repEnd, final: !!(b.thick && !b.repEnd && !b.repStart && k + 2 === cuts.length), ending: ending ? ending.n : null, clefCh, staves: nStaves });
    }
    return out;
  }

  /** Split one staff's events in a bar into voices and give each event an onset. */
  function voicesOf(evs, sp, staff) {
    const sorted = evs.slice().sort((a, b) => a.col - b.col);
    const col = (e) => e.col;
    let multi = false;
    for (let i = 0; i < sorted.length && !multi; i++) for (let j = i + 1; j < sorted.length; j++) {
      if (col(sorted[j]) - col(sorted[i]) > 0.6 * sp) break;
      multi = true; break;
    }
    if (!multi) return [sorted];
    const mid = (staff.top + staff.bot) / 2;
    const v1 = [], v2 = [];
    for (const e of sorted) {
      if (e.rest) (e.y < mid - 0.25 * sp ? v1 : e.y > mid + 0.25 * sp ? v2 : v1).push(e);
      else if (!e.stemX) (e.heads[0].y < mid ? v1 : v2).push(e);
      else (e.up ? v1 : v2).push(e);
    }
    return [v1, v2].filter((v) => v.length);
  }

  // ---------------------------------------------------------------- 5. MusicXML
  const DIV = 48;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

  function buildXml(score) {
    const L = [];
    L.push('<?xml version="1.0" encoding="UTF-8"?>', '<score-partwise version="4.0">',
      '<work><work-title>' + esc(score.title) + '</work-title></work>',
      '<identification>' + (score.composer ? '<creator type="composer">' + esc(score.composer) + '</creator>' : '') + '<encoding><software>MarkSteady Wapiro PDF reader ' + U.VERSION + '</software></encoding></identification>',
      '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>', '<part id="P1">');
    score.measures.forEach((m, mi) => {
      L.push('<measure number="' + (mi + 1) + '"' + (m.implicit ? ' implicit="yes"' : '') + '>');
      if (m.repStart || m.endingStart) L.push('<barline location="left">' + (m.repStart ? '<bar-style>heavy-light</bar-style><repeat direction="forward"/>' : '') + (m.endingStart ? '<ending number="' + m.endingStart + '" type="start"/>' : '') + '</barline>');
      const at = [];
      if (mi === 0) at.push('<divisions>' + DIV + '</divisions>');
      if (m.keyCh != null) at.push('<key><fifths>' + m.keyCh + '</fifths></key>');
      if (m.timeCh) at.push('<time><beats>' + m.timeCh.num + '</beats><beat-type>' + m.timeCh.den + '</beat-type></time>');
      if (mi === 0) at.push('<staves>' + score.nStaves + '</staves>');
      for (const c of m.clefCh || []) at.push('<clef number="' + (c.staff + 1) + '"><sign>' + c.clef + '</sign><line>' + (c.clef === 'G' ? 2 : c.clef === 'F' ? 4 : 3) + '</line>' + (c.oct ? '<clef-octave-change>' + c.oct + '</clef-octave-change>' : '') + '</clef>');
      if (at.length) L.push('<attributes>' + at.join('') + '</attributes>');
      if (mi === 0 && score.tempo) L.push('<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>' + score.tempo + '</per-minute></metronome></direction-type><staff>1</staff><sound tempo="' + score.tempo + '"/></direction>');
      const lenD = Math.round(m.lenQ * DIV);
      let pos = 0;
      m.voices.forEach((v, vi) => {
        if (pos > 0) { L.push('<backup><duration>' + pos + '</duration></backup>'); pos = 0; }
        let t = 0;
        for (const e of v.evs) {
          const startD = Math.round(e.onset * DIV);
          if (startD > t) { L.push('<forward><duration>' + (startD - t) + '</duration><voice>' + v.num + '</voice><staff>' + (v.staff + 1) + '</staff></forward>'); t = startD; }
          const d = Math.max(1, Math.round(e.dur * DIV));
          const common = (h) => {
            const x = [];
            x.push('<duration>' + d + '</duration>');
            if (h && h.tieStop) x.push('<tie type="stop"/>');
            if (h && h.tieStart) x.push('<tie type="start"/>');
            x.push('<voice>' + v.num + '</voice>', '<type>' + e.type + '</type>');
            for (let k = 0; k < e.dots; k++) x.push('<dot/>');
            if (h && h.acc != null) x.push('<accidental>' + ({ '-2': 'flat-flat', '-1': 'flat', 0: 'natural', 1: 'sharp', 2: 'double-sharp' }[h.acc]) + '</accidental>');
            if (e.tup) x.push('<time-modification><actual-notes>' + e.tup.a + '</actual-notes><normal-notes>' + e.tup.n + '</normal-notes></time-modification>');
            if (h && e.stemX && e.type !== 'whole' && e.type !== 'breve') x.push('<stem>' + (e.up ? 'up' : 'down') + '</stem>');
            x.push('<staff>' + (v.staff + 1) + '</staff>');
            return x;
          };
          if (e.rest) {
            L.push('<note><rest' + (e.measureRest ? ' measure="yes"' : '') + '/>' + common(null).join('') + '</note>');
          } else {
            e.heads.slice().sort((a, b) => a.dia - b.dia).forEach((h, k) => {
              const x = ['<note>'];
              if (k) x.push('<chord/>');
              x.push('<pitch><step>' + STEPS[((h.dia % 7) + 7) % 7] + '</step>' + (h.alter ? '<alter>' + h.alter + '</alter>' : '') + '<octave>' + Math.floor(h.dia / 7) + '</octave></pitch>');
              x.push(...common(h));
              if (k === 0 && e.bm) e.bm.forEach((b, lv) => { if (b) x.push('<beam number="' + (lv + 1) + '">' + b + '</beam>'); });
              const nots = [];
              if (h.tieStop) nots.push('<tied type="stop"/>');
              if (h.tieStart) nots.push('<tied type="start"/>');
              if (k === 0 && e.tupStart) nots.push('<tuplet type="start" bracket="no"/>');
              if (k === 0 && e.tupStop) nots.push('<tuplet type="stop"/>');
              if (nots.length) x.push('<notations>' + nots.join('') + '</notations>');
              x.push('</note>');
              L.push(x.join(''));
            });
          }
          t = startD + d;
        }
        pos = t;
      });
      if (pos < lenD && m.voices.length) L.push('<forward><duration>' + (lenD - pos) + '</duration><voice>1</voice><staff>1</staff></forward>');
      if (m.repEnd || m.endingStop || m.final) L.push('<barline location="right">' + (m.repEnd || m.final ? '<bar-style>light-heavy</bar-style>' : '') + (m.endingStop ? '<ending number="' + m.endingStop + '" type="' + (m.endingOpen ? 'discontinue' : 'stop') + '"/>' : '') + (m.repEnd ? '<repeat direction="backward"/>' : '') + '</barline>');
      L.push('</measure>');
    });
    L.push('</part>', '</score-partwise>');
    return L.join('\n');
  }

  // ---------------------------------------------------------------- 6. whole document
  function textRuns(pg) {
    const runs = [];
    const ts = pg.texts.slice().sort((a, b) => a.y - b.y || a.x - b.x);
    for (const t of ts) {
      const r = runs.find((r) => Math.abs(r.y - t.y) < 0.25 * t.size && Math.abs(r.size - t.size) < 0.2 * t.size && t.x - r.x2 < 0.6 * t.size && t.x >= r.x - 1);
      if (r) { if (t.x - r.x2 > 0.2 * t.size) r.s += ' '; r.s += t.ch; r.x2 = t.x + t.w; } else runs.push({ s: t.ch, x: t.x, x2: t.x + t.w, y: t.y, size: t.size });
    }
    return runs;
  }

  P._debug = { extractPage, findStaves, pairSystems, readSystem, measuresOf };
  P.read = async function (u8, fileName) {
    const lib = await P.lib();
    let doc;
    try { doc = await lib.getDocument({ data: u8.slice(), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 }).promise; }
    catch (e) { throw new Error('This PDF could not be opened' + (e && e.message ? ' (' + e.message + ')' : '') + '.'); }
    const warnings = [];
    const all = [];
    let anyStaff = false, anyGlyph = false, pagesRead = 0, title = '', composer = '', tempo = null;
    const nPages = Math.min(doc.numPages, 40);
    if (doc.numPages > 40) warnings.push('Only the first 40 pages were read.');
    for (let p = 1; p <= nPages; p++) {
      const page = await doc.getPage(p);
      const pg = await extractPage(page, lib);
      pagesRead++;
      const staves = findStaves(pg);
      if (staves.length) anyStaff = true;
      if (pg.glyphs.some((g) => g.sym)) anyGlyph = true;
      const runs = textRuns(pg);
      if (p === 1 && staves.length) {
        const above = runs.filter((r) => r.y < staves[0].top - 2 * staves[0].sp && /[A-Za-z]/.test(r.s));
        const big = above.slice().sort((a, b) => b.size - a.size)[0];
        if (big) title = big.s.trim();
        const right = above.filter((r) => r !== big && r.x2 > pg.width * 0.6).sort((a, b) => b.y - a.y)[0];
        if (right) composer = right.s.trim();
      }
      if (tempo == null) for (const r of runs) { const m = /=\s*(\d{2,3})\b/.exec(r.s); if (m) { tempo = +m[1]; break; } }
      for (const sys of pairSystems(pg, staves)) {
        const r = readSystem(pg, sys, null);
        if (r) all.push(r);
      }
    }
    if (!anyStaff) throw new Error('No staff lines were found in this PDF. It is probably a scan or a photo of sheet music. The app can read PDFs exported from notation software such as MuseScore; for a scan, convert it with Audiveris first.');
    if (!anyGlyph || !all.length) throw new Error('This PDF has staff lines, but its music symbols use a font the app does not recognise. The reader understands PDFs whose music font follows the SMuFL standard (MuseScore, Dorico, Finale 27 and later). Try exporting MusicXML from the program that made the PDF, or convert the PDF with Audiveris.');
    const nStaves = Math.max(...all.map((s) => s.staves.length));
    if (all.some((s) => s.staves.length !== nStaves)) warnings.push('Some systems have a different number of staves. Only systems with ' + nStaves + ' staves were read.');
    const systems = all.filter((s) => s.staves.length === nStaves);
    if (nStaves === 1) warnings.push('The music is on one staff, so the hands are guessed.');

    // carry clef, key and time from system to system
    let clefs = systems[0].staves.map((_, k) => { const c = systems[0].clefs.filter((x) => x.staff === k).sort((a, b) => a.x - b.x)[0]; return c ? { clef: c.clef, oct: c.oct } : { clef: k ? 'F' : 'G', oct: 0 }; });
    if (!systems[0].clefs.length) warnings.push('No clefs were found. Treble and bass clefs are assumed.');
    let fifths = systems[0].fifths != null ? systems[0].fifths : 0;
    let time = systems[0].times[0] ? { num: systems[0].times[0].num, den: systems[0].times[0].den } : null;
    if (!time) { time = { num: 4, den: 4 }; warnings.push('No time signature was found. 4/4 is assumed; change it in the review if needed.'); }
    const measures = [];
    let firstKey = true, firstTime = true, noteCount = 0, badBars = [];
    let pendingTies = [];
    systems.forEach((S, si) => {
      const sp = S.sp;
      if (si > 0 && S.fifths != null && S.fifths !== fifths && S.fifths !== 0) fifths = S.fifths;
      // heads: pitch
      const ms = measuresOf(S, nStaves);
      ms.forEach((m, mk) => {
        const clefChanges = [];
        // clefs that change inside the system apply from their x on
        const lenQ = (m.time ? m.time.num * 4 / m.time.den : time.num * 4 / time.den);
        if (m.time) time = { num: m.time.num, den: m.time.den };
        const mm = { voices: [], lenQ, keyCh: null, timeCh: null, clefCh: [], repStart: m.repStart, repEnd: m.repEnd, final: m.final, ending: m.ending, implicit: false };
        if (firstKey) { mm.keyCh = fifths; firstKey = false; }
        if (firstTime || m.time) { if (firstTime || m.time) mm.timeCh = Object.assign({}, time); firstTime = false; }
        if (measures.length === 0) clefs.forEach((c, k) => mm.clefCh.push({ staff: k, clef: c.clef, oct: c.oct }));
        for (const c of m.clefCh) if (c.x > m.x1 + sp && (c.clef !== clefs[c.staff].clef || c.oct !== clefs[c.staff].oct) && m.evs.some((e) => e.staff === c.staff && e.x > c.x)) clefChanges.push(c);
        const memory = new Map();
        const ka = U.keyAlter(fifths);
        let maxSum = 0;
        for (let k = 0; k < nStaves; k++) {
          const staff = S.staves[k];
          const evs = m.evs.filter((e) => e.staff === k);
          let clef = clefs[k];
          const changes = clefChanges.filter((c) => c.staff === k).sort((a, b) => a.x - b.x);
          // pitches
          for (const e of evs.slice().sort((a, b) => a.x - b.x)) {
            for (const c of changes) if (c.x < e.x && !c.applied) { clef = { clef: c.clef, oct: c.oct }; c.applied = true; mm.clefCh.push({ staff: k, clef: c.clef, oct: c.oct }); }
            if (e.rest) continue;
            for (const h of e.heads.slice().sort((a, b) => a.x - b.x)) {
              h.dia = BASE[clef.clef] + h.pos + clef.oct * 7;
              const key = h.dia;
              if (h.acc != null) { h.alter = h.acc; memory.set(key, h.acc); }
              else if (h.tieStop && h.tiedAlter != null) h.alter = h.tiedAlter;
              else h.alter = memory.has(key) ? memory.get(key) : ka[STEPS[((h.dia % 7) + 7) % 7]];
            }
          }
          clefs[k] = clef;
          // durations and voices
          const vs = voicesOf(evs, sp, staff);
          vs.forEach((v, vi) => {
            let t = 0;
            for (const e of v) {
              let base = baseOf(e);
              if (e.rest && e.whole && v.length === 1) { e.measureRest = true; e.dur = lenQ; e.type = 'whole'; e.onset = 0; t = lenQ; continue; }
              e.type = typeOf(base);
              e.dur = durOf(e, base);
              e.onset = t; t += e.dur;
            }
            maxSum = Math.max(maxSum, t);
            mm.voices.push({ evs: v, staff: k, num: k * 4 + vi + 1, sum: t });
          });
        }
        // beams per voice (MusicXML beam marks from the drawn beams)
        for (const v of mm.voices) {
          let run = [];
          const flush = () => { if (run.length > 1) beamMarks(run); run = []; };
          for (const e of v.evs) {
            if (!e.rest && e.beams > 0 && (!run.length || [...e.beamIds].some((id) => run[run.length - 1].beamIds.has(id)))) run.push(e);
            else { flush(); if (!e.rest && e.beams > 0) run.push(e); }
          }
          flush();
          // tuplet brackets: first and last of each tuplet run
          let tr = [];
          const tflush = () => { if (tr.length) { tr[0].tupStart = true; tr[tr.length - 1].tupStop = true; } tr = []; };
          let acc = 0;
          for (const e of v.evs) { if (e.tup) { tr.push(e); acc += e.dur; if (acc >= (e.tup.n * baseOf(e) * e.tup.f * e.tup.a / e.tup.n) - 1e-6 && acc > 0) { tflush(); acc = 0; } } else { tflush(); acc = 0; } }
          tflush();
        }
        if (measures.length === 0 && maxSum > 0 && maxSum < lenQ - 1e-3) { mm.implicit = true; mm.lenQ = maxSum; }
        else if (maxSum > lenQ + 1e-3) { badBars.push(measures.length + 1); mm.lenQ = maxSum; }
        else if (mm.voices.some((v) => v.sum > 0 && v.sum < lenQ - 1e-3)) badBars.push(measures.length + 1);
        for (const v of mm.voices) for (const e of v.evs) if (!e.rest) { noteCount += e.heads.length; for (const h of e.heads) if (h.tieStart) h.tieTarget = true; }
        measures.push(mm);
      });
      // ties that continue on the next system
      for (const c of S.chords) for (const h of c.heads) if (h.tieOut) pendingTies.push({ h, staff: h.staff });
      if (si + 1 < systems.length && pendingTies.length) {
        const nx = systems[si + 1];
        for (const pt of pendingTies) {
          const cand = nx.chords.filter((c) => c.staff === pt.staff).sort((a, b) => a.x - b.x);
          for (const c of cand) { const h = c.heads.find((x) => x.pos === pt.h.pos); if (h) { pt.h.tieStart = true; h.tieStop = true; h.tiedAlter = pt.h.alter; } break; }
        }
        pendingTies = [];
      }
    });
    // endings: mark start and stop
    measures.forEach((m, i) => {
      if (m.ending) { const prev = measures[i - 1]; if (!prev || prev.ending !== m.ending) m.endingStart = m.ending; const next = measures[i + 1]; if (!next || next.ending !== m.ending) { m.endingStop = m.ending; m.endingOpen = !m.repEnd; } }
    });
    if (badBars.length) warnings.push('In ' + (badBars.length === 1 ? 'bar ' + badBars[0] : badBars.length + ' bars (' + badBars.slice(0, 8).join(', ') + (badBars.length > 8 ? ', ...' : '') + ')') + ' the rhythm did not add up to the time signature. Please check ' + (badBars.length === 1 ? 'it' : 'them') + ' with Correct notes.');
    if (tempo == null) { tempo = 100; warnings.push('No tempo mark was found. 100 BPM is used; change it in the review if needed.'); }
    warnings.push('Read from a PDF. Slurs, dynamics, grace notes and ornaments are not read. Check the notes before you practise.');
    title = (title || U.cleanTitle(fileName)).normalize('NFKC');
    composer = composer.normalize('NFKC');
    const xml = buildXml({ title, composer, tempo, nStaves, measures });
    return { xml, title, report: { pages: pagesRead, systems: systems.length, measures: measures.length, notes: noteCount, staves: nStaves, warnings } };
  };

  function beamMarks(run) {
    const lv = (e) => Math.max(1, e.beams);
    const maxL = Math.max(...run.map(lv));
    for (const e of run) e.bm = [];
    for (let l = 1; l <= maxL; l++) {
      let k = 0;
      while (k < run.length) {
        if (lv(run[k]) < l) { k++; continue; }
        let m = k;
        while (m + 1 < run.length && lv(run[m + 1]) >= l) m++;
        if (m === k) run[k].bm[l - 1] = k === 0 ? 'forward hook' : 'backward hook';
        else for (let x = k; x <= m; x++) run[x].bm[l - 1] = x === k ? 'begin' : x === m ? 'end' : 'continue';
        k = m + 1;
      }
    }
  }
})();
