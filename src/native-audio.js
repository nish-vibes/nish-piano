/* The low-latency sound engine (Windows desktop app only).
   nish-audio.exe plays through an ASIO driver and reads the MIDI keyboards itself, so a key sounds within one
   audio buffer: it never waits for this page, Chromium or the Windows mixer. This module starts it, picks the
   driver and buffer, hands the keyboards over, turns its key reports into engine events (waterfall, scoring,
   recording), and falls back to Web Audio if anything goes wrong.
   SPDX-License-Identifier: GPL-3.0-or-later */
(function () {
  'use strict';
  const W = window.Wapiro, A = W.audio, E = W.engine, S = W.storage;
  const D = window.wapiroDesktop && window.wapiroDesktop.nativeAudio;
  const NA = (W.naudio = { supported: !!D, state: 'off', devices: [], info: null, error: null, xruns: 0, midi: [], fx: null });
  const listeners = [];
  NA.onChange = (fn) => { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; };
  const changed = () => listeners.forEach((f) => { try { f(); } catch (e) { /* a closed menu */ } });
  NA.FRAMES = [[0, 'Smallest the driver allows'], [16, '16 samples'], [32, '32 samples'], [64, '64 samples'], [128, '128 samples'], [256, '256 samples']];

  let started = false, bound = false, waitDevices = null;
  const send = (line) => D.send(line);

  function onEvent(m) {
    switch (m.ev) {
      case 'devices':
        NA.devices = m.devices || [];
        if (waitDevices) { const f = waitDevices; waitDevices = null; f(NA.devices); }
        changed(); break;
      case 'opened':
        NA.info = m; NA.state = 'on'; NA.error = null; NA.xruns = 0;
        A.useNative(send, m);
        A.native.midi = true;
        send('midi on');
        changed(); break;
      case 'midi':
        NA.midi = m.devices || [];
        W.input.setExternalDevices(NA.midi);
        changed(); break;
      case 'note': {
        const t = performance.now() - (+m.ago || 0);
        if (m.down) E.noteOn(m.midi, m.vel, true, t); else E.noteOff(m.midi, t, true);
        break;
      }
      case 'pedal': E.pedal(!!m.down, performance.now() - (+m.ago || 0), true); break;
      case 'xrun': NA.xruns = m.count | 0; changed(); break;
      case 'error':
        NA.error = m.message || 'The low-latency engine reported a problem.';
        if (m.where === 'open' || m.where === 'start') { NA.state = 'error'; toWebAudio(); }
        changed(); break;
      case 'exit':
        started = false;
        if (NA.state === 'on' || NA.state === 'starting') { NA.state = 'error'; NA.error = NA.error || 'The low-latency engine stopped. Sound is back on the standard engine.'; toWebAudio(); changed(); }
        break;
    }
  }
  /** Sound back on Web Audio, MIDI back on Web MIDI. */
  function toWebAudio() {
    A.useNative(null); A.native.midi = false;
    if (started) { send('midi off'); send('close'); }
    W.input.useExternal(false);
  }

  async function ensureStarted() {
    if (!bound) { D.onEvent(onEvent); bound = true; }
    if (started) return true;
    started = await D.start();
    return started;
  }
  const listDevices = () => new Promise((resolve) => { waitDevices = resolve; send('list'); setTimeout(() => { if (waitDevices === resolve) { waitDevices = null; resolve(NA.devices); } }, 8000); });

  /** Open the chosen ASIO driver (by name) with the chosen buffer; the first driver if none was chosen. */
  async function open() {
    const st = S.settings;
    NA.state = 'starting'; NA.error = null; changed();
    if (!(await ensureStarted())) { NA.state = 'error'; NA.error = 'The low-latency engine is missing from this installation. Reinstall NiSH MarkSteady Piano.'; toWebAudio(); changed(); return; }
    const devs = NA.devices.length ? NA.devices : await listDevices();
    if (!devs.length) {
      NA.state = 'error';
      NA.error = 'No ASIO driver found. Install the ASIO driver of your audio interface, or a general one such as ASIO4ALL or FlexASIO, then choose Find drivers again.';
      toWebAudio(); changed(); return;
    }
    const dev = devs.find((d) => d.name === st.asioDevice) || devs[0];
    st.asioDevice = dev.name; S.saveSettings();
    W.input.useExternal(true);
    send('open ' + dev.id + ' ' + (st.asioRate | 0) + ' ' + (st.asioFrames | 0));
  }

  /** Called once at start-up, before MIDI starts: with ASIO chosen, Web MIDI is never opened. */
  NA.boot = function () {
    if (!NA.supported || S.settings.audioEngine !== 'asio') return;
    W.input.external = true;
    open();
  };
  NA.enable = function () {
    if (!NA.supported) return;
    S.settings.audioEngine = 'asio'; S.saveSettings();
    if (E.playing) E.pause();
    open();
  };
  NA.disable = function () {
    S.settings.audioEngine = 'web'; S.saveSettings();
    if (E.playing) E.pause();
    NA.state = 'off'; NA.info = null; NA.error = null;
    toWebAudio();
    D.stop(); started = false;
    changed();
  };
  NA.refresh = async function () { NA.devices = []; if (await ensureStarted()) await listDevices(); changed(); };
  NA.setDevice = function (name) { S.settings.asioDevice = name; S.saveSettings(); if (NA.state !== 'off') open(); };
  NA.setFrames = function (n) { S.settings.asioFrames = n | 0; S.saveSettings(); if (NA.state !== 'off') open(); };
  NA.panel = function () { if (started) send('panel'); };
  /** A keyboard another program (or this page's Web MIDI, before the switch) still holds. */
  NA.midiBusy = () => NA.state === 'on' && NA.midi.some((d) => !d.ok);
  NA.relaunch = () => window.wapiroDesktop && window.wapiroDesktop.relaunch && window.wapiroDesktop.relaunch();
  /** Plain-words summary of the delay. */
  NA.summary = function () {
    if (NA.state === 'starting') return 'Starting the low-latency engine…';
    if (NA.state === 'error') return NA.error;
    if (NA.state !== 'on' || !NA.info) return 'Plays through your audio interface’s ASIO driver, for the shortest delay between key and sound.';
    const i = NA.info, k = (i.rate / 1000).toFixed(i.rate % 1000 ? 1 : 0);
    return 'Key to sound: ' + i.outputMs.toFixed(1) + ' ms output (' + i.frames + ' samples at ' + k + ' kHz), plus about 1 ms for USB MIDI.';
  };

  // ---------------------------------------------------------------- Windows audio effects
  const FX = window.wapiroDesktop && window.wapiroDesktop.audioEffects;
  NA.fxSupported = !!FX;
  NA.fxStatus = async function () { if (!FX) return null; try { NA.fx = await FX.status(); } catch (e) { NA.fx = { error: 'Could not read the Windows sound settings.' }; } changed(); return NA.fx; };
  NA.fxSet = async function (off) {
    if (!FX) return null;
    const r = await FX.set(off);
    await NA.fxStatus();
    // the Windows audio service restarts: the standard engine needs a fresh output
    if (r && r.ok && !A.native.on && A.rebuild) setTimeout(() => A.rebuild(), 1500);
    return r;
  };
  NA.fxOpenSettings = () => FX && FX.openSettings();
})();
