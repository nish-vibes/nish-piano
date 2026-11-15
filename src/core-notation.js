/* Notation model helpers and "notation from notes" (approximate notation for MIDI and built-in pieces).
 *
 * song.notation = {
 *   approximate: bool, nstaves: 1|2, clefs: ['G','F'],
 *   written: [ WM ],          // the written score, once (repeats are NOT unfolded)
 *   playMap: [ written index for each playback measure ]
 * }
 * WM = { lenQ, label, time:{num,den}|null, key:fifths|null, clefs:[sign|null,...],
 *        repStart, repEnd, bar:'light-heavy'|..|null, ending:{label,first,last,open}|null,
 *        staves: [ [ voice, ... ], ... ] }          voice = [ event, ... ]
 * event = { t, d, ty:'quarter', dots, r:1 (rest), wm:1 (whole-bar rest), n:[note], st:'up'|'down',
 *           bm:[...], tu:{a,n,start,stop,bracket}, v: voice number }
 * note  = { m:midi, s:letter, a:alter, o:octave, acc:'s'|'f'|'n'|'x'|'ff'|null, ts:bool, te:bool }
 */
(function () {
  'use strict';
  const W = window.Wapiro, U = W.util, EPS = U.EPS;
  const N = (W.notation = {});

  const TYPE_FOR = [
    [6, 'whole', 1], [4.5, 'whole', 1], [4, 'whole', 0], [3, 'half', 1], [2, 'half', 0], [1.5, 'quarter', 1], [1, 'quarter', 0],
    [0.75, 'eighth', 1], [0.5, 'eighth', 0], [0.375, '16th', 1], [0.25, '16th', 0], [0.1875, '32nd', 1], [0.125, '32nd', 0],
  ];
  const BEAM_LEVELS = { eighth: 1, '16th': 2, '32nd': 3, '64th': 4 };
  N.BEAM_LEVELS = BEAM_LEVELS;
  const TYPE_Q = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25, '32nd': 0.125, '64th': 0.0625, breve: 8 };
  N.TYPE_Q = TYPE_Q;

  function typeFor(d, tripletBeat) {
    if (tripletBeat) {
      if (Math.abs(d - 1 / 3) < 1e-4) return { ty: 'eighth', dots: 0, tu: true };
      if (Math.abs(d - 2 / 3) < 1e-4) return { ty: 'quarter', dots: 0, tu: true };
    }
    let best = null;
    for (const [v, ty, dots] of TYPE_FOR) { if (Math.abs(v - d) < 1e-4) return { ty, dots, tu: false }; if (!best || Math.abs(v - d) < Math.abs(best[0] - d)) best = [v, ty, dots]; }
    return { ty: best[1], dots: best[2], tu: false };
  }

  /** Split a span [p, p+d) (offsets in a bar) into notatable chunks. G = beaming group length, trip[k] = beat k is a triplet beat. */
  function splitSpan(p, d, len, G, trip) {
    const out = [];
    let rem = d;
    const compound = G > 1;
    const near = (a, b) => Math.abs(a - b) < 1e-4;
    const modz = (a, m) => { const r = a % m; return r < 1e-4 || m - r < 1e-4; };
    const tripAny = (a, b) => { for (let k = Math.floor(a + 1e-4); k < b - 1e-4; k++) if (trip[k]) return true; return false; };
    const cands = compound ? [6, 4.5, 3, 1.5, 1, 0.75, 0.5, 0.25, 0.125] : [4, 3, 2, 1.5, 1, 0.75, 2 / 3, 0.5, 1 / 3, 0.25, 0.125];
    const allowed = (p, c) => {
      const k = Math.floor(p + 1e-4), frac = p - k, inTrip = !!trip[k];
      if (c === 2 / 3 || c === 1 / 3) return inTrip && p + c <= k + 1 + 1e-4 && (c === 1 / 3 || near(frac, 0) || near(frac, 1 / 3));
      if (inTrip && c < 1) return false;
      if (c >= 1) {
        if (tripAny(p, p + c) && !(c === 1 && near(frac, 0))) return false;
        if (compound) {
          if (c === 1) return modz(p, G) || near(p % G, 0.5);
          return modz(p, G) && (c === 1.5 || modz(p, c));
        }
        if (!near(frac, 0) && !(near(frac, 1) )) return false;
        if (c === 1 || c === 1.5) return true;
        if (c === 2) return modz(p, 2) || Math.abs(len - 4) > 1e-4;
        if (c === 3) return p < 1e-4 || modz(p, 4);
        return modz(p, 4);
      }
      const unit = compound ? G : 1;
      const gs = Math.floor((p + 1e-4) / unit) * unit;
      if (p + c > gs + unit + 1e-4) return false;
      if (c === 0.75) return compound ? near((p - gs) % 1.5, 0) || near(p - gs, 0.75) : near(frac, 0) || near(frac, 0.25);
      if (c === 0.5) return modz(p, 0.5);
      if (c === 0.25) return modz(p, 0.25);
      return modz(p, 0.125);
    };
    let guard = 0;
    while (rem > 1e-4 && guard++ < 64) {
      let pick = null;
      for (const c of cands) {
        if (c > rem + 1e-4 || p + c > len + 1e-4) continue;
        if (allowed(p, c)) { pick = c; break; }
      }
      if (!pick) pick = Math.min(rem, 0.125);
      out.push({ off: p, dur: pick });
      p += pick; rem -= pick;
    }
    return out;
  }
  N.splitSpan = splitSpan;

  function gridChoice(times, b) {
    // times: absolute q values falling in [b, b+1]
    let e16 = 0, eT = 0;
    for (const t of times) {
      const x = t - b;
      e16 += Math.abs(x - Math.round(x * 4) / 4);
      eT += Math.abs(x - Math.round(x * 3) / 3);
    }
    return eT + 1e-6 < e16 * 0.6 && eT < 0.1 ? 3 : 4;
  }

  /** Assign beam marks to a voice's events. G = beaming group length. */
  N.assignBeams = function (events, G) {
    const eligible = (e) => !e.r && BEAM_LEVELS[e.ty];
    let i = 0;
    while (i < events.length) {
      if (!eligible(events[i])) { i++; continue; }
      let j = i + 1;
      const grp = Math.floor((events[i].t + 1e-4) / G);
      while (j < events.length && eligible(events[j]) && Math.floor((events[j].t + 1e-4) / G) === grp && Math.abs(events[j].t - (events[j - 1].t + events[j - 1].d)) < 1e-4) j++;
      if (j - i >= 2) N.beamRun(events.slice(i, j));
      i = j;
    }
  };
  N.beamRun = function (run) {
    const maxL = Math.max(...run.map((e) => BEAM_LEVELS[e.ty]));
    for (const e of run) e.bm = [];
    for (let l = 1; l <= maxL; l++) {
      let k = 0;
      while (k < run.length) {
        if (BEAM_LEVELS[run[k].ty] < l) { k++; continue; }
        let m = k;
        while (m + 1 < run.length && BEAM_LEVELS[run[m + 1].ty] >= l) m++;
        if (m === k) run[k].bm[l - 1] = k === 0 ? 'forward hook' : 'backward hook';
        else for (let x = k; x <= m; x++) run[x].bm[l - 1] = x === k ? 'begin' : x === m ? 'end' : 'continue';
        k = m + 1;
      }
    }
  };

  /** Fill in display accidentals for one staff in one written measure (bar-long memory). */
  N.assignAccidentals = function (voices, fifths, memory) {
    const ka = U.keyAlter(fifths || 0);
    const evs = [].concat(...voices).sort((a, b) => a.t - b.t);
    for (const e of evs) {
      if (e.r) continue;
      for (const n of e.n) {
        const k = n.s + n.o;
        const cur = memory.has(k) ? memory.get(k) : ka[n.s];
        if (n.a !== cur) {
          n.acc = n.te ? null : ({ '-2': 'ff', '-1': 'f', '0': 'n', '1': 's', '2': 'x' }[n.a]);
          memory.set(k, n.a);
        } else n.acc = null;
      }
    }
  };

  N.measureIndexAt = function (measures, q) {
    let lo = 0, hi = measures.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (measures[mid].q <= q + EPS) lo = mid; else hi = mid - 1; }
    return lo;
  };

  /** Build approximate notation (up to two voices per hand) from song.notes. */
  N.fromNotes = function (song) {
    const measures = song.measures;
    const keySigs = song.keySigs || [];
    const fifths0 = keySigs.length ? keySigs[0].fifths : song.estKey != null ? song.estKey : U.estimateKey(song.notes);
    const written = measures.map((m, i) => ({
      lenQ: m.lenQ, label: String(i + 1), time: null, key: null, clefs: [null, null], repStart: false, repEnd: false, bar: null, ending: null,
      staves: [[[]], [[]]],
    }));
    // time and key marks
    let sigIdx = -1;
    measures.forEach((m, i) => {
      let idx = sigIdx;
      while (idx + 1 < song.timeSigs.length && song.timeSigs[idx + 1].q <= m.q + EPS) idx++;
      if (idx !== sigIdx) { sigIdx = idx; written[i].time = { num: song.timeSigs[idx].num, den: song.timeSigs[idx].den }; }
    });
    if (!written[0].time) written[0].time = { num: song.timeSigs[0].num, den: song.timeSigs[0].den };
    written[0].key = fifths0;
    const keyAtMeasure = new Array(measures.length).fill(fifths0);
    for (const k of keySigs) {
      const mi = N.measureIndexAt(measures, k.q);
      if (mi > 0) written[mi].key = k.fifths;
      for (let j = mi; j < measures.length; j++) keyAtMeasure[j] = k.fifths;
    }

    const beatOf = (i) => { const sg = song.timeSigs.filter((s) => s.q <= measures[i].q + EPS).pop() || song.timeSigs[0]; return U.beatInfo(sg.num, sg.den); };
    const handNotes = { R: [], L: [] };
    for (const n of song.notes) handNotes[n.hand === 'L' ? 'L' : 'R'].push(n);

    ['R', 'L'].forEach((hand, staffIdx) => {
      // 1. cut notes into per-measure segments
      const segs = measures.map(() => []);
      let mi = 0;
      for (const n of handNotes[hand]) {
        while (mi + 1 < measures.length && measures[mi + 1].q <= n.q + EPS) mi++;
        let k = mi;
        let start = n.q;
        const end = n.q + n.durQ;
        for (;;) {
          const m = measures[k];
          const mEnd = m.q + m.lenQ;
          const e = Math.min(end, mEnd);
          const cont = end > mEnd + 1e-4 && k + 1 < measures.length;
          segs[k].push({ s: start, e: cont ? mEnd : Math.min(end, mEnd), midi: n.midi, spelled: n.spelled, from: start > n.q + EPS, to: cont });
          if (!cont) break;
          start = mEnd; k++;
        }
      }
      measures.forEach((m, i) => {
        const len = m.lenQ;
        const info = beatOf(i);
        const G = info.compound ? info.beatLen : 1;
        const list = segs[i];
        // 2. choose a grid per beat
        const nBeats = Math.max(1, Math.ceil(len - 1e-4));
        const trip = [];
        for (let b = 0; b < nBeats; b++) {
          const times = [];
          for (const s of list) { if (s.s >= m.q + b - 1e-6 && s.s <= m.q + b + 1 + 1e-6) times.push(s.s); if (s.e >= m.q + b - 1e-6 && s.e <= m.q + b + 1 + 1e-6) times.push(s.e); }
          trip[b] = times.length && b + 1 <= len + 1e-6 && !info.compound ? gridChoice(times, m.q + b) === 3 : false;
        }
        const snap = (t) => {
          const x = Math.max(0, Math.min(len, t - m.q));
          const b = Math.min(nBeats - 1, Math.floor(x + 1e-6));
          const g = trip[b] ? 3 : 4;
          let r = Math.round(x * g) / g;
          if (trip[b] && Math.abs(r - Math.round(r)) < 1e-9) r = Math.round(r);
          return Math.min(len, r);
        };
        // 3. split into at most two voices: notes that start while an earlier note is still held go to a second voice
        const sub = [];
        for (const sg of list) {
          const s0 = snap(sg.s);
          let s1 = sg.to ? len : snap(sg.e);
          if (s1 <= s0 + 1e-6) s1 = Math.min(len, s0 + (trip[Math.min(nBeats - 1, Math.floor(s0 + 1e-6))] ? 1 / 3 : 0.25));
          const key = s0.toFixed(4) + '|' + s1.toFixed(4);
          let g = sub.find((x) => x.key === key);
          if (!g) { g = { key, t: s0, end: s1, segs: [] }; sub.push(g); }
          g.segs.push(sg);
        }
        sub.sort((a, b) => a.t - b.t || b.end - a.end);
        const vox = [];
        for (const g of sub) {
          const avg = g.segs.reduce((a, x) => a + x.midi, 0) / g.segs.length;
          let free = vox.filter((v) => v.end <= g.t + 1e-4);
          let v;
          if (free.length) v = free.sort((a, b) => Math.abs(a.last - avg) - Math.abs(b.last - avg))[0];
          else if (vox.length < 2) { v = { end: 0, last: avg, groups: [], sum: 0, cnt: 0 }; vox.push(v); }
          else v = vox.slice().sort((a, b) => Math.abs(a.last - avg) - Math.abs(b.last - avg))[0];
          v.groups.push(g); v.end = Math.max(v.end, g.end); v.last = avg; v.sum += avg; v.cnt++;
        }
        if (!vox.length) vox.push({ groups: [], sum: 0, cnt: 1 });
        vox.sort((a, b) => b.sum / b.cnt - a.sum / a.cnt);
        const voiceOut = vox.map((vx, vi) => {
          const evMap = new Map();
          for (const g of vx.groups) {
            const key = g.t.toFixed(4);
            if (!evMap.has(key)) evMap.set(key, { t: g.t, end: g.end, segs: [] });
            const ev = evMap.get(key);
            ev.end = Math.max(ev.end, g.end);
            ev.segs.push(...g.segs);
          }
          const evs = [...evMap.values()].sort((a, b) => a.t - b.t);
          const out = [];
          const pushRest = (from, to) => {
            if (to - from < 1e-4) return;
            for (const c of splitSpan(from, to - from, len, G, trip)) {
              const ty = typeFor(c.dur, trip[Math.floor(c.off + 1e-4)]);
              out.push({ t: c.off, d: c.dur, ty: ty.ty, dots: ty.dots, r: 1, _tu: ty.tu, v: vi + 1 });
            }
          };
          let cursor = 0;
          evs.forEach((ev, idx) => {
            if (ev.t > cursor) pushRest(cursor, ev.t);
            const next = idx + 1 < evs.length ? evs[idx + 1].t : len;
            const endT = Math.min(ev.end, next);
            const chunks = splitSpan(ev.t, endT - ev.t, len, G, trip);
            chunks.forEach((c, ci) => {
              const ty = typeFor(c.dur, trip[Math.floor(c.off + 1e-4)]);
              const lastChunk = ci === chunks.length - 1;
              const notes = ev.segs
                .slice().sort((a, b) => a.midi - b.midi)
                .map((sg) => {
                  const sp = U.parseSpelled(sg.spelled) || U.spellInKey(sg.midi, keyAtMeasure[i]);
                  return { m: sg.midi, s: sp.letter, a: sp.alter, o: sp.oct, acc: null, ts: !lastChunk || (sg.to && Math.abs(endT - len) < 1e-4), te: ci > 0 || sg.from };
                });
              out.push({ t: c.off, d: c.dur, ty: ty.ty, dots: ty.dots, n: notes, _tu: ty.tu, v: vi + 1 });
            });
            cursor = endT;
          });
          if (cursor < len - 1e-4) pushRest(cursor, len);
          if (vox.length === 1 && (out.length === 1 && out[0].r && Math.abs(out[0].d - len) < 1e-4 || !out.length)) {
            out.length = 0;
            out.push({ t: 0, d: len, ty: 'whole', dots: 0, r: 1, wm: 1, v: 1 });
          }
          return out;
        });
        for (const out of voiceOut) {
        // tuplets
        for (let b = 0; b < nBeats; b++) {
          if (!trip[b]) continue;
          const g = out.filter((e) => e._tu && Math.floor(e.t + 1e-4) === b);
          if (g.length >= 2 || (g.length === 1 && g[0].d < 0.9)) {
            g.forEach((e) => { e.tu = { a: 3, n: 2 }; });
            g[0].tu.start = true; g[g.length - 1].tu.stop = true;
            if (g.some((e) => e.r)) g[0].tu.bracket = true;
          }
        }
        out.forEach((e) => { delete e._tu; });
        N.assignBeams(out, G);
        }
        written[i].staves[staffIdx] = voiceOut;
        N.assignAccidentals(voiceOut, keyAtMeasure[i], new Map());
      });
    });
    return { approximate: true, nstaves: 2, clefs: ['G', 'F'], written, playMap: measures.map((_, i) => i) };
  };

  /** Build notation for a song (used after an import, a built-in piece or an edit). */
  N.build = function (song) { return N.fromNotes(song); };
})();
