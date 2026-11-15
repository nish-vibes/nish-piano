/* Standard MIDI File: import to a Song and export from a Song. */
(function () {
  'use strict';
  const W = window.Wapiro, U = W.util, EPS = U.EPS;
  const M = (W.midi = {});

  function readTrack(u8, start, end, trackIdx) {
    let p = start;
    let tick = 0, running = 0;
    const ev = { name: '', notes: [], tempos: [], sigs: [], keys: [], channels: new Set(), endTick: 0 };
    const open = new Map(); // key -> array of {tick, vel}
    const vlq = () => {
      let v = 0;
      for (let i = 0; i < 4; i++) {
        if (p >= end) throw new Error('This MIDI file is damaged: a track ends in the middle of an event.');
        const b = u8[p++];
        v = (v << 7) | (b & 0x7f);
        if (!(b & 0x80)) break;
      }
      return v;
    };
    const closeNote = (ch, pitch, t) => {
      const k = ch * 256 + pitch;
      const q = open.get(k);
      if (q && q.length) {
        const o = q.shift();
        ev.notes.push({ tick: o.tick, endTick: Math.max(t, o.tick), midi: pitch, ch, vel: o.vel, track: trackIdx });
      }
    };
    while (p < end) {
      tick += vlq();
      let st = u8[p];
      if (st === undefined) break;
      if (st & 0x80) { p++; if (st < 0xf0) running = st; } else { st = running; if (!st) throw new Error('This MIDI file is damaged: an event has no status byte.'); }
      if (st === 0xff) {
        const type = u8[p++];
        const len = vlq();
        const d = u8.subarray(p, p + len);
        p += len;
        if (type === 0x03 && !ev.name) ev.name = String.fromCharCode.apply(null, Array.from(d)).replace(/[^\x20-\x7e]/g, '');
        else if (type === 0x51 && len === 3) ev.tempos.push({ tick, us: (d[0] << 16) | (d[1] << 8) | d[2] });
        else if (type === 0x58 && len >= 2) ev.sigs.push({ tick, num: d[0], den: Math.pow(2, d[1]) });
        else if (type === 0x59 && len >= 2) ev.keys.push({ tick, fifths: (d[0] << 24) >> 24, minor: d[1] });
        else if (type === 0x2f) { ev.endTick = tick; break; }
      } else if (st === 0xf0 || st === 0xf7) {
        const len = vlq();
        p += len;
      } else {
        const hi = st & 0xf0, ch = st & 0x0f;
        const need = hi === 0xc0 || hi === 0xd0 ? 1 : 2;
        const a = u8[p], b = need === 2 ? u8[p + 1] : 0;
        p += need;
        if (hi === 0x90 && b > 0) {
          if (ch !== 9) {
            const k = ch * 256 + a;
            if (!open.has(k)) open.set(k, []);
            open.get(k).push({ tick, vel: b });
            ev.channels.add(ch);
          }
        } else if (hi === 0x80 || (hi === 0x90 && b === 0)) {
          if (ch !== 9) closeNote(ch, a, tick);
        }
      }
    }
    const last = Math.max(tick, ev.endTick);
    for (const [k, arr] of open) for (const o of arr) ev.notes.push({ tick: o.tick, endTick: Math.max(last, o.tick + 1), midi: k % 256, ch: (k / 256) | 0, vel: o.vel, track: trackIdx });
    ev.endTick = last;
    return ev;
  }

  function buildMeasures(sigs, endQ) {
    const out = [];
    let q = 0, si = 0;
    while (out.length === 0 || q < endQ - 1e-6) {
      while (si + 1 < sigs.length && sigs[si + 1].q <= q + 1e-6) si++;
      const s = sigs[si];
      let len = (s.num * 4) / s.den;
      const nx = sigs[si + 1];
      if (nx && nx.q < q + len - 1e-6) len = nx.q - q;
      if (!(len > 0)) len = 4;
      out.push({ q: U.round6(q), lenQ: U.round6(len) });
      q += len;
      if (out.length > 20000) break;
    }
    return out;
  }
  M.buildMeasures = buildMeasures;

  M.parse = function (buf, fileName) {
    const u8 = new Uint8Array(buf);
    const be16 = (o) => (u8[o] << 8) | u8[o + 1];
    const be32 = (o) => ((u8[o] << 24) | (u8[o + 1] << 16) | (u8[o + 2] << 8) | u8[o + 3]) >>> 0;
    if (u8.length < 14 || String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== 'MThd') throw new Error('This is not a MIDI file (no MThd header).');
    const hl = be32(4);
    const fmt = be16(8), ntrk = be16(10), div = be16(12);
    if (div & 0x8000) throw new Error('This MIDI file uses SMPTE time (frames per second). Only files with ticks per quarter note can be imported.');
    if (!div) throw new Error('This MIDI file has an invalid time division.');
    if (fmt > 2) throw new Error('This MIDI file has an unknown format number (' + fmt + ').');
    let p = 8 + hl;
    const tracks = [];
    for (let t = 0; t < ntrk && p + 8 <= u8.length; t++) {
      const id = String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);
      const len = be32(p + 4);
      const end = Math.min(u8.length, p + 8 + len);
      if (id === 'MTrk') tracks.push(readTrack(u8, p + 8, end, tracks.length));
      p = end;
    }
    if (!tracks.length) throw new Error('This MIDI file has no tracks.');

    const warnings = [];
    const q = (t) => U.round6(t / div);
    // Tempo map
    const tm = [].concat(...tracks.map((t) => t.tempos)).sort((a, b) => a.tick - b.tick);
    const tempos = [];
    for (const t of tm) {
      const e = { q: q(t.tick), bpm: U.round6(60000000 / t.us) };
      if (tempos.length && Math.abs(tempos[tempos.length - 1].q - e.q) < EPS) tempos[tempos.length - 1] = e;
      else if (!tempos.length || Math.abs(tempos[tempos.length - 1].bpm - e.bpm) > 1e-4) tempos.push(e);
    }
    if (!tempos.length || tempos[0].q > EPS) tempos.unshift({ q: 0, bpm: 120 });
    // Time signatures
    const sg = [].concat(...tracks.map((t) => t.sigs)).sort((a, b) => a.tick - b.tick);
    const timeSigs = [];
    for (const s of sg) {
      if (!(s.num > 0) || !(s.den > 0)) continue;
      const e = { q: q(s.tick), num: s.num, den: s.den };
      const last = timeSigs[timeSigs.length - 1];
      if (last && Math.abs(last.q - e.q) < EPS) timeSigs[timeSigs.length - 1] = e;
      else if (!last || last.num !== e.num || last.den !== e.den) timeSigs.push(e);
    }
    if (!timeSigs.length || timeSigs[0].q > EPS) timeSigs.unshift({ q: 0, num: 4, den: 4 });
    // Key signatures
    const keySigs = [];
    for (const k of [].concat(...tracks.map((t) => t.keys)).sort((a, b) => a.tick - b.tick)) {
      const e = { q: q(k.tick), fifths: Math.max(-7, Math.min(7, k.fifths)) };
      const last = keySigs[keySigs.length - 1];
      if (last && Math.abs(last.q - e.q) < EPS) keySigs[keySigs.length - 1] = e;
      else if (!last || last.fifths !== e.fifths) keySigs.push(e);
    }

    // Notes
    let dropped = 0;
    const groups = new Map(); // "track:ch" -> {name, notes}
    for (const t of tracks) {
      for (const n of t.notes) {
        if (n.midi < 21 || n.midi > 108) { dropped++; continue; }
        const key = t.channels.size > 1 ? n.track + ':' + n.ch : String(n.track);
        if (!groups.has(key)) groups.set(key, { name: t.name, track: n.track, ch: n.ch, notes: [] });
        groups.get(key).notes.push({ q: q(n.tick), durQ: Math.max(q(n.endTick) - q(n.tick), 1 / div), midi: n.midi });
      }
    }
    if (dropped) warnings.push(dropped + (dropped === 1 ? ' note was' : ' notes were') + ' outside the 88 piano keys (MIDI 21 to 108) and left out.');
    const glist = [...groups.values()].filter((g) => g.notes.length);
    const total = glist.reduce((s, g) => s + g.notes.length, 0);
    if (!total) throw new Error('This MIDI file has no playable notes (channel 10 drum tracks are ignored and notes outside the piano range are left out).');

    let handsGuessed = true;
    let notes = [];
    const RIGHT = /right|\brh\b|treble|upper/i, LEFT = /left|\blh\b|bass|lower/i;
    if (glist.length === 2) {
      let [a, b] = glist.sort((x, y) => x.track - y.track || x.ch - y.ch);
      const ra = RIGHT.test(a.name), la = LEFT.test(a.name), rb = RIGHT.test(b.name), lb = LEFT.test(b.name);
      let first = 'R';
      if ((la && !ra) || (rb && !lb)) first = 'L';
      a.hand = first; b.hand = first === 'R' ? 'L' : 'R';
      handsGuessed = false;
    } else if (glist.length === 1) {
      const g = glist[0];
      const r = RIGHT.test(g.name), l = LEFT.test(g.name);
      if (r !== l) { g.hand = r ? 'R' : 'L'; handsGuessed = false; }
    }
    for (const g of glist) for (const n of g.notes) { n.hand = g.hand; notes.push(n); }
    if (handsGuessed) {
      U.guessHands(notes);
      warnings.push('The file does not say which hand plays what, so the hands were guessed from pitch. Please check them.');
    }
    // Key and spelling
    const fifths = keySigs.length ? keySigs[0].fifths : U.estimateKey(notes);
    // Spelling follows the key in force at each note.
    const keyAt = (qq) => { let f = fifths; for (const k of keySigs) if (k.q <= qq + EPS) f = k.fifths; return f; };
    for (const n of notes) { const s = U.spellInKey(n.midi, keyAt(n.q)); n.spelled = U.spell(s.letter, s.alter, s.oct); }
    U.sortNotes(notes);
    const endQ = Math.max(...notes.map((n) => n.q + n.durQ));
    const measures = buildMeasures(timeSigs, endQ);
    return {
      id: '', title: U.cleanTitle(fileName), composer: '', source: 'midi', exactNotation: false, handsGuessed,
      handsFrom: handsGuessed ? 'guessed' : 'tracks',
      tempos, timeSigs, keySigs, measures, notes, notation: null, warnings, estKey: keySigs.length ? null : fifths,
    };
  };

  // ------------------------------------------------------------------ export
  function vlq(n) {
    const b = [n & 0x7f];
    n >>>= 7;
    while (n) { b.unshift((n & 0x7f) | 0x80); n >>>= 7; }
    return b;
  }
  function trackChunk(events) {
    // events: {tick, order, bytes}
    events.sort((a, b) => a.tick - b.tick || a.order - b.order);
    const out = [];
    let last = 0;
    for (const e of events) { out.push(...vlq(e.tick - last)); out.push(...e.bytes); last = e.tick; }
    out.push(0, 0xff, 0x2f, 0);
    const len = out.length;
    return [0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...out];
  }
  const nameEv = (s) => { const b = Array.from(s).map((c) => c.charCodeAt(0) & 0x7f); return { tick: 0, order: 0, bytes: [0xff, 0x03, ...vlq(b.length), ...b] }; };

  M.exportMidi = function (song) {
    const PPQ = 480, tk = (q) => Math.round(q * PPQ);
    const t0 = [nameEv('Tempo map')];
    for (const t of song.tempos) {
      const us = Math.round(60000000 / t.bpm);
      t0.push({ tick: tk(t.q), order: 1, bytes: [0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255] });
    }
    const lg = (d) => Math.round(Math.log2(d));
    const sigs = song.timeSigs.map((s) => ({ q: s.q, num: s.num, den: s.den }));
    // A pickup bar becomes a short first bar.
    const m0 = song.measures[0];
    if (m0 && sigs.length) {
      const s = sigs[0];
      if (Math.abs(m0.lenQ - (s.num * 4) / s.den) > 1e-6 && (!song.measures[1] || song.measures[1].q > 0)) {
        for (const den of [4, 8, 16]) {
          const num = (m0.lenQ * den) / 4;
          if (Math.abs(num - Math.round(num)) < 1e-6 && num >= 1) {
            const after = { q: m0.lenQ, num: s.num, den: s.den };
            sigs.splice(0, 1, { q: 0, num: Math.round(num), den }, after);
            break;
          }
        }
      }
    }
    sigs.sort((a, b) => a.q - b.q);
    for (let i = 0; i < sigs.length; i++) {
      if (i && sigs[i].q === sigs[i - 1].q) continue;
      t0.push({ tick: tk(sigs[i].q), order: 1, bytes: [0xff, 0x58, 4, sigs[i].num, lg(sigs[i].den), 24, 8] });
    }
    for (const k of song.keySigs || []) t0.push({ tick: tk(k.q), order: 1, bytes: [0xff, 0x59, 2, k.fifths & 255, 0] });
    const hands = { R: [nameEv('Right Hand')], L: [nameEv('Left Hand')] };
    for (const n of song.notes) {
      const h = n.hand === 'L' ? 'L' : 'R';
      const on = tk(n.q);
      const off = Math.max(on + 1, tk(n.q + n.durQ));
      hands[h].push({ tick: on, order: 3, bytes: [0x90, n.midi, 80] });
      hands[h].push({ tick: off, order: 2, bytes: [0x80, n.midi, 64] });
    }
    const body = [].concat(trackChunk(t0), trackChunk(hands.R), trackChunk(hands.L));
    const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 3, (PPQ >> 8) & 255, PPQ & 255];
    return Uint8Array.from(head.concat(body));
  };
})();
