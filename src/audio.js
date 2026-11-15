/* Web Audio synth: piano (modest additive model with hammer noise), electric piano, organ, harpsichord, strings. Also the metronome click. */
(function () {
  'use strict';
  const W = window.Wapiro;
  const A = (W.audio = { available: !!(window.AudioContext || window.webkitAudioContext), instrument: 'piano', volume: 0.7, accVolume: 0.7, metroVolume: 0.7, mute: false, ctx: null });
  let master, userBus, accBus, metroBus, comp, noise;
  const active = new Map();   // midi -> voice (user notes)
  const sustained = new Set();
  const scheduled = new Set(); // accompaniment voices
  let pedal = false;

  A.ensure = function () {
    if (!A.available) return false;
    if (!A.ctx) {
      try {
        const C = window.AudioContext || window.webkitAudioContext;
        A.ctx = new C({ latencyHint: 'interactive' });
      } catch (e) { A.available = false; return false; }
      const c = A.ctx;
      master = c.createGain(); userBus = c.createGain(); accBus = c.createGain(); metroBus = c.createGain(); metroBus.connect(c.destination);
      comp = c.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 20; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
      userBus.connect(master); accBus.connect(master); master.connect(comp); comp.connect(c.destination);
      const len = Math.floor(c.sampleRate * 0.05);
      noise = c.createBuffer(1, len, c.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      A.applyVolumes();
    }
    if (A.ctx.state === 'suspended') A.ctx.resume().catch(() => {});
    return true;
  };
  A.applyVolumes = function () {
    if (!A.ctx) return;
    const t = A.ctx.currentTime;
    master.gain.setTargetAtTime(A.mute ? 0 : A.volume * 0.6, t, 0.01);
    accBus.gain.setTargetAtTime(A.accVolume, t, 0.01);
    metroBus.gain.setTargetAtTime(A.mute ? 0 : A.metroVolume, t, 0.01);
  };
  A.now = () => (A.ctx ? A.ctx.currentTime : 0);

  function freq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  /** Build a voice that starts at time t. Returns { rel, oscs, end } where rel is the release gate. */
  function makeVoice(midi, vel, t, bus) {
    const c = A.ctx, f = freq(midi);
    const v = Math.max(0.12, Math.min(1, vel / 127));
    const rel = c.createGain(); rel.gain.value = 1;
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
    const inst = A.instrument;
    if (inst === 'epiano') {
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
    return { rel, oscs, end: stopAt, t0: t };
  }

  function releaseVoice(v, t, tau) {
    try {
      v.rel.gain.cancelScheduledValues(t);
      v.rel.gain.setTargetAtTime(0, t, tau);
      v.oscs.forEach((o) => { try { o.stop(t + tau * 9); } catch (e) { /* ignore */ } });
    } catch (e) { /* ignore */ }
  }
  const relTau = () => ({ organ: 0.03, epiano: 0.12, harpsichord: 0.08, strings: 0.25 }[A.instrument] || 0.16);

  /** The user's note (keyboard, MIDI or screen): sounds now, until noteOff. */
  A.noteOn = function (midi, vel) {
    if (!A.ensure()) return;
    const old = active.get(midi);
    if (old) releaseVoice(old, A.now(), 0.03);
    sustained.delete(old);
    const t = A.now() + 0.001;
    if (active.size > 40) { const first = active.keys().next().value; releaseVoice(active.get(first), t, 0.05); active.delete(first); }
    const v = makeVoice(midi, vel || 90, t, userBus);
    v.held = true;
    active.set(midi, v);
  };
  A.noteOff = function (midi) {
    const v = active.get(midi);
    if (!v) return;
    v.held = false;
    if (pedal) { sustained.add(v); return; }
    active.delete(midi);
    releaseVoice(v, A.now(), relTau());
  };
  A.setPedal = function (down) {
    pedal = !!down;
    if (!pedal) {
      for (const v of sustained) {
        releaseVoice(v, A.now(), relTau() * 1.4);
        for (const [m, vv] of active) if (vv === v) active.delete(m);
      }
      sustained.clear();
    }
  };
  A.releaseAllUser = function () {
    for (const [, v] of active) releaseVoice(v, A.now(), 0.05);
    active.clear(); sustained.clear();
  };

  /** App-played note (accompaniment, listen mode): start at audio time `when`, release after `durSec`. */
  A.schedule = function (midi, vel, when, durSec) {
    if (!A.ctx || A.ctx.state !== 'running') return;
    const t = Math.max(A.now(), when);
    const v = makeVoice(midi, vel || 80, t, accBus);
    releaseVoice(v, t + Math.max(0.05, durSec), relTau());
    v.stopAt = t + Math.max(0.05, durSec) + 3;
    scheduled.add(v);
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
