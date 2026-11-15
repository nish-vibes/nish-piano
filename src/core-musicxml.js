/* MusicXML (score-partwise and score-timewise) and compressed MusicXML (.mxl) import. */
(function () {
  'use strict';
  const W = window.Wapiro, U = W.util, N = W.notation, EPS = U.EPS;
  const X = (W.musicxml = {});

  const kids = (el, name) => { const r = []; for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (c.localName === name) r.push(c); return r; };
  const kid = (el, name) => { for (let c = el && el.firstElementChild; c; c = c.nextElementSibling) if (c.localName === name) return c; return null; };
  const txt = (el, name) => { const k = kid(el, name); return k ? k.textContent.trim() : null; };
  const num = (el, name, d) => { const t = txt(el, name); const v = t == null ? NaN : parseFloat(t); return isNaN(v) ? d : v; };

  // ------------------------------------------------------------------ ZIP (mxl)
  async function unzip(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('This compressed MusicXML file (.mxl) is damaged: the ZIP directory was not found.');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = [];
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('This compressed MusicXML file (.mxl) is damaged: bad ZIP directory entry.');
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
      const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const off = dv.getUint32(p + 42, true);
      const name = new TextDecoder('utf-8').decode(u8.subarray(p + 46, p + 46 + nlen));
      entries.push({ name, method, csize, usize, off });
      p += 46 + nlen + elen + clen;
    }
    const read = async (e) => {
      const lh = e.off;
      if (dv.getUint32(lh, true) !== 0x04034b50) throw new Error('This compressed MusicXML file (.mxl) is damaged: bad ZIP entry.');
      const start = lh + 30 + dv.getUint16(lh + 26, true) + dv.getUint16(lh + 28, true);
      const data = u8.subarray(start, start + e.csize);
      if (e.method === 0) return data;
      if (e.method !== 8) throw new Error('This compressed MusicXML file uses an unsupported ZIP compression method.');
      if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot unpack .mxl files. Use Chrome or Edge, or export plain MusicXML (.musicxml) instead.');
      const ds = new DecompressionStream('deflate-raw');
      const out = new Response(new Blob([data]).stream().pipeThrough(ds));
      return new Uint8Array(await out.arrayBuffer());
    };
    return { entries, read };
  }

  async function mxlToText(u8) {
    const z = await unzip(u8);
    const byName = (n) => z.entries.find((e) => e.name === n);
    let root = null;
    const cont = byName('META-INF/container.xml');
    if (cont) {
      const doc = new DOMParser().parseFromString(new TextDecoder().decode(await z.read(cont)), 'application/xml');
      const rf = doc.getElementsByTagName('rootfile')[0];
      const path = rf && rf.getAttribute('full-path');
      if (path && byName(path)) root = byName(path);
    }
    if (!root) root = z.entries.find((e) => !/^META-INF\//i.test(e.name) && /\.(musicxml|xml)$/i.test(e.name));
    if (!root) throw new Error('This compressed MusicXML file (.mxl) does not contain a score.');
    return new TextDecoder('utf-8').decode(await z.read(root));
  }
  X.mxlToText = mxlToText;

  // ------------------------------------------------------------------ part parsing
  const UNIT_Q = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25, '32nd': 0.125, breve: 8 };
  const ACC = { sharp: 's', flat: 'f', natural: 'n', 'double-sharp': 'x', 'sharp-sharp': 'x', 'flat-flat': 'ff', 'natural-sharp': 's', 'natural-flat': 'f' };

  function parsePart(measureEls, ctx) {
    const raw = [];
    let div = 1;
    let graceSkipped = 0;
    for (const mel of measureEls) {
      const m = { number: mel.getAttribute('number') || String(raw.length + 1), implicit: mel.getAttribute('implicit') === 'yes', div: 0, time: null, key: null, clefs: {}, staves: null, tempos: [], notes: [], max: 0,
        repStart: false, repEnd: false, repTimes: 2, bar: null, endStart: null, endStop: null };
      let pos = 0, lastStart = 0, maxPos = 0;
      const vposForward = [];
      for (let el = mel.firstElementChild; el; el = el.nextElementSibling) {
        const nm = el.localName;
        if (nm === 'attributes') {
          const d = num(el, 'divisions', 0); if (d > 0) div = d;
          const key = kid(el, 'key'); if (key) { const f = num(key, 'fifths', null); if (f != null) m.key = Math.max(-7, Math.min(7, Math.round(f))); }
          const time = kid(el, 'time'); if (time) { const b = parseInt(txt(time, 'beats'), 10), t = parseInt(txt(time, 'beat-type'), 10); if (b > 0 && t > 0) m.time = { num: b, den: t }; }
          const st = num(el, 'staves', 0); if (st > 0) m.staves = st;
          for (const c of kids(el, 'clef')) m.clefs[parseInt(c.getAttribute('number') || '1', 10)] = txt(c, 'sign');
        } else if (nm === 'direction' || nm === 'sound') {
          const snd = nm === 'sound' ? el : kid(el, 'sound');
          let bpm = null;
          if (snd && snd.getAttribute('tempo')) bpm = parseFloat(snd.getAttribute('tempo'));
          if (snd && (snd.getAttribute('dacapo') || snd.getAttribute('dalsegno') || snd.getAttribute('tocoda'))) ctx.jumps = true;
          if (nm === 'direction') {
            for (const dt of kids(el, 'direction-type')) {
              const met = kid(dt, 'metronome');
              if (met && bpm == null) {
                const unit = txt(met, 'beat-unit'), pm = parseFloat(txt(met, 'per-minute'));
                if (UNIT_Q[unit] && pm > 0) bpm = pm * UNIT_Q[unit] * (kids(met, 'beat-unit-dot').length ? 1.5 : 1);
              }
              const words = kid(dt, 'words');
              if (words && /\bD\.?\s?[CS]\.?(\s|$)|da capo|dal segno/i.test(words.textContent)) ctx.jumps = true;
            }
          }
          if (bpm > 0) m.tempos.push({ off: pos, bpm });
        } else if (nm === 'backup') { pos -= num(el, 'duration', 0); }
        else if (nm === 'forward') { pos += num(el, 'duration', 0); maxPos = Math.max(maxPos, pos); }
        else if (nm === 'barline') {
          const loc = el.getAttribute('location') || 'right';
          const rep = kid(el, 'repeat');
          const end = kid(el, 'ending');
          const style = txt(el, 'bar-style');
          if (rep) {
            if (rep.getAttribute('direction') === 'forward') m.repStart = true;
            else { m.repEnd = true; const t = parseInt(rep.getAttribute('times') || '2', 10); if (t > 1) m.repTimes = t; }
          }
          if (end) {
            const type = end.getAttribute('type'), number = end.getAttribute('number') || '1';
            if (type === 'start') m.endStart = number;
            else if (type === 'stop' || type === 'discontinue') m.endStop = { number, type };
          }
          if (style && loc === 'right') m.bar = style;
        } else if (nm === 'note') {
          if (kid(el, 'grace')) { graceSkipped++; continue; }
          const isChord = !!kid(el, 'chord');
          const dur = num(el, 'duration', 0);
          const start = isChord ? lastStart : pos;
          const isRest = !!kid(el, 'rest');
          const n = { off: start, dur, rest: isRest, staff: parseInt(txt(el, 'staff') || '1', 10), voice: txt(el, 'voice') || '1', chord: isChord };
          if (kid(el, 'cue')) { if (!isChord) { lastStart = pos; pos += dur; maxPos = Math.max(maxPos, pos); } continue; }
          if (!isRest) {
            const pe = kid(el, 'pitch');
            if (pe) {
              n.step = txt(pe, 'step'); n.alter = Math.round(num(pe, 'alter', 0)); n.oct = parseInt(txt(pe, 'octave'), 10);
              n.midi = U.midiOf(n.step, n.alter, n.oct);
            } else n.skip = true;
          } else { n.measureRest = kid(el, 'rest').getAttribute('measure') === 'yes'; }
          n.type = txt(el, 'type'); n.dots = kids(el, 'dot').length;
          const ac = txt(el, 'accidental'); n.acc = ac ? ACC[ac] || null : null;
          const sd = txt(el, 'stem'); n.stem = sd === 'up' || sd === 'down' ? sd : null;
          n.beams = kids(el, 'beam').sort((a, b) => parseInt(a.getAttribute('number') || '1', 10) - parseInt(b.getAttribute('number') || '1', 10)).map((b) => b.textContent.trim());
          const tm = kid(el, 'time-modification');
          if (tm) n.tm = { a: num(tm, 'actual-notes', 3), n: num(tm, 'normal-notes', 2) };
          for (const t of kids(el, 'tie')) { if (t.getAttribute('type') === 'start') n.ts = true; else n.te = true; }
          const nots = kid(el, 'notations');
          if (nots) {
            for (const t of kids(nots, 'tied')) { if (t.getAttribute('type') === 'start') n.ts = true; else if (t.getAttribute('type') === 'stop') n.te = true; }
            for (const t of kids(nots, 'tuplet')) { const ty = t.getAttribute('type'); if (ty === 'start') { n.tStart = true; n.tBracket = t.getAttribute('bracket') === 'yes'; } else if (ty === 'stop') n.tStop = true; }
          }
          if (!n.skip) m.notes.push(n);
          if (!isChord) { lastStart = pos; pos += dur; }
          maxPos = Math.max(maxPos, pos, start + dur);
        }
      }
      m.max = maxPos; m.div = div;
      raw.push(m);
    }
    ctx.graceSkipped = (ctx.graceSkipped || 0) + graceSkipped;
    return raw;
  }

  function parseEndNums(label) {
    const out = [];
    for (const part of String(label).split(/[,\s]+/)) {
      const r = /^(\d+)\s*-\s*(\d+)$/.exec(part);
      if (r) for (let i = +r[1]; i <= +r[2]; i++) out.push(i);
      else if (/^\d+$/.test(part)) out.push(+part);
    }
    return out;
  }

  /** Playback order of written measure indexes with repeats and endings unfolded. */
  function unfold(wm) {
    const order = [];
    let i = 0, startIdx = 0, pass = 1, guard = 0;
    while (i < wm.length && guard++ < 100000) {
      const m = wm[i];
      if (m.repStart && startIdx !== i) { startIdx = i; pass = 1; }
      if (m.endNums && m.endNums.length && !m.endNums.includes(pass)) { i++; continue; }
      order.push(i);
      if (m.repEnd) {
        if (pass < m.repTimes) { pass++; i = startIdx; continue; }
        pass = 1; startIdx = i + 1;
      }
      i++;
    }
    return order;
  }
  X.unfold = unfold;

  X.parse = function (text, fileName) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('This file is not valid XML, so it cannot be read as MusicXML.');
    const root = doc.documentElement;
    const rn = root.localName;
    if (rn !== 'score-partwise' && rn !== 'score-timewise') throw new Error('This XML file is not MusicXML (its root element is "' + rn + '", not score-partwise or score-timewise).');
    const warnings = [];
    const names = {};
    const pl = kid(root, 'part-list');
    if (pl) for (const sp of kids(pl, 'score-part')) names[sp.getAttribute('id')] = txt(sp, 'part-name') || '';
    // parts -> arrays of measure elements
    let parts = [];
    if (rn === 'score-partwise') {
      parts = kids(root, 'part').map((p) => ({ id: p.getAttribute('id'), els: kids(p, 'measure') }));
    } else {
      const byId = new Map();
      for (const m of kids(root, 'measure')) {
        for (const p of kids(m, 'part')) {
          const id = p.getAttribute('id');
          if (!byId.has(id)) byId.set(id, []);
          const holder = { localName: 'measure', getAttribute: (a) => (a === 'number' ? m.getAttribute('number') : a === 'implicit' ? m.getAttribute('implicit') : p.getAttribute(a)), firstElementChild: p.firstElementChild };
          byId.get(id).push(holder);
        }
      }
      parts = [...byId.entries()].map(([id, els]) => ({ id, els }));
    }
    if (!parts.length || !parts[0].els.length) throw new Error('This MusicXML file has no music in it (no parts or no measures).');
    const ctx = { jumps: false };
    for (const p of parts) { p.raw = parsePart(p.els, ctx); p.name = names[p.id] || ''; p.staves = 1; for (const m of p.raw) { p.staves = Math.max(p.staves, m.staves || 1); for (const n of m.notes) if (n.staff > p.staves) p.staves = n.staff; } }
    // choose parts and hands
    let defs, handsGuessed = false, handsFrom = 'staves';
    const twoStaff = parts.findIndex((p) => p.staves >= 2);
    let chosen;
    if (twoStaff >= 0) {
      chosen = [parts[twoStaff]];
      defs = [{ p: chosen[0], staff: 1, hand: 'R' }, { p: chosen[0], staff: 2, hand: 'L' }];
      if (parts.length > 1) warnings.push('The file has ' + parts.length + ' parts. Only the piano part "' + (chosen[0].name || chosen[0].id) + '" was used.');
      if (chosen[0].staves > 2) warnings.push('The piano part has more than two staves. Only the first two were used.');
    } else if (parts.length >= 2) {
      chosen = [parts[0], parts[1]];
      defs = [{ p: parts[0], staff: 1, hand: 'R' }, { p: parts[1], staff: 1, hand: 'L' }];
      handsFrom = 'parts';
      if (parts.length > 2) warnings.push('The file has ' + parts.length + ' parts. Only the first two were used (first = right hand, second = left hand).');
    } else {
      chosen = [parts[0]];
      defs = [{ p: parts[0], staff: 1, hand: null }];
      handsGuessed = true; handsFrom = 'guessed';
    }
    const master = chosen[0];
    const nW = master.raw.length;
    // written measures: state carried
    const wm = [];
    let curTime = null, curKey = null, keyDeclared = false;
    let activeEnd = null;
    for (let i = 0; i < nW; i++) {
      const r = master.raw[i];
      if (r.time) curTime = r.time;
      if (r.key != null) { curKey = r.key; keyDeclared = true; }
      const ts = curTime || { num: 4, den: 4 };
      let contentLen = 0;
      for (const d of defs) { const rr = d.p.raw[i]; if (rr) contentLen = Math.max(contentLen, rr.max / rr.div); }
      const expected = (ts.num * 4) / ts.den;
      let lenQ = expected;
      if (r.implicit) lenQ = contentLen > EPS ? contentLen : expected;
      else if (contentLen > expected + 1e-4) lenQ = contentLen;
      const w = { lenQ, label: r.number, time: r.time, key: r.key != null ? r.key : null, clefs: [null, null], repStart: r.repStart, repEnd: r.repEnd, repTimes: r.repTimes, bar: r.bar,
        ending: null, endNums: null, tsEff: ts, keyEff: keyDeclared ? curKey : null, staves: defs.map(() => []), implicit: r.implicit };
      if (r.endStart != null) { activeEnd = { label: r.endStart, nums: parseEndNums(r.endStart) }; }
      if (activeEnd) {
        w.ending = { label: activeEnd.label, first: r.endStart != null, last: false, open: false };
        w.endNums = activeEnd.nums;
        if (r.endStop) { w.ending.last = true; w.ending.open = r.endStop.type === 'discontinue'; activeEnd = null; }
      }
      wm.push(w);
    }
    // events per staff
    const initClef = (rr, st) => { const s = rr && rr.clefs[st]; return s === 'F' ? 'F' : 'G'; };
    const clefs = defs.map((d) => initClef(d.p.raw[0], d.staff));
    const prevClef = clefs.slice();
    const warnedClef = new Set();
    defs.forEach((d, si) => {
      for (let i = 0; i < nW; i++) {
        const rr = d.p.raw[i];
        if (!rr) continue;
        const cs = rr.clefs[d.staff];
        if (cs) {
          const c = cs === 'F' ? 'F' : 'G';
          if (cs !== 'F' && cs !== 'G' && !warnedClef.has(cs)) { warnedClef.add(cs); warnings.push('A ' + cs + ' clef is shown as a treble or bass clef; the pitches are placed correctly.'); }
          if (i > 0 && c !== prevClef[si]) wm[i].clefs[si] = c;
          prevClef[si] = c;
        }
        const byVoice = new Map();
        for (const n of rr.notes) {
          if (n.staff !== d.staff) continue;
          if (!byVoice.has(n.voice)) byVoice.set(n.voice, []);
          const list = byVoice.get(n.voice);
          const t = n.off / rr.div, dq = n.dur / rr.div;
          let ev = n.chord ? list[list.length - 1] : null;
          if (ev && Math.abs(ev.t - t) > 1e-4) ev = null;
          if (!ev) {
            const ty = n.type && N.TYPE_Q[n.type] ? n.type : null;
            let tinfo = { ty, dots: n.dots };
            if (!ty) { const cand = [[4, 'whole', 0], [3, 'half', 1], [2, 'half', 0], [1.5, 'quarter', 1], [1, 'quarter', 0], [0.75, 'eighth', 1], [0.5, 'eighth', 0], [0.25, '16th', 0], [0.125, '32nd', 0]].sort((a, b) => Math.abs(a[0] - dq) - Math.abs(b[0] - dq))[0]; tinfo = { ty: cand[1], dots: cand[2] }; }
            ev = { t, d: dq, ty: tinfo.ty, dots: tinfo.dots, v: parseInt(n.voice, 10) || 1 };
            if (n.rest) { ev.r = 1; if (n.measureRest) ev.wm = 1; } else ev.n = [];
            if (n.tm) { ev.tu = { a: n.tm.a, n: n.tm.n }; if (n.tStart) { ev.tu.start = true; ev.tu.bracket = n.tBracket; } if (n.tStop) ev.tu.stop = true; }
            list.push(ev);
          } else if (n.tm && ev.tu) { if (n.tStart) { ev.tu.start = true; ev.tu.bracket = n.tBracket; } if (n.tStop) ev.tu.stop = true; }
          if (!n.rest) {
            ev.n.push({ m: n.midi, s: n.step, a: n.alter, o: n.oct, acc: n.acc, ts: !!n.ts, te: !!n.te });
            if (!ev.st && n.stem) ev.st = n.stem;
            if (n.beams.length && !ev.bm) ev.bm = n.beams.map((b) => b.replace(/ /g, ' '));
          }
        }
        const voices = [...byVoice.entries()].sort((a, b) => (parseInt(a[0], 10) || 0) - (parseInt(b[0], 10) || 0)).map((e) => e[1]);
        for (const v of voices) { v.sort((a, b) => a.t - b.t); for (const e of v) if (e.n) e.n.sort((a, b) => a.m - b.m); }
        wm[i].staves[si] = voices.length ? voices : [];
        // a staff with no events in the bar gets a whole-bar rest
        if (!voices.length) wm[i].staves[si] = [[{ t: 0, d: wm[i].lenQ, ty: 'whole', dots: 0, r: 1, wm: 1, v: 1 }]];
      }
    });
    if (ctx.graceSkipped) warnings.push(ctx.graceSkipped + ' grace ' + (ctx.graceSkipped === 1 ? 'note was' : 'notes were') + ' left out of playback and notation.');
    if (ctx.jumps) warnings.push('This score has D.C., D.S. or Coda jumps. They are not followed: the piece plays once as written.');

    // playback order and playback model
    const order = unfold(wm);
    const measures = [], notes = [], tempos = [], timeSigs = [], keySigs = [];
    const open = new Map();
    let q = 0, dropped = 0;
    const firstTempo = (() => { for (const m of master.raw) if (m.tempos.length) return m.tempos[0].bpm; return 100; })();
    let curBpm = null, lastTime = null, lastKey = undefined;
    for (const wi of order) {
      const w = wm[wi], r = master.raw[wi];
      measures.push({ q: U.round6(q), lenQ: U.round6(w.lenQ) });
      if (!lastTime || lastTime.num !== w.tsEff.num || lastTime.den !== w.tsEff.den) { timeSigs.push({ q: U.round6(q), num: w.tsEff.num, den: w.tsEff.den }); lastTime = w.tsEff; }
      if (w.keyEff != null && w.keyEff !== lastKey) { keySigs.push({ q: U.round6(q), fifths: w.keyEff }); lastKey = w.keyEff; }
      if (curBpm == null) { tempos.push({ q: 0, bpm: firstTempo }); curBpm = firstTempo; }
      for (const t of r.tempos) {
        const tq = U.round6(q + t.off / r.div);
        if (Math.abs(t.bpm - curBpm) > 1e-6) {
          if (tempos.length && Math.abs(tempos[tempos.length - 1].q - tq) < EPS) tempos[tempos.length - 1].bpm = t.bpm; else tempos.push({ q: tq, bpm: t.bpm });
          curBpm = t.bpm;
        }
      }
      defs.forEach((d, di) => {
        const rr = d.p.raw[wi];
        if (!rr) return;
        const ordered = rr.notes.filter((n) => n.staff === d.staff && !n.rest).sort((a, b) => a.off - b.off);
        for (const n of ordered) {
          if (n.midi < 21 || n.midi > 108) { dropped++; continue; }
          const nq = q + n.off / rr.div, dq = n.dur / rr.div;
          const key = di + '|' + n.midi;
          const o = open.get(key);
          if (n.te && o && Math.abs(o.q + o.durQ - nq) < 1e-4) {
            o.durQ = U.round6(o.durQ + dq);
            if (!n.ts) open.delete(key);
            continue;
          }
          const note = { q: U.round6(nq), durQ: U.round6(dq), midi: n.midi, hand: d.hand, spelled: U.spell(n.step, n.alter, n.oct) };
          notes.push(note);
          if (n.ts) open.set(key, note); else open.delete(key);
        }
      });
      q += w.lenQ;
    }
    if (!notes.length) throw new Error('This MusicXML file has no playable notes.');
    if (dropped) warnings.push(dropped + (dropped === 1 ? ' note was' : ' notes were') + ' outside the 88 piano keys (MIDI 21 to 108) and left out.');
    if (handsGuessed) { U.guessHands(notes); warnings.push('The file has one staff and does not say which hand plays what, so the hands were guessed from pitch. Please check them.'); }
    U.sortNotes(notes);

    // notation: clean written measures
    const written = wm.map((w) => ({ lenQ: w.lenQ, label: w.label, time: w.time, key: w.key, clefs: w.clefs, repStart: w.repStart, repEnd: w.repEnd, bar: w.bar, ending: w.ending, staves: w.staves }));
    if (!written[0].time) written[0].time = { num: wm[0].tsEff.num, den: wm[0].tsEff.den };
    if (written[0].key == null && wm[0].keyEff != null) written[0].key = wm[0].keyEff;
    for (const w of written) {
      defs.forEach((d, si) => { if (!w.staves[si] || !w.staves[si].length) w.staves[si] = [[{ t: 0, d: w.lenQ, ty: 'whole', dots: 0, r: 1, wm: 1, v: 1 }]]; });
    }
    // accidentals as written in the file: nothing to compute. Keys: remember effective key for each measure (renderer uses written key marks).
    const title = txt(kid(root, 'work') || root, 'work-title') || txt(root, 'movement-title') || U.cleanTitle(fileName);
    let composer = '';
    const ident = kid(root, 'identification');
    if (ident) for (const c of kids(ident, 'creator')) if (c.getAttribute('type') === 'composer') { composer = c.textContent.trim(); break; }
    return {
      id: '', title, composer, source: 'musicxml', exactNotation: true, handsGuessed, handsFrom,
      tempos, timeSigs, keySigs, measures, notes, warnings,
      notation: { approximate: false, nstaves: defs.length, clefs, written, playMap: order },
    };
  };
})();
