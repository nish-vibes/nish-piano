#!/usr/bin/env node
/* Offline video export (Windows app path), tested in Chrome with a stand-in engine that renders the note list into a
 * WAV of short tones. Checks: the engine gets every note with times from the start of the video, the export finishes
 * faster than real time, the MP4 is well formed (ftyp, mdat, moov with an H.264 and an audio track), Chrome plays it
 * back at the right length and size, and the sound lines up with the notes (first tone at the first note's time).
 *
 * Usage: node tests/run_export_offline.js [path/to/app.html]
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const html = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist', 'nish_marksteady_piano_v2_0_0.html'));

const FAKE = () => {
  window.__render = { calls: [] };
  const wavFrom = (text) => {
    const rate = 48000; let last = 0; const notes = [];
    for (const l of text.split('\n')) { const p = l.split(' '); if (p[0] === 'n') { const t = +p[1], d = +p[2], m = +p[3]; notes.push([t, d, m]); last = Math.max(last, t + d); } }
    const frames = Math.ceil((last + 3) * rate), pcm = new Int16Array(frames * 2);
    for (const [t, d, m] of notes) {
      const f = 440 * Math.pow(2, (m - 69) / 12), a = Math.round(t * rate), b = Math.min(frames, Math.round((t + Math.min(d, 0.25)) * rate));
      for (let i = a; i < b; i++) { const v = Math.sin((2 * Math.PI * f * (i - a)) / rate) * 6000 * Math.exp(-(i - a) / rate * 8); pcm[2 * i] += v; pcm[2 * i + 1] += v; }
    }
    const buf = new ArrayBuffer(44 + pcm.byteLength), v = new DataView(buf), w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + pcm.byteLength, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, pcm.byteLength, true);
    new Int16Array(buf, 44).set(pcm);
    return new Uint8Array(buf);
  };
  window.wapiroDesktop = {
    platform: 'win32',
    nativeAudio: {
      available: async () => true, start: async () => true, stop: async () => true, send: () => {}, onEvent: () => {},
      render: async (text) => { window.__render.calls.push(text); await new Promise((r) => setTimeout(r, 30)); return { ok: true, wav: wavFrom(text), seconds: 0, ms: 30 }; },
    },
  };
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(FAKE);
  await page.goto('file://' + html);
  await page.waitForFunction(() => window.WapiroTest && window.Wapiro.exporter);
  await page.evaluate(async () => { await window.WapiroTest.reset(); window.Wapiro.storage.settings.hintDone = true; });
  let failures = 0;
  const check = (name, ok, detail) => { if (ok) console.log('pass  ' + name); else { failures++; console.log('FAIL  ' + name + (detail ? '\n        ' + detail : '')); } };

  const support = await page.evaluate(() => ({ off: window.Wapiro.exporter.offlineSupported(), venc: !!window.VideoEncoder, aenc: !!window.AudioEncoder }));
  check('offline export is available with WebCodecs and the engine', support.off, JSON.stringify(support));

  const info = await page.evaluate(() => {
    const E = window.Wapiro.engine, spd = E.opts.speed, s0 = E.qToSec(E.startQ());
    const first = E.song.notes.slice().sort((a, b) => a.q - b.q)[0];
    return { title: E.song.title, notes: E.song.notes.length, firstAt: (E.qToSec(first.q) - s0) / spd, length: (E.qToSec(E.get().endQ) - s0) / spd };
  });
  const t0 = Date.now();
  const res = await page.evaluate(async () => {
    const r = await window.Wapiro.exporter.start({ noDownload: true, keepBlob: true });
    const out = Object.assign({}, r); delete out.blob;
    if (r.blob) { const b = new Uint8Array(await r.blob.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); out.b64 = btoa(s); }
    return out;
  });
  const wall = (Date.now() - t0) / 1000;
  check('the export finishes and makes an MP4', res.ok && res.offline && res.b64, JSON.stringify(Object.assign({}, res, { b64: res.b64 ? res.b64.length : 0 })));
  if (!res.ok) { console.log(errors.join('\n')); await browser.close(); process.exit(1); }
  console.log(`      ${info.title}: ${info.notes} notes, ${res.length.toFixed(1)} s of video at ${res.width}x${res.height}, ${res.video} + ${res.audio}, made in ${wall.toFixed(1)} s`);
  check('it is made faster than playing the piece', wall < res.length, `${wall.toFixed(1)} s for ${res.length.toFixed(1)} s`);
  const calls = await page.evaluate(() => window.__render.calls);
  const noteLines = calls[0] ? calls[0].split('\n').filter((l) => l.startsWith('n ')) : [];
  check('the engine gets every note of the song', noteLines.length === info.notes, noteLines.length + ' of ' + info.notes);
  check('times are from the start of the video (the lead-in included)', noteLines.length && Math.abs(Math.min(...noteLines.map((l) => +l.split(' ')[1])) - info.firstAt) < 0.002);

  // MP4 structure
  const file = Buffer.from(res.b64, 'base64');
  const out = path.join('/tmp', 'nish_export_test.mp4'); fs.writeFileSync(out, file);
  const boxes = []; for (let o = 0; o < file.length;) { const sz = file.readUInt32BE(o), ty = file.toString('latin1', o + 4, o + 8); boxes.push(ty); if (sz < 8) break; o += sz; }
  check('the file is ftyp, mdat, moov', boxes.join(',') === 'ftyp,mdat,moov', boxes.join(','));
  const s = file.toString('latin1');
  check('with an H.264 track and an audio track', s.includes('avc1') && s.includes('avcC') && (s.includes('Opus') || s.includes('mp4a')) && (s.match(/trak/g) || []).length === 2);
  check('the video frames are all there', res.frames === Math.ceil((res.length) * 30) || Math.abs(res.frames - res.length * 30) <= 1, res.frames + ' frames');

  // play it back in Chrome
  const back = await page.evaluate(async (b64) => {
    const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([u], { type: 'video/mp4' }));
    const v = document.createElement('video'); v.muted = true; v.src = url;
    await new Promise((r, j) => { v.onloadedmetadata = r; v.onerror = () => j(new Error('video error ' + (v.error && v.error.code))); });
    v.currentTime = Math.min(10, v.duration / 2); await new Promise((r) => (v.onseeked = r));
    const c = document.createElement('canvas'); c.width = 64; c.height = 36; const g = c.getContext('2d'); g.drawImage(v, 0, 0, 64, 36);
    const px = g.getImageData(0, 0, 64, 36).data; let lum = 0; for (let i = 0; i < px.length; i += 4) lum += px[i] + px[i + 1] + px[i + 2];
    // the sound: decode and find the first tone
    const ac = new OfflineAudioContext(2, 48000, 48000);
    let first = null, adur = 0;
    try {
      const buf = await ac.decodeAudioData(u.buffer.slice(0));
      adur = buf.duration;
      const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > 0.02) { first = i / buf.sampleRate; break; }
    } catch (e) { first = 'decode failed: ' + e.message; }
    return { duration: v.duration, w: v.videoWidth, h: v.videoHeight, lum, first, adur };
  }, res.b64);
  console.log(`      played back: ${back.duration.toFixed(2)} s, ${back.w}x${back.h}, audio ${typeof back.adur === 'number' ? back.adur.toFixed(2) : back.adur} s, first tone at ${typeof back.first === 'number' ? back.first.toFixed(4) : back.first} s (first note ${info.firstAt.toFixed(4)} s)`);
  check('Chrome plays it back at the right length', Math.abs(back.duration - res.length) < 0.2, back.duration + ' vs ' + res.length);
  check('at the right size', back.w === res.width && back.h === res.height);
  check('the picture is not blank', back.lum > 64 * 36 * 30);
  check('the sound lines up with the notes (within 5 ms)', typeof back.first === 'number' && Math.abs(back.first - info.firstAt) < 0.005, String(back.first));
  check('the app is back to normal afterwards', await page.evaluate(() => !window.Wapiro.exporter.active && window.Wapiro.storage.viewOverride == null && window.Wapiro.waterfall.clock == null));
  check('no page errors', !errors.length, errors.join('\n'));
  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll offline export checks passed');
  process.exit(failures ? 1 : 0);
})();
