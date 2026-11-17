/* Freeplay, recording and video export.
   Freeplay: the open song is hidden and silent, the waterfall alone shows what the player plays. Leaving it brings the song back.
   Record: in Freeplay, keeps what is played and saves it to the library as a song.
   Export video: plays the open song once and saves the waterfall, the keys and the sound as a video file. */
(function () {
  'use strict';
  const W = window.Wapiro, E = W.engine, S = W.storage, A = W.audio, WF = W.waterfall, G = W.geom, U = W.util, UI = W.ui;
  const F = (W.free = { active: false, recording: false });
  const fire = () => { for (const fn of F.listeners) fn(); };
  F.listeners = [];
  F.onChange = (fn) => F.listeners.push(fn);

  // ---------------------------------------------------------------- freeplay
  F.enter = function () {
    if (F.active || (W.exporter && W.exporter.active)) return;
    if (W.editor && W.editor.active) W.editor.stop();
    if (E.playing) E.pause();
    F.active = true; WF.free = true; WF.clearFx();
    S.viewOverride = 'waterfall';
    W.shell.applyView();
    if (wantMetro()) metro.start();
    fire();
  };
  F.leave = function () {
    if (!F.active) return;
    if (F.recording) F.stopRecording();
    F.active = false; WF.free = false; WF.clearFx(); metro.stop(); metro.forced = 0;
    S.viewOverride = null;
    W.shell.applyView();
    fire();
  };
  F.toggle = () => (F.active ? F.leave() : F.enter());

  // ---------------------------------------------------------------- tempo and metronome (no song needed)
  // A small look-ahead scheduler on the audio clock. Downbeats are also kept on the performance.now() clock, so the
  // waterfall can draw bar lines and a recording can start exactly on a bar.
  F.bpm = () => Math.max(30, Math.min(240, Math.round(S.settings.freeBpm || 120)));
  F.setBpm = (v) => { S.settings.freeBpm = Math.max(30, Math.min(240, Math.round(v))); S.saveSettings(); metro.restart(); fire(); };
  F.countIn = () => S.settings.freeCountIn !== false;
  F.setCountIn = (v) => { S.settings.freeCountIn = !!v; S.saveSettings(); fire(); };
  const metro = { timer: null, next: 0, beat: 0, forced: 0, downbeats: [] };
  F.downbeats = () => metro.downbeats;
  F.metroRunning = () => !!metro.timer;
  const wantMetro = () => F.active && (E.opts.metronome || metro.forced > 0);
  metro.start = function () {
    if (metro.timer || !W.audio.ensure()) return;
    metro.next = W.audio.now() + 0.08; metro.beat = 0; metro.downbeats = [];
    metro.timer = setInterval(metro.tick, 25); metro.tick();
  };
  metro.stop = function () { clearInterval(metro.timer); metro.timer = null; metro.downbeats = []; WF.dirty = true; };
  metro.restart = function () { if (metro.timer) { metro.stop(); metro.start(); } };
  metro.tick = function () {
    if (!wantMetro()) { metro.stop(); return; }
    const A = W.audio, spb = 60 / F.bpm();
    while (metro.next < A.now() + 0.12) {
      const accent = metro.beat % 4 === 0;
      A.click(accent, metro.next);
      if (accent) { metro.downbeats.push(performance.now() + (metro.next - A.now()) * 1000); if (metro.downbeats.length > 24) metro.downbeats.shift(); }
      if (metro.forced > 0) metro.forced--;
      metro.next += spb; metro.beat++;
    }
    WF.dirty = true;
  };
  E.on('change', () => { if (wantMetro()) metro.start(); else if (metro.timer) metro.stop(); });

  // ---------------------------------------------------------------- recording
  let rec = null;
  F.elapsed = () => (rec && rec.t0 != null ? (performance.now() - rec.t0) / 1000 : 0);
  F.inCountIn = () => !!(rec && rec.fixed && performance.now() < rec.t0);
  F.startRecording = function () {
    if (F.recording) return;
    F.enter();
    if (!F.active) return;
    rec = { t0: null, notes: [], open: new Map(), pedal: [], bpm: F.bpm() };
    // with a count-in: one bar of clicks, and the take starts on the next downbeat; with the metronome on: on the
    // last downbeat; otherwise on the first note
    if (F.countIn()) {
      metro.stop(); metro.forced = 4; metro.start();
      const first = metro.downbeats[0] || performance.now() + 80;
      rec.t0 = first + 4 * 60000 / rec.bpm; rec.fixed = true;
    } else if (E.opts.metronome && metro.downbeats.length) {
      const now = performance.now(), past = metro.downbeats.filter((t) => t <= now);
      rec.t0 = past.length ? past[past.length - 1] : metro.downbeats[0]; rec.fixed = true;
    }
    F.recording = true;
    fire();
  };
  // exact times (the MIDI event's own timestamp), how hard each key was struck, and the sustain pedal
  E.on('key', (e) => {
    if (!F.recording) return;
    const t = e.t || performance.now();
    if (e.down) { if (rec.t0 == null) rec.t0 = t; if (rec.fixed && t < rec.t0 - 150) return; rec.open.set(e.midi, { t, vel: e.vel || 90 }); }
    else if (rec.open.has(e.midi)) { const o = rec.open.get(e.midi); rec.notes.push({ midi: e.midi, on: o.t, off: t, vel: o.vel }); rec.open.delete(e.midi); }
  });
  E.on('pedal', (e) => { if (F.recording && rec.t0 != null) rec.pedal.push({ t: e.t, down: e.down }); });
  /** Turn the recorded key presses into a song: 120 beats a minute, times kept to a 1/32 note, hands split at middle C. */
  F.buildSong = function (notes, t0, title, bpm) {
    const BPM = bpm || 120, grid = 0.125, toQ = (ms) => Math.round(((ms - t0) / 1000) * (BPM / 60) / grid) * grid;
    const out = notes.map((n) => { const q = Math.max(0, toQ(n.on)); return { q: U.round6(q), durQ: U.round6(Math.max(grid, toQ(n.off) - q)), midi: n.midi, hand: WF.handOf(n.midi), vel: n.vel || 90 }; });
    const fifths = U.estimateKey(out);
    for (const n of out) { const sp = U.spellInKey(n.midi, fifths); n.spelled = U.spell(sp.letter, sp.alter, sp.oct); }
    U.sortNotes(out);
    const timeSigs = [{ q: 0, num: 4, den: 4 }];
    const endQ = Math.max(...out.map((n) => n.q + n.durQ));
    return W.core.finish({ id: '', title, composer: '', source: 'recording', exactNotation: false, handsGuessed: false, handsFrom: 'split',
      tempos: [{ q: 0, bpm: BPM }], timeSigs, keySigs: [], measures: W.midi.buildMeasures(timeSigs, endQ), notes: out, notation: null, warnings: [], estKey: fifths });
  };
  F.stopRecording = async function () {
    if (!F.recording) return null;
    const t = performance.now(), r = rec;
    for (const [midi, o] of r.open) r.notes.push({ midi, on: o.t, off: t, vel: o.vel });
    F.recording = false; rec = null;
    if (!r.notes.length) { fire(); UI.toast('Nothing was recorded. Press Record and play some notes.'); return null; }
    const d = new Date(), p2 = (x) => String(x).padStart(2, '0');
    const title = 'Recording ' + d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + '.' + p2(d.getMinutes());
    let song;
    try { song = F.buildSong(r.notes, r.t0, title, r.bpm); } catch (e) { fire(); UI.toast('Could not save the recording: ' + e.message, 'error'); return null; }
    song.pedal = r.pedal.map((p) => ({ sec: Math.max(0, (p.t - r.t0) / 1000), down: p.down }));
    const row = await S.add(song);
    // keep playing: stopping a take no longer leaves Freeplay
    fire();
    UI.toast('Saved "' + title + '". Open it from your library to practise it or export a video.');
    return row.id;
  };
  F.toggleRecording = () => (F.recording ? F.stopRecording() : F.startRecording());

  // ---------------------------------------------------------------- video export
  const X = (W.exporter = { active: false });
  const TYPES = [['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'mp4'], ['video/mp4;codecs=avc1,mp4a.40.2', 'mp4'], ['video/mp4;codecs=avc1,opus', 'mp4'], ['video/mp4', 'mp4'], ['video/webm;codecs=vp9,opus', 'webm'], ['video/webm', 'webm']];
  X.pickType = function () {
    if (!window.MediaRecorder) return null;
    for (const [t, ext] of TYPES) if (MediaRecorder.isTypeSupported(t)) return { type: t, ext };
    return null;
  };
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);
  const WHITE = [0, 2, 4, 5, 7, 9, 11], isBlack = (m) => !WHITE.includes(m % 12);
  let job = null;

  /** Draw one video frame: the waterfall as it is on screen, and the keys below it with the sounding notes lit in their hand's colour. */
  X.frame = function (q) {
    if (!job) return;
    const c = job.ctx, out = job.canvas, k = out.width / WF.w, wfH = Math.round(WF.h * k), kh = out.height - wfH;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(WF.canvas, 0, 0, out.width, wfH);
    // which keys sound now
    const { n, nq, nd, nm, nh } = E.get(), lit = new Map();
    let lo = 0, hi = n; const target = q - E.songMax.maxDur - 1e-6;
    while (lo < hi) { const m = (lo + hi) >> 1; if (nq[m] < target) lo = m + 1; else hi = m; }
    for (let i = lo; i < n && nq[i] <= q + 1e-3; i++) if (nq[i] + nd[i] * 0.92 > q) lit.set(nm[i], nh[i] ? job.col.L : job.col.R);
    c.save(); c.translate(0, wfH); c.scale(k, k); c.translate(-Math.round(G.scrollX || 0), 0);
    const H = kh / k, col = job.col;
    c.fillStyle = col.edge; c.fillRect(G.scrollX || 0, 0, WF.w, H);
    c.font = '11px ' + col.font; c.textAlign = 'center'; c.textBaseline = 'bottom';
    for (let m = G.lo; m <= G.hi; m++) if (!isBlack(m)) {
      const r = G.keyRect(m);
      c.fillStyle = lit.get(m) || col.white; c.beginPath(); c.roundRect(r.x + 0.5, 0, r.w - 1, H - 1, [0, 0, 4, 4]); c.fill();
      if (m % 12 === 0) { c.fillStyle = col.label; c.fillText('C' + (Math.floor(m / 12) - 1), r.x + r.w / 2, H - 5); }
    }
    for (let m = G.lo; m <= G.hi; m++) if (isBlack(m)) {
      const r = G.keyRect(m);
      c.fillStyle = col.blackEdge; c.beginPath(); c.roundRect(r.x - 0.5, 0, r.w + 1, H * 0.62 + 0.5, [0, 0, 3, 3]); c.fill();
      c.fillStyle = lit.get(m) || col.black; c.beginPath(); c.roundRect(r.x + 0.5, 0, r.w - 1, H * 0.62 - 0.5, [0, 0, 3, 3]); c.fill();
    }
    c.restore();
    c.fillStyle = col.primary; c.fillRect(0, wfH - Math.max(2, Math.round(2 * k)), out.width, Math.max(2, Math.round(2 * k)));
    // the title, for the first seconds
    const age = (performance.now() - job.t0) / 1000;
    if (age < 5) {
      c.globalAlpha = Math.min(1, age / 0.4, (5 - age) / 0.8);
      const fs = Math.round(out.width / 46);
      c.font = '600 ' + fs + 'px ' + col.font; c.textAlign = 'left'; c.textBaseline = 'top'; c.fillStyle = col.fg;
      c.fillText(E.song.title, fs, fs);
      if (E.song.composer) { c.font = '400 ' + Math.round(fs * 0.7) + 'px ' + col.font; c.fillStyle = col.label2; c.fillText(E.song.composer, fs, fs * 2.4); }
      c.globalAlpha = 1;
    }
    job.frames++;
  };

  /** Export the open song as a video. Resolves with { ok, type, size, seconds } once the file is saved (or the reason it was not). */
  X.start = function (opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      if (X.active) { resolve({ ok: false, error: 'An export is already running.' }); return; }
      const fail = (msg) => { UI.toast(msg, 'error'); resolve({ ok: false, error: msg }); };
      if (!E.song) return fail('Open a song first.');
      const pick = X.pickType();
      if (!pick) return fail('This browser cannot record video. Use the Windows app, or a current Chrome or Edge.');
      if (F.active) F.leave();
      if (W.editor && W.editor.active) W.editor.stop();
      if (E.playing) E.pause();
      UI.closePopover(false);
      const before = { loop: E.opts.loop, playAlong: E.opts.playAlong, metronome: E.opts.metronome };
      S.viewOverride = 'waterfall'; W.shell.applyView();
      X.active = true;
      const begin = () => {
        const kH = S.settings.keysH || 120, k = Math.min(1920 / WF.w, Math.max(1, WF.canvas.width / WF.w));
        const canvas = document.createElement('canvas'); canvas.width = even(WF.w * k); canvas.height = even((WF.h + kH) * (canvas.width / WF.w));
        const fontVar = cssVar('--font-sans') || 'sans-serif';
        job = { canvas, ctx: canvas.getContext('2d'), frames: 0, t0: performance.now(), chunks: [], cancelled: false, done: false,
          col: { white: cssVar('--neutral-50'), edge: cssVar('--neutral-400'), black: cssVar('--neutral-900'), blackEdge: cssVar('--neutral-950'), R: cssVar('--hand-right'), L: cssVar('--hand-left'), primary: cssVar('--primary'), label: cssVar('--neutral-500') || '#777', label2: cssVar('--muted-foreground'), fg: cssVar('--foreground'), font: fontVar } };
        let stream;
        try {
          stream = canvas.captureStream(30);
          const audio = A.tap && A.tap();
          if (audio) for (const t of audio.getAudioTracks()) stream.addTrack(t);
          job.rec = new MediaRecorder(stream, { mimeType: pick.type, videoBitsPerSecond: opts.bitrate || 8000000, audioBitsPerSecond: 160000 });
        } catch (e) { cleanup(); return fail('Could not start the video recorder: ' + e.message); }
        job.rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) job.chunks.push(ev.data); };
        job.rec.onerror = (ev) => { job.error = (ev.error && ev.error.message) || 'recorder error'; };
        job.rec.onstop = () => {
          const j = job, seconds = (performance.now() - j.t0) / 1000;
          cleanup();
          if (j.cancelled) { UI.toast('Video export cancelled.'); resolve({ ok: false, cancelled: true }); return; }
          const blob = new Blob(j.chunks, { type: pick.type.split(';')[0] });
          if (j.error || !blob.size) return fail('The video could not be made' + (j.error ? ': ' + j.error : '.'));
          const name = E.song.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() + '.' + pick.ext;
          if (!opts.noDownload) {
            const url = URL.createObjectURL(blob), a = UI.h('a', { href: url, download: name });
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            UI.toast('Saved "' + name + '".');
          }
          resolve({ ok: true, type: pick.type, name, size: blob.size, seconds, frames: j.frames, width: j.canvas.width, height: j.canvas.height, blob: opts.keepBlob ? blob : undefined });
        };
        E.setOptions({ loop: null, playAlong: true, metronome: false });
        E.seekQ(E.startQ());
        X.frame(E.q);
        job.rec.start(1000);
        bar.show();
        E.listen();
        if (opts.maxSeconds) setTimeout(() => X.finish(), opts.maxSeconds * 1000);
      };
      const cleanup = () => {
        bar.hide();
        job = null; X.active = false;
        if (E.playing) E.pause();
        E.setOptions(before);
        S.viewOverride = null; W.shell.applyView();
        E.seekQ(E.startQ());
      };
      // two frames, so the waterfall has its export size before the first video frame
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(begin, 60)));
    });
  };
  /** Stop now and keep what has been recorded so far. */
  X.finish = function () { if (job && !job.done) { job.done = true; if (E.playing) E.pause(); try { job.rec.stop(); } catch (e) { /* already stopped */ } } };
  X.cancel = function () { if (job && !job.done) { job.cancelled = true; X.finish(); } };
  E.on('finish', () => { if (job && !job.done) setTimeout(X.finish, 900); }); // let the last notes ring
  E.on('change', () => { if (job && !job.done && job.frames > 2 && !E.playing && !E.finishedFlag) X.finish(); }); // paused by hand: keep the part so far

  // progress bar shown while exporting
  const fmt = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  const bar = {
    el: null, timer: null,
    show() {
      const h = UI.h, txt = h('span', { class: 'xbar-text', role: 'status' });
      const total = (E.qToSec(E.get().endQ) - E.qToSec(E.startQ())) / E.opts.speed;
      bar.el = h('div', { class: 'export-bar', role: 'group', 'aria-label': 'Video export' }, h('span', { class: 'xbar-dot', 'aria-hidden': 'true' }), txt,
        h('span', { class: 'xbar-note', text: 'Keep this window open and visible.' }), h('span', { class: 'grow' }),
        h('button', { class: 'ds-btn ds-btn--outline', type: 'button', onclick: () => X.finish() }, 'Stop and save'),
        h('button', { class: 'ds-btn ds-btn--ghost', type: 'button', onclick: () => X.cancel() }, 'Cancel'));
      const tick = () => { if (job) txt.textContent = 'Exporting video  ' + fmt((performance.now() - job.t0) / 1000) + ' / ' + fmt(total); };
      tick(); bar.timer = setInterval(tick, 500);
      document.getElementById('app').appendChild(bar.el);
    },
    hide() { clearInterval(bar.timer); if (bar.el) bar.el.remove(); bar.el = null; },
  };
})();
