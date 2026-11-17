/* Web Audio synth: piano (modest additive model with hammer noise), electric piano, organ, harpsichord, marimba, strings. Any one can be layered over another. Also the metronome click. */
(function () {
  'use strict';
  const W = window.Wapiro;
  const A = (W.audio = { available: !!(window.AudioContext || window.webkitAudioContext), instrument: 'piano', layer: null, volume: 0.7, accVolume: 0.7, metroVolume: 0.7, mute: false, ctx: null });
  let master, userBus, accBus, metroBus, comp, noise, direct, clip;
  A.lowLatency = false;
  const active = new Map();   // midi -> voice (user notes)
  const sustained = new Set();
  const scheduled = new Set(); // accompaniment voices
  let pedal = false;

  A.ensure = function () {
    if (!A.available) return false;
    if (!A.ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      // Low latency: the smallest output buffer the system allows (latencyHint 0) and, where the browser supports it
      // (Chromium 153 and later), a 32-frame render quantum instead of 128. Both are requests; the browser may round up.
      const opts = A.lowLatency ? { latencyHint: 0, renderSizeHint: 32 } : { latencyHint: 'interactive' };
      try { A.ctx = new C(opts); } catch (e) { try { A.ctx = new C({ latencyHint: 'interactive' }); } catch (e2) { A.available = false; return false; } }
      const c = A.ctx;
      master = c.createGain(); userBus = c.createGain(); accBus = c.createGain(); metroBus = c.createGain(); metroBus.connect(c.destination);
      comp = c.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 20; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
      accBus.connect(master); master.connect(comp); comp.connect(c.destination);
      if (A.lowLatency) {
        // your own notes skip the compressor (it looks ahead and delays the sound by a few milliseconds);
        // a soft clipper with no look-ahead keeps loud chords from distorting
        direct = c.createGain(); clip = c.createWaveShaper();
        const k = new Float32Array(1025); for (let i = 0; i < k.length; i++) { const x = (i / 512) - 1; k[i] = Math.tanh(1.6 * x) / Math.tanh(1.6); }
        clip.curve = k; clip.oversample = 'none';
        userBus.connect(direct); direct.connect(clip); clip.connect(c.destination);
      } else { direct = clip = null; userBus.connect(master); }
      const len = Math.floor(c.sampleRate * 0.05);
      noise = c.createBuffer(1, len, c.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      A.applyVolumes();
    }
    if (A.ctx.state === 'suspended') A.ctx.resume().catch(() => {});
    return true;
  };
  /** A media stream of what the app plays (without the metronome), for video export. */
  let tap = null;
  A.tap = function () { if (!A.ensure()) return null; if (!tap) { tap = A.ctx.createMediaStreamDestination(); comp.connect(tap); if (clip) clip.connect(tap); } return tap.stream; };
  /** Switch low-latency mode. The buffer size is fixed when the audio context is made, so the context is rebuilt. */
  A.setLowLatency = function (on) {
    on = !!on;
    if (on === A.lowLatency && A.ctx) return;
    A.lowLatency = on;
    if (!A.ctx) return;
    const old = A.ctx;
    A.ctx = null; tap = null; active.clear(); sustained.clear(); scheduled.clear();
    try { old.close(); } catch (e) { /* already closed */ }
    A.ensure();
  };
  /** Key-to-sound delay the browser reports for the current context, in ms, and the render quantum in use. */
  A.latency = function () {
    const c = A.ctx;
    if (!c) return null;
    return { ms: Math.round(((c.baseLatency || 0) + (c.outputLatency || 0)) * 1000), quantum: c.renderQuantumSize || 128, rate: c.sampleRate };
  };
  A.applyVolumes = function () {
    if (!A.ctx) return;
    const t = A.ctx.currentTime;
    master.gain.setTargetAtTime(A.mute ? 0 : A.volume * 0.6, t, 0.01);
    if (direct) direct.gain.setTargetAtTime(A.mute ? 0 : A.volume * 0.6, t, 0.01);
    accBus.gain.setTargetAtTime(A.accVolume, t, 0.01);
    metroBus.gain.setTargetAtTime(A.mute ? 0 : A.metroVolume, t, 0.01);
  };
  A.now = () => (A.ctx ? A.ctx.currentTime : 0);

  function freq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  /** Build a voice that starts at time t. Returns { rel, oscs, end } where rel is the release gate. */
  function makeVoice(midi, vel, t, bus, inst, level) {
    const c = A.ctx, f = freq(midi);
    const v = Math.max(0.12, Math.min(1, vel / 127));
    const rel = c.createGain(); rel.gain.value = level == null ? 1 : level;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass';
    const oscs = [];
    const out = c.createGain();
    out.connect(lp); lp.connect(rel); rel.connect(bus);
    let end = t + 6;
    const osc = (type, fr, g, decay, detune) => {
      const o = c.createOscillator(); o.type = type; o.frequency.value = fr; if (detune) o.detune.value = detune;
      const e = c.createGain();
      e.gain.setValueAtTime(g, t);
      if (decay) e.gain.setTargetAtTime(0.0001, t + 0.01, decay);
      o.connect(e); e.connect(out); o.start(t); oscs.push(o);
      return e;
    };
    inst = inst || A.instrument;
    if (inst === 'marimba') {
      // struck wooden bar: a strong fundamental with a short-lived tone about two octaves up, and a soft mallet tap
      lp.frequency.value = Math.min(7000, f * 6 + 800);
      const dec = 0.5 - 0.38 * ((midi - 21) / 87);
      out.gain.setValueAtTime(0.0001, t); out.gain.linearRampToValueAtTime(0.55 * (0.4 + 0.6 * v), t + 0.002);
      osc('sine', f, 1, dec); osc('sine', f * 3.97, 0.35, dec * 0.35); osc('sine', f * 9.9, 0.08, dec * 0.12);
      const ns = c.createBufferSource(); ns.buffer = noise;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = Math.min(4000, f * 2 + 500); bp.Q.value = 1.2;
      const ng = c.createGain(); ng.gain.setValueAtTime(0.1 * v, t); ng.gain.setTargetAtTime(0.0001, t, 0.01);
      ns.connect(bp); bp.connect(ng); ng.connect(out); ns.start(t); oscs.push(ns);
      end = t + 2.5;
    } else if (inst === 'epiano') {
      lp.frequency.value = Math.min(9000, f * 8 + 1200);
      out.gain.setValueAtTime(0.0001, t); out.gain.linearRampToValueAtTime(0.5 * v, t + 0.006);
      out.gain.setTargetAtTime(0.0001, t + 0.05, 1.4);
      const car = c.createOscillator(); car.type = 'sine'; car.frequency.value = f;
      const mod = c.createOscillator(); mod.type = 'sine'; mod.frequency.value = f * 14;
      const mg = c.createGain(); mg.gain.setValueAtTime(f * 1.2 * v, t); mg.gain.setTargetAtTime(f * 0.05, t, 0.12);
      mod.connect(mg); mg.connect(car.frequency);
      const mod2 = c.createOscillator(); mod2.type = 'sine'; mod2.frequency.value = f;
      const mg2 = c.createGain(); mg2.gain.setValueAtTime(f * 0.5, t); mg2.gain.setTargetAtTime(f * 0.1, t, 0.5);
      mod2.connect(mg2); mg2.connect(car.frequency);
      car.connect(out); car.start(t); mod.start(t); mod2.start(t); oscs.push(car, mod, mod2);
      end = t + 7;
    } else if (inst === 'harpsichord') {
      // plucked: bright sawtooth through a closing filter, quick decay
      lp.frequency.setValueAtTime(Math.min(14000, f * 14 + 2000), t); lp.frequency.setTargetAtTime(Math.min(8000, f * 5 + 800), t, 0.08);
      out.gain.setValueAtTime(0.0001, t); out.gain.linearRampToValueAtTime(0.28 * (0.5 + 0.5 * v), t + 0.002);
      osc('sawtooth', f, 0.6, 1.1 - 0.5 * ((midi - 21) / 87)); osc('square', f * 2, 0.12, 0.4);
      end = t + 3;
    } else if (inst === 'strings') {
      // bowed: detuned sawtooths, slow attack, soft filter
      lp.frequency.value = Math.min(6000, f * 4 + 900);
      out.gain.setValueAtTime(0.0001, t); out.gain.linearRampToValueAtTime(0.16 * (0.5 + 0.5 * v), t + 0.18);
      osc('sawtooth', f, 0.5, 0, -7); osc('sawtooth', f, 0.5, 0, 7); osc('triangle', f / 2, 0.2, 0);
      end = t + 60;
    } else if (inst === 'organ') {
      lp.frequency.value = 7000;
      out.gain.setValueAtTime(0.0001, t); out.gain.linearRampToValueAtTime(0.32 * v + 0.08, t + 0.012);
      [[0.5, 0.3], [1, 0.5], [2, 0.3], [3, 0.16], [4, 0.1]].forEach(([h, g]) => osc('sine', f * h, g, 0));
      end = t + 60;
    } else {
      // piano: partials with slight inharmonicity; upper partials die faster; low notes ring longer
      const reg = (midi - 21) / 87;
      const base = 5.2 - 3.4 * reg;
      lp.frequency.value = Math.min(12000, f * (3 + v * 9) + 600);
      out.gain.setValueAtTime(0.0001, t); out.gain.linearRampToValueAtTime(0.5 * (0.35 + 0.65 * v), t + 0.004);
      const B = 0.00012 * (1 + 4 * reg * reg);
      const parts = [[1, 0.9], [2, 0.5], [3, 0.3], [4, 0.17], [5, 0.09], [6, 0.05]];
      for (const [k, g] of parts) {
        const fk = f * k * Math.sqrt(1 + B * k * k);
        if (fk > 14000) continue;
        osc('sine', fk, g * (k > 2 ? (0.4 + 0.6 * v) : 1), base / Math.pow(k, 0.7) * 0.55);
      }
      osc('sine', f * 1.0015, 0.5, base * 0.5, 0); // second string, slightly out of tune
      // hammer noise
      const ns = c.createBufferSource(); ns.buffer = noise;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = Math.min(6000, f * 3 + 800); bp.Q.value = 0.8;
      const ng = c.createGain(); ng.gain.setValueAtTime(0.16 * v * v, t); ng.gain.setTargetAtTime(0.0001, t, 0.012);
      ns.connect(bp); bp.connect(ng); ng.connect(out); ns.start(t); oscs.push(ns);
      end = t + 4 + base;
    }
    const stopAt = end;
    oscs.forEach((o) => { try { o.stop(stopAt); } catch (e) { /* already stopped */ } });
    return { rel, oscs, end: stopAt, t0: t, inst };
  }

  function releaseVoice(v, t, tau) {
    try {
      v.rel.gain.cancelScheduledValues(t);
      v.rel.gain.setTargetAtTime(0, t, tau);
      v.oscs.forEach((o) => { try { o.stop(t + tau * 9); } catch (e) { /* ignore */ } });
    } catch (e) { /* ignore */ }
  }
  const relTau = (inst) => ({ organ: 0.03, epiano: 0.12, harpsichord: 0.08, strings: 0.25, marimba: 0.06 }[inst || A.instrument] || 0.16);
  /** The sounding voices of one note: the main instrument, plus the layered one when set (a little quieter). */
  function voices(midi, vel, t, bus) {
    const out = [makeVoice(midi, vel, t, bus, A.instrument, 1)];
    if (A.layer && A.layer !== A.instrument) out.push(makeVoice(midi, vel, t, bus, A.layer, 0.7));
    return out;
  }
  const releaseAll = (vs, t, mul) => vs.forEach((v) => releaseVoice(v, t, relTau(v.inst) * (mul || 1)));

  /** The user's note (keyboard, MIDI or screen): sounds now, until noteOff. */
  A.noteOn = function (midi, vel) {
    if (!A.ensure()) return;
    const old = active.get(midi);
    if (old) old.forEach((o) => releaseVoice(o, A.now(), 0.03));
    sustained.delete(old);
    const t = A.now() + 0.001;
    if (active.size > 40) { const first = active.keys().next().value; active.get(first).forEach((o) => releaseVoice(o, t, 0.05)); active.delete(first); }
    const v = voices(midi, vel || 90, t, userBus);
    v.held = true;
    active.set(midi, v);
  };
  A.noteOff = function (midi) {
    const v = active.get(midi);
    if (!v) return;
    v.held = false;
    if (pedal) { sustained.add(v); return; }
    active.delete(midi);
    releaseAll(v, A.now());
  };
  A.setPedal = function (down) {
    pedal = !!down;
    if (!pedal) {
      for (const v of sustained) {
        releaseAll(v, A.now(), 1.4);
        for (const [m, vv] of active) if (vv === v) active.delete(m);
      }
      sustained.clear();
    }
  };
  A.releaseAllUser = function () {
    for (const [, v] of active) v.forEach((o) => releaseVoice(o, A.now(), 0.05));
    active.clear(); sustained.clear();
  };

  /** App-played note (accompaniment, listen mode): start at audio time `when`, release after `durSec`. */
  A.schedule = function (midi, vel, when, durSec) {
    if (!A.ctx || A.ctx.state !== 'running') return;
    const t = Math.max(A.now(), when);
    for (const v of voices(midi, vel || 80, t, accBus)) {
      releaseVoice(v, t + Math.max(0.05, durSec), relTau(v.inst));
      v.stopAt = t + Math.max(0.05, durSec) + 3;
      scheduled.add(v);
    }
    if (scheduled.size > 200) { const now = A.now(); for (const s of scheduled) if (s.stopAt < now) scheduled.delete(s); }
  };
  /** A short note when a note is added or moved in Correct notes. */
  A.preview = function (midi) { A.ensure(); if (A.ctx) A.schedule(midi, 70, A.now() + 0.01, 0.35); };
  A.cancelScheduled = function () {
    if (!A.ctx) return;
    const t = A.now();
    for (const v of scheduled) {
      try { v.rel.gain.cancelScheduledValues(t); v.rel.gain.setTargetAtTime(0, t, 0.012); v.oscs.forEach((o) => { try { o.stop(t + 0.12); } catch (e) { /* ignore */ } }); } catch (e) { /* ignore */ }
    }
    scheduled.clear();
  };
  A.click = function (accent, when) {
    if (!A.ctx || A.ctx.state !== 'running') return;
    const c = A.ctx, t = Math.max(c.currentTime, when);
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'square'; o.frequency.value = accent ? 1760 : 1175;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(accent ? 0.35 : 0.22, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    o.connect(g); g.connect(metroBus); o.start(t); o.stop(t + 0.06);
  };
})();
