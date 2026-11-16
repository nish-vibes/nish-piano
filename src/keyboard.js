/* On-screen keyboard (DOM keys) and the key geometry shared with the waterfall. */
(function () {
  'use strict';
  const W = window.Wapiro, E = W.engine;
  const WHITE = [0, 2, 4, 5, 7, 9, 11];
  const isBlack = (m) => !WHITE.includes(((m % 12) + 12) % 12);
  const BLACK_SHIFT = { 1: -0.1, 3: 0.1, 6: -0.1, 8: 0, 10: 0.1 };

  const G = (W.geom = { lo: 21, hi: 108, width: 800, whiteW: 20, whites: [], index: new Map(), showAll: false, scrollX: 0, viewW: 800 });

  /** Choose the displayed range: the song's range rounded out to whole octaves, at least three octaves; or all 88 keys. */
  G.rangeFor = function (song, showAll) {
    if (showAll || !song || !song.notes.length) return [21, 108];
    let mn = 127, mx = 0;
    for (const n of song.notes) { if (n.midi < mn) mn = n.midi; if (n.midi > mx) mx = n.midi; }
    let lo = Math.floor(mn / 12) * 12, hi = Math.floor(mx / 12) * 12 + 11;
    while ((hi - lo + 1) / 12 < 3) { if (lo > 21 && (mn - lo >= hi - mx || hi >= 108)) lo -= 12; else if (hi < 108) hi += 12; else break; }
    return [Math.max(21, lo), Math.min(108, hi)];
  };
  G.setRange = function (lo, hi, width) {
    G.lo = lo; G.hi = hi; G.width = width;
    G.whites = []; G.index = new Map();
    for (let m = lo; m <= hi; m++) if (!isBlack(m)) { G.index.set(m, G.whites.length); G.whites.push(m); }
    G.whiteW = width / G.whites.length;
  };
  /** { x, w, black } of a key, in pixels across the keyboard width. */
  G.keyRect = function (m) {
    if (!isBlack(m)) { const i = G.index.get(m); return { x: i * G.whiteW, w: G.whiteW, black: false }; }
    const below = G.index.get(m - 1);
    const bw = G.whiteW * 0.6;
    const cx = (below + 1) * G.whiteW + (BLACK_SHIFT[((m % 12) + 12) % 12] || 0) * G.whiteW * 0.5;
    return { x: cx - bw / 2, w: bw, black: true };
  };
  G.inRange = (m) => m >= G.lo && m <= G.hi;
  /** Pitch under a point (x, y) in the keyboard box of height h. */
  G.hit = function (x, y, h) {
    if (x < 0 || x >= G.width) return null;
    const bh = h * 0.62;
    if (y <= bh) {
      for (let m = G.lo; m <= G.hi; m++) if (isBlack(m)) { const r = G.keyRect(m); if (x >= r.x && x < r.x + r.w) return m; }
    }
    const i = Math.min(G.whites.length - 1, Math.floor(x / G.whiteW));
    return G.whites[i];
  };

  const K = (W.keyboard = { el: null, keys: new Map(), last: new Map(), pointers: new Map() });
  const noteName = (m) => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][m % 12] + (Math.floor(m / 12) - 1);

  K.mount = function (el) {
    K.el = el;
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('lostpointercapture', onUp);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  };
  K.layout = function (lo, hi) {
    const el = K.el;
    G.setRange(lo, hi, G.whiteWFixed * 52);
    el.style.width = G.width + 'px';
    el.textContent = '';
    K.keys.clear(); K.last.clear();
    const frag = document.createDocumentFragment();
    const blacks = [];
    for (let m = lo; m <= hi; m++) {
      const r = G.keyRect(m);
      const d = document.createElement('div');
      d.className = 'key ' + (r.black ? 'black' : 'white');
      d.style.left = r.x + 'px'; d.style.width = r.w + 'px';
      d.dataset.midi = String(m);
      if (!r.black && m % 12 === 0) { const s = document.createElement('span'); s.className = 'key-label'; s.textContent = noteName(m); d.appendChild(s); }
      const dot = document.createElement('i'); dot.className = 'key-dot'; d.appendChild(dot);
      K.keys.set(m, d);
      if (r.black) blacks.push(d); else frag.appendChild(d);
    }
    blacks.forEach((b) => frag.appendChild(b));
    el.appendChild(frag);
  };

  function pitchAt(e) {
    const r = K.el.getBoundingClientRect();
    return G.hit(e.clientX - r.left, e.clientY - r.top, r.height);
  }
  function onDown(e) {
    if (e.button > 0) return;
    W.audio.ensure && W.audio.ensure();
    const m = pitchAt(e);
    if (m == null) return;
    try { K.el.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
    K.pointers.set(e.pointerId, m);
    E.noteOn(m, 90);
    e.preventDefault();
  }
  function onMove(e) {
    if (!K.pointers.has(e.pointerId)) return;
    const m = pitchAt(e), old = K.pointers.get(e.pointerId);
    if (m == null || m === old) return;
    K.pointers.set(e.pointerId, m);
    E.noteOff(old); E.noteOn(m, 90); // glissando
  }
  function onUp(e) {
    if (!K.pointers.has(e.pointerId)) return;
    const old = K.pointers.get(e.pointerId);
    K.pointers.delete(e.pointerId);
    // another finger may still hold the same key
    let still = false; for (const v of K.pointers.values()) if (v === old) still = true;
    if (!still) E.noteOff(old);
  }

  // a wrong key shows the wrong-note red for a moment: the beam in the waterfall rises from it
  E.on('wrong', (e) => { const el = K.keys.get(e.midi); if (!el) return; el.classList.add('is-wrong'); clearTimeout(el._wrongT); el._wrongT = setTimeout(() => el.classList.remove('is-wrong'), 420); });

  /** Update key highlights; only keys whose state changed touch the DOM. */
  K.update = function () {
    const down = E.activeKeys, wait = new Set(E.waitingFor().map((n) => n.midi));
    const next = new Set(E.nextExpected()), free = !!(W.free && W.free.active);
    for (const [m, el] of K.keys) {
      const s = (down.has(m) ? 1 : 0) | (wait.has(m) ? 2 : 0) | (!wait.size && next.has(m) ? 4 : 0) | (free && m < 60 ? 8 : 0);
      if (K.last.get(m) === s) continue;
      K.last.set(m, s);
el.classList.toggle('is-left', (s & 9) === 9); // Freeplay: keys below middle C light in the left hand's colour
      el.classList.toggle('is-down', !!(s & 1)); el.classList.toggle('is-wait', !!(s & 2)); el.classList.toggle('is-next', !!(s & 4));
    }
  };
})();
