#!/usr/bin/env node
/* Screenshots for visual review. Usage: node tests/shots.js [only-substring] */
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const html = path.resolve(__dirname, '..', 'dist', 'marksteady_waterfall_piano_roll_v2_0_0.html');
const fx = path.join(__dirname, '..', 'fixtures');
const out = path.join(__dirname, '..', 'shots');
const only = process.argv[2] || '';
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  for (const [W, H] of [[1440, 900], [1280, 800]]) {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.route('**/*', (r) => (/^(file|data|blob):/.test(r.request().url()) ? r.continue() : r.abort()));
    await page.goto('file://' + html);
    await page.waitForFunction(() => window.WapiroTest && window.WapiroTest.state);
    const T = (n, ...a) => page.evaluate(([n, a]) => window.WapiroTest[n](...a), [n, a]);
    await T('reset');
    const imp = (file) => page.evaluate(async ({ name, b64 }) => { const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); return await window.WapiroTest.importBytes(name, bin.buffer); }, { name: file, b64: fs.readFileSync(path.join(fx, file)).toString('base64') });
    const ids = {};
    for (const f of ['x1_c_major_basics.musicxml', 'x2_bflat_spelling.musicxml', 'x3_meter_change_ties_triplets.musicxml', 'x4_voices_pickup_repeat.musicxml', 'x5_range_and_chords.musicxml', 'm1_two_hands_bflat_3-4.mid', 'm2_format0_6-8_triplets.mid']) { const r = await imp(f); ids[f.split('_')[0]] = r.id; }
    const songs = await T('listSongs');
    ids.ode = songs.find((s) => /Ode/.test(s.title)).id; ids.prelude = songs.find((s) => /BWV 846/.test(s.title)).id; ids.gym = songs.find((s) => /Gymnop/.test(s.title)).id;
    const shot = async (name, theme, setup) => {
      if (only && !name.includes(only)) return;
      await T('setAppearance', theme);
      await T('stop');
      await T('setOptions', { wait: true, hands: 'R', speed: 1, loop: null, restartAfter: 0, metronome: false, countIn: false });
      await page.keyboard.press('Escape');
      if (setup) await setup();
      await sleep(350);
      await page.screenshot({ path: path.join(out, `${W}x${H}_${name}_${theme}.png`) });
    };
    for (const theme of ['light', 'dark']) {
      await shot('waterfall', theme, async () => { await T('openSong', ids.ode); await T('setView', 'waterfall'); await T('seekMeasure', 2); await T('play'); await sleep(300); await T('noteOn', 67, 90); await sleep(80); await T('noteOff', 67); await T('pause'); });
      await shot('waterfall_intempo_miss', theme, async () => { await T('openSong', ids.x1); await T('setView', 'waterfall'); await T('setOptions', { wait: false, hands: 'both', speed: 1.5 }); await T('play'); await sleep(2200); await T('pause'); });
      for (const [k, id] of [['x1', ids.x1], ['x2', ids.x2], ['x3', ids.x3], ['x4', ids.x4], ['x5', ids.x5], ['m1', ids.m1], ['m2', ids.m2], ['ode', ids.ode], ['prelude', ids.prelude], ['gym', ids.gym]]) {
        await shot('sheet_' + k, theme, async () => { await T('openSong', id); await T('setView', 'sheet'); });
      }
      await shot('split', theme, async () => { await T('openSong', ids.x3); await T('setView', 'split'); await T('seekMeasure', 2); });
      await shot('popover_practice', theme, async () => { await T('openSong', ids.x1); await T('setView', 'waterfall'); await page.click('button[aria-label="Practice options"]'); });
      await shot('popover_sound', theme, async () => { await T('setView', 'waterfall'); await page.click('button[aria-label="Sound and devices"]'); });
      await shot('menu_more', theme, async () => { await page.click('button[aria-label="More"]'); });
      await shot('songs', theme, async () => { await page.click('.title-btn'); });
    }
    await T('setAppearance', 'dark-hc'); await T('setView', 'sheet'); await T('openSong', ids.x4); await sleep(300);
    if (!only || 'hc'.includes(only)) await page.screenshot({ path: path.join(out, `${W}x${H}_sheet_x4_dark-hc.png`) });
    console.log(W + 'x' + H, errors.length ? 'ERRORS ' + errors.slice(0, 3).join(' | ') : 'no errors');
    await page.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(2); });
