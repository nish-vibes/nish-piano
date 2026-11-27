/* Shared helpers: namespace, pitch spelling, keys, hands guess. */
(function () {
  'use strict';
  const W = (window.Wapiro = window.Wapiro || {});
  const U = (W.util = {});
  const EPS = 1e-6;
  U.EPS = EPS;
  U.VERSION = '2.1.0';

  const STEP_SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  U.STEP_SEMI = STEP_SEMI;
  U.LETTERS = LETTERS;
  U.DIA = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

  U.midiOf = (letter, alter, oct) => (oct + 1) * 12 + STEP_SEMI[letter] + alter;
  const ACC_TXT = { '-2': 'bb', '-1': 'b', '0': '', '1': '#', '2': 'x' };
  /** The exact device-pixel size a canvas is shown at. Chromium snaps a canvas to whole device pixels and reports that size
   * through ResizeObserver's device-pixel-content-box; a bitmap of exactly that size is shown 1:1, never stretched (a
   * bitmap even half a pixel off was resampled and looked soft, at 100 % scale as well). */
  U.watchPixels = function (canvas, onChange) {
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) { const d = e.devicePixelContentBoxSize && e.devicePixelContentBoxSize[0]; if (d) canvas._dp = { w: d.inlineSize, h: d.blockSize }; }
      if (onChange) onChange();
    });
    try { ro.observe(canvas, { box: 'device-pixel-content-box' }); } catch (e) { ro.observe(canvas); }
  };
  U.pixelSize = function (canvas, rect) {
    const dpr = window.devicePixelRatio || 1;
    const fallback = { w: Math.max(1, Math.round(rect.width * dpr)), h: Math.max(1, Math.round(rect.height * dpr)) };
    const dp = canvas._dp;
    // use the observed size only while it still matches the layout (it arrives a frame after a resize)
    return dp && Math.abs(dp.w - fallback.w) <= 1 && Math.abs(dp.h - fallback.h) <= 1 ? dp : fallback;
  };
  U.spell = (letter, alter, oct) => letter + (ACC_TXT[alter] || '') + oct;
  U.parseSpelled = (s) => {
    const m = /^([A-G])(bb|b|#|x)?(-?\d+)$/.exec(s);
    if (!m) return null;
    const alter = { bb: -2, b: -1, '#': 1, x: 2 }[m[2]] || 0;
    return { letter: m[1], alter, oct: parseInt(m[3], 10) };
  };
  U.octaveOf = (midi, letter, alter) => Math.floor((midi - alter - STEP_SEMI[letter]) / 12) - 1;
  U.isBlack = (midi) => [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);

  const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
  const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
  /** letter -> alteration implied by a key signature with the given number of sharps (+) or flats (-). */
  U.keyAlter = (fifths) => {
    const m = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
    if (fifths > 0) for (let i = 0; i < Math.min(7, fifths); i++) m[SHARP_ORDER[i]] = 1;
    if (fifths < 0) for (let i = 0; i < Math.min(7, -fifths); i++) m[FLAT_ORDER[i]] = -1;
    return m;
  };
  U.SHARP_ORDER = SHARP_ORDER;
  U.FLAT_ORDER = FLAT_ORDER;

  /** Name a MIDI pitch according to a key signature (flats in flat keys). */
  U.spellInKey = (midi, fifths) => {
    const pc = ((midi % 12) + 12) % 12;
    const ka = U.keyAlter(fifths || 0);
    for (const L of LETTERS) {
      if ((STEP_SEMI[L] + ka[L] + 12) % 12 === pc) return { letter: L, alter: ka[L], oct: U.octaveOf(midi, L, ka[L]) };
    }
    const sharpNames = { 1: ['C', 1], 3: ['D', 1], 6: ['F', 1], 8: ['G', 1], 10: ['A', 1] };
    const flatNames = { 1: ['D', -1], 3: ['E', -1], 6: ['G', -1], 8: ['A', -1], 10: ['B', -1] };
    const pick = (fifths || 0) >= 0 ? sharpNames[pc] : flatNames[pc];
    if (pick) return { letter: pick[0], alter: pick[1], oct: U.octaveOf(midi, pick[0], pick[1]) };
    const white = { 0: 'C', 2: 'D', 4: 'E', 5: 'F', 7: 'G', 9: 'A', 11: 'B' }[pc];
    return { letter: white, alter: 0, oct: U.octaveOf(midi, white, 0) };
  };

  const KS_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const KS_MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  /** Krumhansl-Schmuckler key estimate. Returns the number of sharps (+) or flats (-). */
  U.estimateKey = (notes) => {
    const hist = new Array(12).fill(0);
    for (const n of notes) hist[((n.midi % 12) + 12) % 12] += Math.max(0.05, Math.min(n.durQ, 4));
    const corr = (a, b) => {
      const ma = a.reduce((x, y) => x + y, 0) / 12, mb = b.reduce((x, y) => x + y, 0) / 12;
      let num = 0, da = 0, db = 0;
      for (let i = 0; i < 12; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
      return da && db ? num / Math.sqrt(da * db) : 0;
    };
    let best = -2, bestF = 0;
    for (let t = 0; t < 12; t++) {
      const rot = hist.map((_, i) => hist[(i + t) % 12]);
      for (const [prof, minor] of [[KS_MAJ, false], [KS_MIN, true]]) {
        const c = corr(rot, prof);
        if (c > best) { best = c; bestF = minor ? ((t + 3) % 12) : t; }
      }
    }
    let f = (bestF * 7) % 12;
    if (f > 6) f -= 12;
    return f;
  };

  /** Guess which hand plays each note: running centre per hand, hand span of about a ninth, split starts at middle C. */
  U.guessHands = (notes) => {
    const order = notes.slice().sort((a, b) => a.q - b.q || a.midi - b.midi);
    let cR = 67, cL = 53;
    const SPAN = 14;
    let i = 0;
    while (i < order.length) {
      let j = i;
      while (j < order.length && order[j].q - order[i].q < 0.03) j++;
      const g = order.slice(i, j);
      let bestK = 0, bestCost = Infinity;
      for (let k = 0; k <= g.length; k++) {
        const lo = g.slice(0, k), hi = g.slice(k);
        const span = (a) => (a.length ? a[a.length - 1].midi - a[0].midi : 0);
        let cost = 0;
        if (span(lo) > SPAN) cost += 1000 + span(lo);
        if (span(hi) > SPAN) cost += 1000 + span(hi);
        for (const n of lo) cost += Math.abs(n.midi - cL) + (n.midi >= 72 ? 6 : 0);
        for (const n of hi) cost += Math.abs(n.midi - cR) + (n.midi <= 48 ? 6 : 0);
        cost += k > 0 && k < g.length ? 0.5 : 0;
        if (cost < bestCost - 1e-9 || (Math.abs(cost - bestCost) < 1e-9 && k < bestK)) { bestCost = cost; bestK = k; }
      }
      const lo = g.slice(0, bestK), hi = g.slice(bestK);
      lo.forEach((n) => { n.hand = 'L'; });
      hi.forEach((n) => { n.hand = 'R'; });
      if (lo.length) cL = 0.7 * cL + 0.3 * (lo.reduce((s, n) => s + n.midi, 0) / lo.length);
      if (hi.length) cR = 0.7 * cR + 0.3 * (hi.reduce((s, n) => s + n.midi, 0) / hi.length);
      i = j;
    }
  };

  /** Length in quarters of one metronome beat and of one beaming group for a time signature. */
  U.beatInfo = (num, den) => {
    const compound = den >= 8 && num > 3 && num % 3 === 0;
    const unit = 4 / den;
    return { beatLen: compound ? unit * 3 : unit, compound };
  };

  U.cleanTitle = (fileName) => String(fileName || 'Untitled').replace(/^.*[\\/]/, '').replace(/\.[A-Za-z0-9]+$/, '').replace(/[_]+/g, ' ').trim() || 'Untitled';

  /** Make a song complete and consistent after notes were set. */
  U.sortNotes = (notes) => notes.sort((a, b) => a.q - b.q || a.midi - b.midi || (a.hand < b.hand ? -1 : a.hand > b.hand ? 1 : 0));

  U.round6 = (v) => Math.round(v * 1e6) / 1e6;
})();
