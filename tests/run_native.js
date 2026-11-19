#!/usr/bin/env node
/* The app side of the ASIO engine, tested in Chrome with a stand-in engine that answers like nish-audio.exe.
 * Checks: switching on, driver and buffer choice, MIDI hand-over (keys from the engine reach the waterfall and
 * scoring but are not played twice), app notes and play-along go to the engine with the right delays,
 * metronome clicks, falling back when the engine stops, and the Windows audio effects button.
 *
 * Usage: node tests/run_native.js [path/to/app.html]
 */
const path = require('path');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const html = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist', 'nish_marksteady_piano_v2_0_0.html'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FAKE = () => {
  const sent = [], handlers = [];
  const fire = (m) => setTimeout(() => handlers.forEach((f) => f(m)), 5);
  window.__engine = { sent, fire, fx: { off: false, changed: false, setCalls: [] }, starts: 0 };
  window.wapiroDesktop = {
    platform: 'win32',
    nativeAudio: {
      available: async () => true,
      start: async () => { window.__engine.starts++; fire({ ev: 'ready', version: 1 }); return true; },
      stop: async () => true,
      send: (line) => {
        sent.push(line);
        const [c, ...a] = line.split(' ');
        if (c === 'list') fire({ ev: 'devices', api: 'asio', devices: [{ id: 0, name: 'Focusrite USB ASIO', outputs: 2, rate: 48000, rates: [44100, 48000] }, { id: 1, name: 'ASIO4ALL v2', outputs: 2, rate: 44100, rates: [44100] }] });
        if (c === 'open') { const frames = +a[2] || 32; fire({ ev: 'opened', id: +a[0], name: +a[0] ? 'ASIO4ALL v2' : 'Focusrite USB ASIO', rate: 48000, frames, bufferMs: frames / 48, outputMs: frames / 48 + 1.1 }); }
        if (c === 'midi' && a[0] === 'on') fire({ ev: 'midi', devices: [{ name: 'Digital Piano', ok: true }] });
      },
      onEvent: (fn) => handlers.push(fn),
    },
    audioEffects: {
      status: async () => ({ supported: true, devices: [{ id: 'a', name: 'Speakers - Realtek', off: window.__engine.fx.off }, { id: 'b', name: 'Headphones - USB', off: window.__engine.fx.off }], changedByApp: window.__engine.fx.changed }),
      set: async (off) => { window.__engine.fx.setCalls.push(off); window.__engine.fx.off = off; window.__engine.fx.changed = off; return { ok: true, changed: 2, failed: 0 }; },
      openSettings: async () => true,
    },
    relaunch: async () => true,
  };
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(FAKE);
  await page.goto('file://' + html);
  await page.waitForFunction(() => window.WapiroTest && window.Wapiro && window.Wapiro.naudio, null, { timeout: 8000 });
  let failures = 0;
  const check = (name, ok, detail) => { if (ok) console.log('pass  ' + name); else { failures++; console.log('FAIL  ' + name + (detail ? '\n        ' + detail : '')); } };
  const sent = () => page.evaluate(() => window.__engine.sent.slice());
  const clearSent = () => page.evaluate(() => { window.__engine.sent.length = 0; });
  const T = (name, ...args) => page.evaluate(async ([n, a]) => await window.WapiroTest[n](...a), [name, args]);
  await T('reset');

  // ---- switch the engine on from the Sound menu
  await page.click('[aria-label="Sound and devices"]');
  await page.waitForSelector('.asio-switch');
  check('Sound menu shows the ASIO engine switch', await page.isVisible('.asio-switch'));
  await page.click('.asio-switch');
  await page.waitForFunction(() => window.Wapiro.naudio.state === 'on', null, { timeout: 3000 }).catch(() => {});
  let s = await sent();
  check('turning it on lists drivers and opens the first one at the smallest buffer', s.includes('list') && s.includes('open 0 0 0'), s.join(' | '));
  check('the engine takes over the MIDI keyboard', s.includes('midi on'));
  check('instrument and volumes are sent to the engine', s.some((l) => l.startsWith('inst piano')) && s.some((l) => l.startsWith('gain ')));
  const cap = await page.textContent('.asio-switch .ds-caption');
  check('the menu shows the measured delay in plain words', /Key to sound: \d+\.\d ms output \(32 samples at 48 kHz\)/.test(cap), cap);
  check('the keyboard reported by the engine is listed as connected', /Digital Piano connected/.test(await page.textContent('.dev-list')));
  check('the standard "Low latency" switch hides while ASIO is on', await page.evaluate(() => document.querySelector('.pop-sound .low-lat').hidden));

  // ---- driver and buffer choice
  await clearSent();
  await page.selectOption('[aria-label="Buffer size"]', '64');
  await sleep(100);
  s = await sent();
  check('choosing a buffer reopens the driver with it', s.includes('open 0 0 64'), s.join(' | '));
  await page.selectOption('[aria-label="ASIO driver"]', 'ASIO4ALL v2');
  await sleep(100);
  s = await sent();
  check('choosing another driver opens that one', s.includes('open 1 0 64'), s.join(' | '));
  check('the choice is remembered', await page.evaluate(() => window.Wapiro.storage.settings.asioDevice === 'ASIO4ALL v2' && window.Wapiro.storage.settings.asioFrames === 64));
  await page.keyboard.press('Escape');

  // ---- keys from the MIDI keyboard (played inside the engine) reach the app once, and are not played again
  await clearSent();
  const keys = await page.evaluate(async () => {
    const got = []; const off = window.Wapiro.engine.on('key', (e) => got.push(e));
    window.__engine.fire({ ev: 'note', midi: 64, vel: 100, down: 1, ago: 0.6 });
    window.__engine.fire({ ev: 'pedal', down: 1, ago: 0.2 });
    window.__engine.fire({ ev: 'note', midi: 64, vel: 0, down: 0, ago: 0.3 });
    await new Promise((r) => setTimeout(r, 60));
    if (typeof off === 'function') off();
    return got.map((k) => ({ midi: k.midi, down: k.down, t: k.t }));
  });
  s = await sent();
  check('a key from the engine reaches the waterfall and scoring (down and up)', keys.length >= 2 && keys[0].midi === 64 && keys[0].down && !keys[1].down, JSON.stringify(keys));
  check('it is not sent back to be played a second time', !s.some((l) => /^(on|off|pedal) /.test(l)), s.join(' | '));

  // ---- notes from the computer keyboard or screen go to the engine
  await clearSent();
  await page.evaluate(() => { window.Wapiro.engine.noteOn(60, 90); window.Wapiro.engine.noteOff(60); });
  s = await sent();
  check('a note from the app is played by the engine', s.includes('on 60 90') && s.includes('off 60'), s.join(' | '));

  // ---- play-along and metronome are scheduled in the engine, ahead of time
  await clearSent();
  await page.evaluate(() => { window.Wapiro.engine.setOptions({ playAlong: true, metronome: true, wait: false, hands: 'R', countIn: false }); window.Wapiro.engine.listen ? window.Wapiro.engine.listen() : window.Wapiro.engine.play(); });
  await sleep(7000);
  await page.evaluate(() => window.Wapiro.engine.pause());
  s = await sent();
  const plays = s.filter((l) => l.startsWith('play ')), clicks = s.filter((l) => l.startsWith('click '));
  const delays = plays.map((l) => +l.split(' ')[3]);
  check('play-along notes go to the engine', plays.length > 0, s.slice(0, 12).join(' | '));
  check('each is scheduled ahead with a delay in ms (0 to 250)', delays.every((d) => d >= 0 && d <= 250), delays.join(','));
  check('metronome clicks go to the engine, the first with an accent', clicks.length > 0 && clicks[0].startsWith('click 1'), clicks.slice(0, 4).join(' | '));
  check('pausing stops the waiting play-along notes', s.includes('cancel'));

  // ---- engine stops: back to Web Audio and Web MIDI
  await page.evaluate(() => window.__engine.fire({ ev: 'exit', code: 3 }));
  await sleep(80);
  const st = await page.evaluate(() => ({ state: window.Wapiro.naudio.state, native: window.Wapiro.audio.native.on, ext: window.Wapiro.input.external, err: window.Wapiro.naudio.error }));
  check('if the engine stops, sound and MIDI fall back to the standard engine', st.state === 'error' && !st.native && !st.ext, JSON.stringify(st));

  // ---- Windows audio effects
  await page.click('[aria-label="Sound and devices"]');
  await page.waitForSelector('.asio');
  await sleep(100);
  const fxText = () => page.evaluate(() => [...document.querySelectorAll('.asio button')].map((b) => b.textContent).find((t) => /Windows audio effects/.test(t)));
  check('the menu offers "Disable Windows audio effects"', (await fxText()) === 'Disable Windows audio effects', await fxText());
  await page.click('text=Disable Windows audio effects');
  await sleep(200);
  check('pressing it asks Windows to turn them off', (await page.evaluate(() => window.__engine.fx.setCalls)).join() === 'true');
  check('afterwards it offers to turn them back on', (await fxText()) === 'Turn Windows audio effects back on', await fxText());
  check('and says effects are off for every output', /off for every output/.test(await page.textContent('.asio')));
  await page.keyboard.press('Escape');

  // ---- start-up with ASIO chosen: Web MIDI is never opened
  await page.evaluate(() => { window.Wapiro.storage.settings.audioEngine = 'asio'; window.Wapiro.storage.saveSettingsNow(); });
  await sleep(300);
  await page.reload();
  await page.waitForFunction(() => window.Wapiro && window.Wapiro.naudio && window.Wapiro.naudio.state === 'on', null, { timeout: 5000 }).catch(() => {});
  const boot = await page.evaluate(() => ({ state: window.Wapiro.naudio.state, access: !!window.Wapiro.input.access, ext: window.Wapiro.input.external, sent: window.__engine.sent.slice(0, 6) }));
  check('starting with ASIO chosen opens the engine straight away', boot.state === 'on', JSON.stringify(boot));
  check('and never opens Web MIDI (Windows lets one program read a keyboard)', !boot.access && boot.ext);

  check('no page errors', !errors.length, errors.join('\n'));
  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll ASIO engine checks passed');
  process.exit(failures ? 1 : 0);
})();
