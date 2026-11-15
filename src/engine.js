/* Practice engine: clock, tempo map, wait / in-tempo / listen, hands, loop, metronome, count-in, scoring, scheduling of app sound. */
(function () {
  'use strict';
  const W = window.Wapiro, U = W.util, A = W.audio;
  const EPS = 1e-6;
  const LOOKAHEAD = 0.18; // seconds of audio scheduled ahead (real time)
  const EARLY = 0.15;     // seconds a note may be played early in wait mode

  const E = (W.engine = {
    song: null, playing: false, runMode: 'practice', phase: 'run',
    opts: { wait: true, hands: 'R', speed: 1, loop: null, restartAfter: 0, metronome: false, countIn: null, mode: 'practice' },
    sec: 0, q: 0, holding: false, holdQ: 0,
    stats: { hit: 0, missed: 0, wrong: 0 },
    activeKeys: new Set(),
    runValid: true, resultsOpen: false, lastResult: null, finishedFlag: false,
  });
  const listeners = {};
  E.on = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); };
  const emit = (ev, a) => { for (const fn of listeners[ev] || []) { try { fn(a); } catch (e) { W.notify('Internal error: ' + e.message, 'error'); } } };
  E.emit = emit;

  // song-derived arrays
  let n = 0, nq, nd, nm, nh, status, notes, measures, endQ = 0;
  let segQ = [], segSec = [], segBpm = [];
  let pidx = new Int32Array(0), ptime = new Float64Array(0), onsets = [], oPtr = 0, expI = 0;
  let barWrong = new Int32Array(0);
  let schedI = 0, metroQ = 0, lastNow = 0, ciEnd = 0, maxDur = 0;
  E.get = () => ({ notes, measures, n, endQ, nq, nd, nm, nh, status });

  // ---------------------------------------------------------------- tempo map
  function buildTempo(song) {
    segQ = []; segSec = []; segBpm = [];
    let sec = 0;
    const t = song.tempos.length ? song.tempos.slice().sort((a, b) => a.q - b.q) : [{ q: 0, bpm: 100 }];
    if (t[0].q > 0) t.unshift({ q: 0, bpm: t[0].bpm });
    for (let i = 0; i < t.length; i++) {
      if (i > 0) sec += (t[i].q - t[i - 1].q) * 60 / t[i - 1].bpm;
      segQ.push(t[i].q); segSec.push(sec); segBpm.push(t[i].bpm);
    }
  }
  function segAtQ(q) { let lo = 0, hi = segQ.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (segQ[m] <= q) lo = m; else hi = m - 1; } return lo; }
  function qToSec(q) { const i = segAtQ(q); return segSec[i] + (q - segQ[i]) * 60 / segBpm[i]; }
  function secToQ(s) { let lo = 0, hi = segSec.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (segSec[m] <= s) lo = m; else hi = m - 1; } return segQ[lo] + (s - segSec[lo]) * segBpm[lo] / 60; }
  E.qToSec = qToSec; E.secToQ = secToQ;
  E.bpmAt = (q) => segBpm[segAtQ(q)];

  function lowerBound(arr, v, len) { let lo = 0, hi = len; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; } return lo; }
  E.measureIndexAt = function (q) {
    if (!measures || !measures.length) return 0;
    let lo = 0, hi = measures.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (measures[m].q <= q + EPS) lo = m; else hi = m - 1; }
    return lo;
  };
  const loopRange = () => {
    const l = E.opts.loop;
    if (!l || !measures || !measures.length) return null;
    const a = Math.max(1, Math.min(measures.length, Math.round(l.from))), b = Math.max(a, Math.min(measures.length, Math.round(l.to)));
    return { from: a, to: b, q0: measures[a - 1].q, q1: measures[b - 1].q + measures[b - 1].lenQ };
  };
  E.loopRange = loopRange;
  const startQ = () => { const l = loopRange(); return l ? l.q0 : 0; };

  // ---------------------------------------------------------------- practised set
  const practising = () => E.runMode === 'practice';
  function handOk(i) { const h = E.opts.hands; return h === 'both' || (h === 'R' ? nh[i] === 0 : nh[i] === 1); }
  E.isPractised = (i) => handOk(i);
  function buildPractised() {
    const list = [];
    for (let i = 0; i < n; i++) if (handOk(i)) list.push(i);
    pidx = Int32Array.from(list);
    ptime = new Float64Array(list.length);
    onsets = [];
    for (let k = 0; k < list.length; k++) {
      ptime[k] = qToSec(nq[list[k]]);
      const q = nq[list[k]];
      if (!onsets.length || q - onsets[onsets.length - 1].q > 1e-4) onsets.push({ q, a: k, b: k + 1 });
      else onsets[onsets.length - 1].b = k + 1;
    }
  }
  function resolvedOnset(o) { for (let k = o.a; k < o.b; k++) if (status[pidx[k]] === 0) return false; return true; }
  function advanceOPtr() { while (oPtr < onsets.length && resolvedOnset(onsets[oPtr])) oPtr++; }
  function resetPointers(q) {
    oPtr = 0;
    let lo = 0, hi = onsets.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (onsets[m].q < q - 1e-4) lo = m + 1; else hi = m; }
    oPtr = lo; advanceOPtr();
    expI = lowerBound(ptime, qToSec(q) - 1e-4, ptime.length);
    schedI = lowerBound(nq, q - 1e-6, n);
    metroQ = nextBeatAtOrAfter(q - 1e-6);
  }

  // ---------------------------------------------------------------- metronome beats
  function beatLenAt(mi) {
    const m = measures[mi];
    let sg = song_timeSigAt(m.q);
    return U.beatInfo(sg.num, sg.den).beatLen;
  }
  function song_timeSigAt(q) { const ts = E.song.timeSigs; let r = ts[0]; for (const t of ts) if (t.q <= q + EPS) r = t; return r; }
  function nextBeatAtOrAfter(q) {
    if (!measures || !measures.length) return Infinity;
    let mi = E.measureIndexAt(q);
    for (let guard = 0; guard < 3 && mi < measures.length; guard++, mi++) {
      const m = measures[mi], bl = beatLenAt(mi);
      const k = Math.max(0, Math.ceil((q - m.q) / bl - 1e-6));
      const bq = m.q + k * bl;
      if (bq < m.q + m.lenQ - 1e-4) return bq;
      q = m.q + m.lenQ;
    }
    return Infinity;
  }
  E.beatsInBar = (mi) => { const m = measures[mi]; return Math.max(1, Math.round(m.lenQ / beatLenAt(mi))); };

  // ---------------------------------------------------------------- loading
  E.load = function (song, prefs, keepPosition) {
    const prevQ = keepPosition ? E.q : 0;
    E.pause(true);
    E.song = song; notes = song.notes; measures = song.measures; n = notes.length;
    nq = new Float64Array(n); nd = new Float64Array(n); nm = new Uint8Array(n); nh = new Uint8Array(n);
    maxDur = 0;
    for (let i = 0; i < n; i++) { nq[i] = notes[i].q; nd[i] = notes[i].durQ; nm[i] = notes[i].midi; nh[i] = notes[i].hand === 'L' ? 1 : 0; if (nd[i] > maxDur) maxDur = nd[i]; }
    status = new Uint8Array(n);
    endQ = measures.length ? measures[measures.length - 1].q + measures[measures.length - 1].lenQ : 0;
    buildTempo(song);
    barWrong = new Int32Array(measures.length);
    if (prefs) Object.assign(E.opts, prefs);
    if (E.opts.loop && E.opts.loop.to > measures.length) E.opts.loop = null;
    E.runMode = E.opts.mode;
    buildPractised();
    E.songMax = { maxDur };
    startRun(keepPosition ? Math.min(prevQ, endQ) : startQ(), true);
    emit('song', song);
    emit('change');
  };
  E.reloadNotes = function () { if (E.song) E.load(E.song, null, true); };

  function startRun(q, silent) {
    E.stats = { hit: 0, missed: 0, wrong: 0 };
    barWrong.fill(0);
    for (let i = 0; i < n; i++) status[i] = nq[i] >= q - 1e-4 ? 0 : 3;
    E.sec = qToSec(q); E.q = q; E.holding = false; E.finishedFlag = false;
    E.runValid = Math.abs(q - startQ()) < 1e-4 && E.runMode === 'practice';
    E.runFromTop = q < 1e-4 && E.runMode === 'practice';
    resetPointers(q);
    if (A.cancelScheduled) A.cancelScheduled();
    lastNow = performance.now();
    if (!silent) emit('seek', q);
  }

  // ---------------------------------------------------------------- options
  E.setOptions = function (o) {
    const prevHands = E.opts.hands, prevLoop = JSON.stringify(E.opts.loop);
    if (o.wait !== undefined) E.opts.wait = !!o.wait;
    if (o.hands !== undefined) E.opts.hands = o.hands === 'R' || o.hands === 'L' ? o.hands : 'both';
    if (o.speed !== undefined) { const sp = Math.max(0.25, Math.min(1.5, Number(o.speed) || 1)); E.opts.speed = Math.round(sp * 100) / 100; }
    if (o.restartAfter !== undefined) E.opts.restartAfter = Math.max(0, parseInt(o.restartAfter, 10) || 0);
    if (o.metronome !== undefined) E.opts.metronome = !!o.metronome;
    if (o.countIn !== undefined) E.opts.countIn = o.countIn === null ? null : !!o.countIn;
    if (o.mode !== undefined) E.opts.mode = o.mode === 'listen' ? 'listen' : 'practice';
    if (o.loop !== undefined) {
      if (o.loop === null) E.opts.loop = null;
      else if (measures && measures.length) {
        const a = Math.max(1, Math.min(measures.length, Math.round(o.loop.from))), b = Math.max(a, Math.min(measures.length, Math.round(o.loop.to)));
        E.opts.loop = { from: a, to: b };
      }
    }
    if (!E.song) { emit('change'); return; }
    if (!E.playing) E.runMode = E.opts.mode;
    if (E.opts.hands !== prevHands) { buildPractised(); startRun(E.q, true); }
    if (JSON.stringify(E.opts.loop) !== prevLoop && E.opts.loop) {
      const l = loopRange();
      if (E.q < l.q0 - 1e-4 || E.q >= l.q1 - 1e-4) E.seekQ(l.q0);
    }
    emit('change');
  };
  E.effectiveCountIn = () => (E.opts.countIn == null ? !E.opts.wait : !!E.opts.countIn);

  // ---------------------------------------------------------------- transport
  function begin(listenFlag) {
    if (!E.song || E.playing) return;
    if (A.ensure) A.ensure();
    E.runMode = listenFlag ? 'listen' : E.opts.mode;
    buildPractised();
    const l = loopRange();
    if (E.q >= endQ - 1e-4 || (l && E.q >= l.q1 - 1e-4 && E.q < l.q1 + 1e-4)) startRun(startQ(), true);
    else if (E.finishedFlag || E.runMode !== E._lastRunMode) startRun(E.q, true);
    else resetPointers(E.q);
    E._lastRunMode = E.runMode;
    E.playing = true; E.phase = 'run'; E.holding = false;
    lastNow = performance.now();
    E.resultsOpen = false;
    if (E.runMode === 'practice' && E.effectiveCountIn()) startCountIn();
    emit('change');
  }
  E.play = function () { begin(false); };
  E.listen = function () { if (E.playing) E.pause(); begin(true); };
  function startCountIn() {
    const mi = E.measureIndexAt(E.q), bl = beatLenAt(mi);
    const beats = E.beatsInBar(mi);
    const spq = 60 / E.bpmAt(E.q) / E.opts.speed; // real seconds per quarter
    const t0 = A.now() + 0.06;
    for (let k = 0; k < beats; k++) A.click(k === 0, t0 + k * bl * spq);
    E.phase = 'countin';
    ciEnd = performance.now() + 60 + beats * bl * spq * 1000;
    E.countInBeats = beats;
  }
  E.pause = function (silent) {
    if (!E.playing && !silent) return;
    E.playing = false; E.holding = false; E.phase = 'run';
    if (A.cancelScheduled) A.cancelScheduled();
    if (A.releaseAllUser && false) A.releaseAllUser();
    if (!silent) emit('change');
  };
  E.stop = function () {
    const was = E.playing;
    E.pause(true);
    E.runMode = E.opts.mode;
    startRun(startQ(), true);
    emit('seek', E.q);
    if (was) emit('change');
  };
  E.toggle = function () { if (E.playing) E.pause(); else E.play(); };

  E.seekQ = function (q, keepRun) {
    if (!E.song) return;
    q = Math.max(0, Math.min(endQ, q));
    const wasPlaying = E.playing;
    if (A.cancelScheduled) A.cancelScheduled();
    startRun(q, true);
    if (wasPlaying && E.phase === 'countin') E.phase = 'run';
    emit('seek', q);
  };
  E.seekMeasure = function (num) { const i = Math.max(1, Math.min(measures.length, Math.round(num))) - 1; E.seekQ(measures[i].q); };
  E.curMeasure = () => E.measureIndexAt(E.q) + 1;
  E.prevBar = function () {
    const mi = E.measureIndexAt(E.q);
    const m = measures[mi];
    // inside a bar by more than a little: go to its start; else to the previous bar
    E.seekQ(E.q - m.q > 0.25 && !E.holding ? m.q : measures[Math.max(0, mi - 1)].q);
  };
  E.nextBar = function () { const mi = E.measureIndexAt(E.q); if (mi + 1 < measures.length) E.seekQ(measures[mi + 1].q); };
  E.restart = function () { E.seekQ(startQ()); };

  // ---------------------------------------------------------------- tick
  E.liveQ = function () {
    if (!E.playing || E.phase !== 'run' || E.holding) return E.q;
    const now = performance.now();
    let s = E.sec + Math.min(0.05, (now - lastNow) / 1000) * E.opts.speed;
    if (practising() && E.opts.wait) { advanceOPtr(); if (oPtr < onsets.length) s = Math.min(s, qToSec(onsets[oPtr].q)); }
    return Math.min(endQ, secToQ(s));
  };
  const winSec = (q) => Math.max(0.1 * E.opts.speed, 0.12 * 60 / E.bpmAt(q));

  E.tick = function () {
    if (!E.playing || !E.song) return;
    const now = performance.now();
    if (E.phase === 'countin') { if (now >= ciEnd) { E.phase = 'run'; lastNow = now; } return; }
    let dt = (now - lastNow) / 1000; lastNow = now;
    if (dt > 0.25) dt = 0.25;
    let ns = E.sec + dt * E.opts.speed;
    const prac = practising();
    if (prac && E.opts.wait) {
      advanceOPtr();
      if (oPtr < onsets.length) {
        const os = qToSec(onsets[oPtr].q);
        if (ns >= os - 1e-9 && E.sec <= os + 1e-9) { ns = os; E.holding = true; E.holdQ = onsets[oPtr].q; }
        else E.holding = false;
      } else E.holding = false;
    } else E.holding = false;
    const prevQ = E.q;
    E.sec = ns; E.q = secToQ(ns);
    if (prac && !E.opts.wait) expireMissed();
    // loop wrap / end of song
    const l = loopRange();
    if (l && prevQ < l.q1 - 1e-6 && E.q >= l.q1 - 1e-6 && !E.holding) { finishPass(true); return; }
    if (E.sec >= qToSec(endQ) - 1e-9 && !E.holding) { finishPass(false); return; }
    schedule();
  };

  function expireMissed() {
    while (expI < pidx.length) {
      const i = pidx[expI];
      if (status[i] !== 0) { expI++; continue; }
      if (E.sec > ptime[expI] + winSec(nq[i])) { status[i] = 2; E.stats.missed++; expI++; barMistake(E.measureIndexAt(nq[i])); if (!E.playing) return; }
      else break;
    }
  }

  function barMistake(mi) {
    const N_ = E.opts.restartAfter;
    if (!(N_ > 0) || !practising()) return;
    let mistakes = barWrong[mi];
    const m = measures[mi];
    for (let k = 0; k < pidx.length; k++) { const i = pidx[k]; if (nq[i] < m.q - 1e-4) continue; if (nq[i] >= m.q + m.lenQ - 1e-4) break; if (status[i] === 2) mistakes++; }
    if (mistakes >= N_) restartBar(mi);
  }
  function restartBar(mi) {
    const m = measures[mi];
    for (let k = 0; k < pidx.length; k++) {
      const i = pidx[k];
      if (nq[i] < m.q - 1e-4) continue;
      if (nq[i] >= m.q + m.lenQ - 1e-4) break;
      if (status[i] === 1) E.stats.hit--;
      else if (status[i] === 2) E.stats.missed--;
      status[i] = 0;
    }
    E.stats.wrong -= barWrong[mi]; barWrong[mi] = 0;
    // notes after the bar that were hit early stay as they are only if they were in this bar; reset the rest of the lookahead
    for (let i = 0; i < n; i++) if (nq[i] >= m.q + m.lenQ - 1e-4 && status[i] !== 0 && status[i] !== 3) { if (status[i] === 1) E.stats.hit--; else if (status[i] === 2) E.stats.missed--; status[i] = 0; }
    E.sec = qToSec(m.q); E.q = m.q; E.holding = false;
    resetPointers(m.q);
    if (A.cancelScheduled) A.cancelScheduled();
    emit('seek', m.q);
  }

  function accuracy() { const t = E.stats.hit + E.stats.missed + E.stats.wrong; return t ? E.stats.hit / t : null; }
  E.accuracy = accuracy;

  function scoreRun(kind) {
    // A best score is saved only for a Practice run of the whole song from its start. A loop pass is scored but never saved.
    const acc = accuracy();
    const whole = kind === 'song' && E.runFromTop && !loopRange();
    const res = { stats: Object.assign({}, E.stats), accuracy: acc, kind, valid: kind === 'loop' ? E.runValid : whole, saved: false, songId: E.song.id, bars: E.barStats(), best: null };
    const rec = W.storage.find(E.song.id);
    if (practising() && whole && acc != null) { res.saved = W.storage.setBest(E.song.id, Math.round(acc * 100)); res.counted = true; }
    res.best = rec ? rec.best : null;
    E.lastResult = res;
    emit('result', res);
  }

  function finishPass(isLoop) {
    if (E.runMode === 'practice' && E.song) {
      // unplayed practised notes are missed
      const lim = isLoop ? loopRange().q1 - 1e-4 : Infinity;
      for (let k = 0; k < pidx.length; k++) { const i = pidx[k]; if (status[i] === 0 && nq[i] < lim) { status[i] = 2; E.stats.missed++; } }
    }
    if (isLoop) {
      if (E.runMode === 'practice') scoreRun('loop');
      const l = loopRange();
      if (A.cancelScheduled) A.cancelScheduled();
      startRun(l.q0, true);
      lastNow = performance.now();
      emit('wrap', l.q0);
      return;
    }
    E.sec = qToSec(endQ); E.q = endQ;
    E.playing = false; E.holding = false; E.finishedFlag = true;
    if (E.runMode === 'practice') scoreRun('song');
    emit('finish', E.lastResult);
    emit('change');
  }

  // ---------------------------------------------------------------- scheduling app sound
  function schedule() {
    if (!A.ctx || A.ctx.state !== 'running') { skipSchedule(); return; }
    const spd = E.opts.speed;
    let horizonSec = E.sec + LOOKAHEAD * spd;
    let horizonQ = secToQ(horizonSec);
    if (practising() && E.opts.wait) { advanceOPtr(); if (oPtr < onsets.length) horizonQ = Math.min(horizonQ, onsets[oPtr].q - 1e-5); }
    const l = loopRange();
    if (l) horizonQ = Math.min(horizonQ, l.q1 - 1e-5);
    horizonQ = Math.min(horizonQ, endQ);
    const t0 = A.now();
    const auto = E.runMode === 'listen';
    while (schedI < n && nq[schedI] <= horizonQ) {
      const i = schedI++;
      if (!auto && handOk(i)) continue;
      if (!auto && E.opts.hands === 'both') continue;
      const ts = qToSec(nq[i]);
      A.schedule(nm[i], 78, t0 + Math.max(0, (ts - E.sec) / spd), (qToSec(nq[i] + nd[i]) - ts) / spd);
    }
    if (E.opts.metronome) {
      while (metroQ <= horizonQ && metroQ < endQ) {
        const mi = E.measureIndexAt(metroQ);
        const accent = Math.abs(metroQ - measures[mi].q) < 1e-4;
        A.click(accent, t0 + Math.max(0, (qToSec(metroQ) - E.sec) / spd));
        metroQ = nextBeatAtOrAfter(metroQ + 1e-4);
      }
    } else metroQ = Math.max(metroQ, nextBeatAtOrAfter(Math.max(E.q, horizonQ) - 1e-6));
  }
  function skipSchedule() {
    const horizonQ = secToQ(E.sec);
    while (schedI < n && nq[schedI] <= horizonQ) schedI++;
    while (metroQ <= horizonQ && metroQ < endQ) metroQ = nextBeatAtOrAfter(metroQ + 1e-4);
  }

  // ---------------------------------------------------------------- input
  /** A key went down (MIDI keyboard, screen keys, computer keys or a test hook). */
  E.noteOn = function (midi, vel) {
    midi = Math.round(midi);
    if (midi < 21 || midi > 108) return;
    E.activeKeys.add(midi);
    if (W.storage.settings.userSound !== false && A.noteOn) A.noteOn(midi, vel || 90);
    emit('key', { midi, down: true });
    if (!E.song || !E.playing || E.phase !== 'run' || !practising()) return;
    if (E.opts.wait) {
      advanceOPtr();
      const o = oPtr < onsets.length ? onsets[oPtr] : null;
      let ok = false;
      if (o) {
        const dtReal = (qToSec(o.q) - E.sec) / E.opts.speed;
        if (E.holding || dtReal <= EARLY) {
          for (let k = o.a; k < o.b; k++) {
            const i = pidx[k];
            if (status[i] === 0 && nm[i] === midi) { status[i] = 1; E.stats.hit++; ok = true; break; }
          }
        }
      }
      if (ok) { advanceOPtr(); return; }
    } else {
      const wmax = winSec(E.q) * 1.0;
      let k = lowerBound(ptime, E.sec - wmax - 0.05, ptime.length), bestK = -1, bestD = Infinity;
      for (; k < ptime.length && ptime[k] <= E.sec + wmax + 0.05; k++) {
        const i = pidx[k];
        if (status[i] !== 0 || nm[i] !== midi) continue;
        const d = Math.abs(ptime[k] - E.sec);
        if (d <= winSec(nq[i]) && d < bestD) { bestD = d; bestK = k; }
      }
      if (bestK >= 0) { status[pidx[bestK]] = 1; E.stats.hit++; return; }
    }
    E.stats.wrong++;
    const mi = E.measureIndexAt(E.q);
    barWrong[mi]++;
    barMistake(mi);
  };
  E.noteOff = function (midi) {
    midi = Math.round(midi);
    E.activeKeys.delete(midi);
    if (A.noteOff) A.noteOff(midi);
    emit('key', { midi, down: false });
  };
  E.pedal = function (down) { if (A.setPedal) A.setPedal(down); };

  // ---------------------------------------------------------------- queries
  E.noteStatus = (i) => status[i];
  E.waitingFor = function () {
    if (!E.playing || !E.holding || !practising() || !E.opts.wait) return [];
    advanceOPtr();
    if (oPtr >= onsets.length) return [];
    const o = onsets[oPtr], out = [];
    for (let k = o.a; k < o.b; k++) { const i = pidx[k]; if (status[i] === 0) out.push({ q: nq[i], midi: nm[i], hand: nh[i] ? 'L' : 'R' }); }
    return out;
  };
  /** Upcoming pending notes of the practised hand(s), for key hints. */
  E.nextExpected = function () {
    if (!E.song || !practising()) return [];
    advanceOPtr();
    if (oPtr >= onsets.length) return [];
    const o = onsets[oPtr], out = [];
    for (let k = o.a; k < o.b; k++) { const i = pidx[k]; if (status[i] === 0) out.push(nm[i]); }
    return out;
  };
  E.barStats = function () {
    // per playback bar: hit / missed / wrong for the practised notes of the last run
    const out = measures.map(() => ({ hit: 0, missed: 0, wrong: 0 }));
    for (let k = 0; k < pidx.length; k++) { const i = pidx[k]; const s = status[i]; if (s === 1 || s === 2) out[E.measureIndexAt(nq[i])][s === 1 ? 'hit' : 'missed']++; }
    out.forEach((o, i) => { o.wrong = barWrong[i]; });
    return out;
  };
  E.visibleOpts = () => Object.assign({}, E.opts);

  E.snapshot = function () {
    return {
      songId: E.song ? E.song.id : null, playing: E.playing, mode: E.playing ? E.runMode : E.opts.mode,
      q: E.q, measure: E.song ? E.curMeasure() : 0, waitingFor: E.waitingFor(), stats: Object.assign({}, E.stats),
      activeKeys: [...E.activeKeys].sort((a, b) => a - b),
    };
  };

  setInterval(E.tick, 20);
})();
