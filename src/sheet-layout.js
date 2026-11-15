/* Sheet layout: decorate events (stems, seconds, accidentals), measure widths, system breaking, justification, vertical placement. */
(function () {
  'use strict';
  const W = window.Wapiro, U = W.util;
  const L = (W.sheetLayout = {});
  const DIA = U.DIA;
  const BASE = { G: 30, F: 18 }; // diatonic index of the bottom staff line (E4, G2)
  const HW = 1.2;                // notehead width in staff spaces
  L.HW = HW;
  const KEY_POS = {
    G: { s: [8, 5, 9, 6, 3, 7, 4], f: [4, 7, 3, 6, 2, 5, 1] },
    F: { s: [6, 3, 7, 4, 1, 5, 2], f: [2, 5, 1, 4, 0, 3, -1] },
  };
  L.KEY_POS = KEY_POS;
  L.posOf = (n, clef) => n.o * 7 + DIA[n.s] - BASE[clef];
  const spacing = (dt) => 1.3 + 1.6 * Math.log2(1 + Math.max(dt, 0.0625) / 0.25);
  const keyW = (f) => (f ? Math.abs(f) * 1.05 + 0.7 : 0);

  /** Stem direction for an event: file value, voice rule, or the farthest-from-middle rule. */
  function stemDir(ev, top, bot, voiceIdx, nVoices) {
    if (ev.st === 'up' || ev.st === 'down') return ev.st;
    if (nVoices > 1) return voiceIdx === 0 ? 'up' : 'down';
    const far = Math.abs(top - 4) > Math.abs(bot - 4) ? top : bot;
    return far >= 4 ? 'down' : 'up';
  }

  /** Decorate the events of one written measure for drawing. Cached per layout. */
  L.prepare = function (lay, wi) {
    if (lay.prep[wi]) return lay.prep[wi];
    const wm = lay.nota.written[wi];
    const st = lay.state[wi];
    const out = { staves: [], groups: [], colT: [], len: wm.lenQ };
    const tset = new Map();
    const addT = (t) => { const k = Math.round(t * 2000); if (!tset.has(k)) tset.set(k, t); return k; };
    for (let si = 0; si < lay.nota.nstaves; si++) {
      const clef = st.clef[si];
      const voices = (wm.staves[si] || []).filter((v) => v.length);
      const recs = voices.map((v, vi) => v.map((ev) => {
        const rec = { ev, t: ev.t, d: ev.d, ty: ev.ty, dots: ev.dots || 0, r: !!ev.r, wm: !!ev.wm, voice: vi, nVoices: voices.length, key: addT(ev.t), clef };
        if (!ev.r) {
          const ns = ev.n.map((n) => ({ n, pos: L.posOf(n, clef), disp: 0, accCol: -1 })).sort((a, b) => a.pos - b.pos);
          rec.notes = ns; rec.bot = ns[0].pos; rec.top = ns[ns.length - 1].pos;
          rec.dir = ev.ty === 'whole' && !ev.st ? null : stemDir(ev, rec.top, rec.bot, vi, voices.length);
          const dirEff = rec.dir || 'up';
          // seconds: the second partner moves to the other side of the stem
          let prev = null, prevDisp = false;
          const order = dirEff === 'up' ? ns : ns.slice().reverse();
          for (const x of order) {
            if (prev && Math.abs(x.pos - prev.pos) === 1 && !prevDisp) { x.disp = dirEff === 'up' ? 1 : -1; prevDisp = true; } else prevDisp = false;
            prev = x;
          }
          // accidental columns (stack so that close accidentals do not collide)
          const accNotes = ns.filter((x) => x.n.acc).sort((a, b) => b.pos - a.pos);
          const colLast = [];
          for (const x of accNotes) {
            let c = 0;
            while (colLast[c] != null && colLast[c] - x.pos < 6) c++;
            colLast[c] = x.pos; x.accCol = c;
          }
          rec.accCols = colLast.length;
          rec.dispL = ns.some((x) => x.disp < 0); rec.dispR = ns.some((x) => x.disp > 0);
        }
        return rec;
      }));
      const groups = [];
      out.groups.push(groups);
      // beam groups: direction and slope are decided by the renderer; here we only unify the stem direction of a beamed run
      for (const vrecs of recs) {
        let i = 0;
        while (i < vrecs.length) {
          const bm0 = vrecs[i].ev.bm && vrecs[i].ev.bm[0];
          if (bm0 === 'begin') {
            let j = i;
            while (j + 1 < vrecs.length && vrecs[j].ev.bm && vrecs[j].ev.bm[0] !== 'end') j++;
            const grp = vrecs.slice(i, j + 1);
            if (grp.length > 1 && grp.every((r) => r.notes)) {
              const given = grp.find((r) => r.ev.st);
              let dir;
              if (given) dir = given.ev.st;
              else if (grp[0].nVoices > 1) dir = grp[0].voice === 0 ? 'up' : 'down';
              else {
                const top = Math.max(...grp.map((r) => r.top)), bot = Math.min(...grp.map((r) => r.bot));
                dir = (Math.abs(top - 4) > Math.abs(bot - 4) ? top : bot) >= 4 ? 'down' : 'up';
              }
              grp.forEach((r) => { r.dir = dir; });
              // recompute seconds for the unified direction
              for (const r of grp) {
                r.notes.forEach((x) => { x.disp = 0; });
                let prev = null, pd = false;
                for (const x of dir === 'up' ? r.notes : r.notes.slice().reverse()) { if (prev && Math.abs(x.pos - prev.pos) === 1 && !pd) { x.disp = dir === 'up' ? 1 : -1; pd = true; } else pd = false; prev = x; }
                r.dispL = r.notes.some((x) => x.disp < 0); r.dispR = r.notes.some((x) => x.disp > 0);
              }
              groups.push(grp); grp.forEach((r) => { r.inBeam = true; });
            }
            i = j + 1;
          } else i++;
        }
      }
      out.staves.push(recs);
    }
    out.colT = [...tset.entries()].sort((a, b) => a[0] - b[0]).map((e) => ({ key: e[0], t: e[1] }));
    // column metrics
    const colIdx = new Map(out.colT.map((c, i) => [c.key, i]));
    for (const c of out.colT) { c.left = 0; c.right = HW + 0.5; }
    for (const staff of out.staves) for (const v of staff) for (const r of v) {
      const c = out.colT[colIdx.get(r.key)];
      r.col = colIdx.get(r.key);
      if (r.notes) {
        const left = (r.accCols ? r.accCols * 1.45 + 0.5 : 0) + (r.dispL ? HW : 0);
        const right = HW + (r.dispR ? HW : 0) + (r.dots ? 0.35 + r.dots * 0.6 : 0) + 0.4;
        c.left = Math.max(c.left, left); c.right = Math.max(c.right, right);
      } else {
        c.right = Math.max(c.right, (r.wm ? 1.6 : HW) + (r.dots ? 0.35 + r.dots * 0.6 : 0) + 0.4);
      }
    }
    // vertical extent (half-steps) above and below each staff
    out.ext = out.staves.map((staff) => {
      let up = 8, dn = 0;
      for (const v of staff) for (const r of v) {
        if (!r.notes) continue;
        const tipUp = r.dir === 'up' || r.dir == null ? Math.max(r.top + 7, 4) : r.top + 1;
        const tipDn = r.dir === 'down' ? Math.min(r.bot - 7, 4) : r.bot - 1;
        up = Math.max(up, tipUp + (r.inBeam ? 2 : 0)); dn = Math.min(dn, tipDn - (r.inBeam ? 2 : 0));
        if (r.ev.tu && (r.ev.tu.start || r.ev.tu.stop)) { if (r.dir === 'up') up = Math.max(up, tipUp + 3); else dn = Math.min(dn, tipDn - 3); }
      }
      return { up: up - 8, dn: -dn };
    });
    // natural widths
    const cols = out.colT;
    let x = 0;
    out.natural = [];
    cols.forEach((c, i) => {
      const nextT = i + 1 < cols.length ? cols[i + 1].t : wm.lenQ;
      const sp = spacing(Math.max(0.0625, nextT - c.t));
      c.seg = Math.max(sp, c.right + (i + 1 < cols.length ? cols[i + 1].left : 0.4) + 0.5);
      c.var = c.seg - (c.right + (i + 1 < cols.length ? cols[i + 1].left : 0.4) + 0.5); // part that can stretch
      c.var = Math.max(0.2, c.var);
    });
    out.colsW = cols.reduce((s, c) => s + c.left + c.seg, 0);
    out.pad = 1.5 + (wm.repStart ? 1.9 : 0);
    out.endPad = 0.9 + (wm.repEnd ? 1.3 : 0) + (wm.bar ? 0.5 : 0);
    return (lay.prep[wi] = out);
  };

  /** Running state (clef, key, time) at the start of each written measure. */
  function stateTrack(nota) {
    const st = [];
    let clef = nota.clefs.slice(), key = 0, time = null;
    nota.written.forEach((w, i) => {
      if (w.clefs) w.clefs.forEach((c, si) => { if (c) clef[si] = c; });
      if (w.key != null) key = w.key;
      if (w.time) time = w.time;
      st.push({ clef: clef.slice(), key, time: w.time || null, timeNow: time, keyChanged: w.key != null, clefChanged: !!(w.clefs && w.clefs.some(Boolean)) });
    });
    return st;
  }

  /**
   * Compute the layout for a notation at a pane width and staff size.
   * Returns { S, width, height, systems:[{ y1, y2, top, bottom, measures:[...], ... }], where:[wi]->{ sys, idx } }
   */
  L.compute = function (nota, paneWidth, S) {
    const lay = { nota, S, prep: [], state: stateTrack(nota), systems: [], where: [], width: paneWidth };
    const margin = 1.2 * S;
    const avail = Math.max(14 * S, paneWidth - 2 * margin);
    const nW = nota.written.length;
    const body = new Array(nW);
    for (let i = 0; i < nW; i++) { const p = L.prepare(lay, i); body[i] = p.pad + p.colsW; }
    const braceW = nota.nstaves > 1 ? 1.4 : 0.4;
    const headW = (i, first) => {
      const st = lay.state[i];
      return braceW + 3.2 + keyW(st.key) + (st.time || (first && i === 0) ? 2.6 : 0) + 1.2;
    };
    const leadW = (i) => {
      const st = lay.state[i];
      return (st.time ? 2.6 : 0) + (st.keyChanged && i > 0 ? keyW(st.key) + 0.8 : 0) + (st.clefChanged && i > 0 ? 2.6 : 0);
    };
    // greedy system breaking
    let i = 0;
    while (i < nW) {
      const sys = { measures: [], first: i };
      let w = headW(i, true) + 0;
      let j = i;
      while (j < nW) {
        const mw = body[j] + (j === i ? 0 : leadW(j)) + lay.prep[j].endPad;
        if (j > i && (w + mw) * S > avail) break;
        w += mw; sys.measures.push(j); j++;
      }
      sys.natural = w; sys.last = j >= nW;
      lay.systems.push(sys);
      i = j;
    }
    // justify, then place
    const sizes = lay.nota.nstaves;
    let y = 1.5 * S;
    lay.systems.forEach((sys, si) => {
      const first = sys.measures[0];
      const hw = headW(first, true);
      let fixed = hw, stretchable = 0;
      sys.measures.forEach((wi, k) => {
        const p = lay.prep[wi];
        fixed += (k ? leadW(wi) : 0) + p.endPad + p.pad + p.colsW;
        stretchable += p.colT.reduce((s, c) => s + c.var, 0);
      });
      const extra = avail / S - fixed;
      let k = stretchable > 0 ? 1 + extra / stretchable : 1;
      if (sys.last && fixed + stretchable * 1.6 < avail / S * 0.62) k = Math.min(k, 1.6);
      k = Math.max(1, k);
      let x = margin / S + hw;
      sys.hdrW = hw; sys.x0 = margin;
      sys.items = [];
      sys.measures.forEach((wi, mk) => {
        const p = lay.prep[wi];
        const lead = mk ? leadW(wi) : 0;
        const mx = x;                // barline left edge of the measure
        x += lead + p.pad;
        const colX = [];
        p.colT.forEach((c) => { x += c.left; colX.push(x); x += c.seg + c.var * (k - 1); });
        x += p.endPad;
        sys.items.push({ wi, x0: mx * S, x1: x * S, lead: lead * S, colX: colX.map((v) => v * S), lastAfter: 0 });
        lay.where[wi] = { sys: si, idx: mk };
      });
      sys.x1 = x * S;
      // vertical metrics
      const ext = sys.measures.reduce((a, wi) => lay.prep[wi].ext.map((e, s) => ({ up: Math.max(a[s] ? a[s].up : 0, e.up), dn: Math.max(a[s] ? a[s].dn : 0, e.dn) })), []);
      sys.ext = ext;
      const hasEnd = sys.measures.some((wi) => nota.written[wi].ending);
      const topPad = Math.max(hasEnd ? 6.4 * S : 4.2 * S, (ext[0].up * 0.5 + 1.8 + (hasEnd ? 2.2 : 0)) * S);
      const y1 = y + topPad;
      let y2 = null, bottom;
      if (sizes > 1) {
        const gap = Math.max(8 * S, (ext[0].dn * 0.5 + ext[1].up * 0.5 + 2.4) * S);
        y2 = y1 + 4 * S + gap;
        bottom = y2 + 4 * S + Math.max(2.4 * S, (ext[1].dn * 0.5 + 1) * S);
      } else bottom = y1 + 4 * S + Math.max(2.4 * S, (ext[0].dn * 0.5 + 1) * S);
      sys.y1 = y1; sys.y2 = y2; sys.top = y; sys.bottom = bottom;
      y = bottom + 1.2 * S;
    });
    lay.height = y + S;
    let maxW = paneWidth;
    for (const s of lay.systems) maxW = Math.max(maxW, s.x1 + margin);
    lay.width = maxW;
    return lay;
  };

  /** Map a playback position to {sys, x, y1, y2} on the written score. */
  L.cursorAt = function (lay, song, q, mi) {
    const wi = lay.nota.playMap[mi];
    const wh = lay.where[wi];
    if (!wh) return null;
    const sys = lay.systems[wh.sys], it = sys.items[wh.idx];
    const m = song.measures[mi];
    const t = Math.max(0, q - m.q);
    const p = lay.prep[wi];
    const cols = p.colT;
    let x;
    if (!cols.length) x = it.x0 + (it.x1 - it.x0) * Math.min(1, t / Math.max(0.01, m.lenQ));
    else if (t <= cols[0].t + 1e-6) x = it.colX[0];
    else {
      let k = cols.length - 1;
      while (k > 0 && cols[k].t > t + 1e-6) k--;
      const xa = it.colX[k], ta = cols[k].t;
      const xb = k + 1 < cols.length ? it.colX[k + 1] : it.x1 - 0.8 * lay.S;
      const tb = k + 1 < cols.length ? cols[k + 1].t : lay.nota.written[wi].lenQ;
      x = xa + (xb - xa) * Math.min(1, Math.max(0, (t - ta) / Math.max(1e-6, tb - ta)));
    }
    return { sys: wh.sys, x: x - 0.7 * lay.S, y1: sys.y1, y2: sys.y2 != null ? sys.y2 + 4 * lay.S : sys.y1 + 4 * lay.S, top: sys.top, bottom: sys.bottom };
  };
})();
