#!/usr/bin/env node
/* Import review with tap-to-fix, through the real UI.
 * 1. A notation-software PDF opens straight in the review; tapping a note shows it; the fix buttons and keys change it.
 * 2. With an Audiveris executable given, the desktop bridge is stood in for (window.wapiroDesktop runs the real reader),
 *    so a scanned PDF goes: import -> automatic reading -> review -> set the missing key -> fix a note -> add to library.
 * Usage: node tests/run_fix_ui.js <vector.pdf> [--audiveris <exe> <scan.pdf>] [--shots <dir>] */
const fs = require('fs'), path = require('path'), os = require('os');
const { spawnSync } = require('child_process');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const html = path.resolve(path.join(__dirname, '..', 'dist', 'nish_marksteady_piano_v2_0_0.html'));
const argv = process.argv.slice(2);
const opt = (k, n) => { const i = argv.indexOf(k); return i < 0 ? null : argv.slice(i + 1, i + 1 + n); };
const vector = argv[0] && !argv[0].startsWith('--') ? argv[0] : null;
const aud = opt('--audiveris', 2), shots = (opt('--shots', 1) || [])[0];
if (shots) fs.mkdirSync(shots, { recursive: true });
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'pass  ' : 'FAIL  ') + msg); if (!cond) fails++; };

(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  if (aud) {
    await page.exposeFunction('__runReader', (b64) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wapiro-ui-omr-')), out = path.join(dir, 'out'), input = path.join(dir, 'scan.pdf');
      fs.mkdirSync(out); fs.writeFileSync(input, Buffer.from(b64, 'base64'));
      spawnSync(aud[0], ['-batch', '-export', '-output', out, '--', input], { timeout: 600000 });
      const f = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.mxl$/.test(e.name)) f.push(p); } };
      walk(out);
      return f.sort().map((p) => fs.readFileSync(p).toString('base64'));
    });
    await page.addInitScript(() => {
      window.wapiroDesktop = {
        platform: 'win32',
        omrAvailable: async () => true,
        cancelOmr: async () => true,
        omr: async ({ pdf, pages, onProgress }) => {
          window.__omrCalls = (window.__omrCalls || 0) + 1;
          if (onProgress) onProgress(0.5, pages, 'Reading page 1 of ' + pages + ': note heads…');
          let s = ''; for (let i = 0; i < pdf.length; i += 0x8000) s += String.fromCharCode.apply(null, pdf.subarray(i, i + 0x8000));
          const list = await window.__runReader(btoa(s));
          return list.length ? { mxl: list.map((b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0)).buffer) } : { error: 'no music found' };
        },
        onOpenFile: () => {},
      };
    });
  }
  await page.goto('file://' + html);
  await page.waitForFunction(() => window.WapiroTest && window.Wapiro.library);
  await page.evaluate(() => window.WapiroTest.reset && window.WapiroTest.reset());
  const importUI = (f) => page.evaluate(({ name, b64 }) => {
    const u8 = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    window.__importDone = null;
    window.Wapiro.library.importBuffer(name, u8.buffer, false).then((r) => { window.__importDone = r; });
  }, { name: path.basename(f), b64: fs.readFileSync(f).toString('base64') });
  const shot = async (n) => { if (shots) await page.screenshot({ path: path.join(shots, n + '.png') }); };
  const tapFirstNote = () => page.evaluate(() => {
    const svg = document.querySelector('.fix-svg'); if (!svg || !svg.hits.length) return null;
    const hit = svg.hits.slice().sort((a, b) => a.n.q - b.n.q || b.n.midi - a.n.midi)[0];
    const r = svg.getBoundingClientRect(), k = r.width / svg.lay.width;
    return { x: r.left + hit.x * k, y: r.top + hit.y * k, midi: hit.n.midi, spelled: hit.n.spelled };
  });
  const panel = () => page.evaluate(() => { const p = document.querySelector('.fix-panel'); return p ? p.innerText.replace(/\s+/g, ' ') : null; });

  // ------------------------------------------------------------ 1. notation-software PDF
  if (vector) {
    await importUI(vector);
    await page.waitForSelector('.fix-svg', { timeout: 120000 });
    await page.waitForTimeout(400);
    const nHits = await page.evaluate(() => document.querySelector('.fix-svg').hits.length);
    ok(nHits > 100, 'PDF review shows the whole score to fix (' + nHits + ' tappable notes)');
    await shot('1-review');
    const t = await tapFirstNote();
    await page.mouse.click(t.x, t.y);
    await page.waitForTimeout(200);
    let p = await panel();
    ok(p && p.includes('bar 1'), 'tapping the first note shows it: "' + (p || '').slice(0, 70) + '"');
    await shot('2-selected');
    await page.click('.fix-panel button[aria-label="Up a semitone"]');
    let after = await page.evaluate(() => { const r = document.querySelector('.fix-ring'); return r ? 1 : 0; });
    p = await panel();
    ok(after && p && !p.startsWith(t.spelled.replace('#', '♯')), 'Up a semitone changes the note and keeps it selected: "' + p.slice(0, 40) + '"');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    p = await panel();
    const name0 = t.spelled.replace('#', '♯').replace(/(?<=[A-G])b/, '♭');
    ok(p && p.startsWith(name0), 'keys work and Undo restores ' + name0 + ': "' + p.slice(0, 30) + '"');
    await page.keyboard.press('ArrowRight');
    p = await panel();
    ok(p && p.includes('bar 1'), 'Right arrow moves to the next note: "' + p.slice(0, 50) + '"');
    await page.keyboard.press(']');
    const facts = await page.evaluate(() => document.querySelector('.facts').innerText);
    ok(/Fixes\s*1/.test(facts), 'the facts count the fix');
    await page.click('.dialog-actions .ds-btn--primary');
    await page.waitForFunction(() => window.__importDone, null, { timeout: 30000 });
    const res = await page.evaluate(() => window.__importDone);
    ok(res && res.ok, 'Add to library saves the fixed song');
  }

  // ------------------------------------------------------------ 2. scanned PDF through the desktop reader
  if (aud) {
    await importUI(aud[1]);
    await page.waitForSelector('.scan-pages.is-small', { timeout: 60000 });
    await page.waitForTimeout(300);
    await shot('3-reading');
    ok(true, 'scanned PDF starts reading at once, with the page check above the progress');
    await page.waitForSelector('.fix-svg', { timeout: 600000 });
    await page.waitForTimeout(400);
    const calls = await page.evaluate(() => window.__omrCalls);
    ok(calls === 1, 'the music reader ran once (' + calls + ')');
    const keyEnabled = await page.evaluate(() => { const s = document.querySelector('select[aria-label="Key"]'); return s && !s.disabled; });
    ok(keyEnabled, 'no key signature was found, so the key can be picked');
    const before = await page.evaluate(() => window.Wapiro.library && document.querySelector('.fix-svg').hits.map((h) => h.n.spelled).filter((s) => /^[CFG]\d/.test(s)).length);
    await page.selectOption('select[aria-label="Key"]', '3');
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => document.querySelector('.fix-svg').hits.map((h) => h.n.spelled).filter((s) => /^[CFG]\d/.test(s)).length);
    const sharps = await page.evaluate(() => document.querySelector('.fix-svg').hits.map((h) => h.n.spelled).filter((s) => /^[CFG]#\d/.test(s)).length);
    ok(before > 0 && after === 0 && sharps > 0, 'A major adds its sharps: ' + before + ' C, F or G notes became sharps (' + sharps + ' sharps now)');
    await shot('4-scan-review');
    const t = await tapFirstNote();
    await page.mouse.click(t.x, t.y);
    await page.keyboard.press('ArrowUp');
    const p = await panel();
    ok(p && /hand/.test(p), 'a scanned note can be fixed too: "' + p.slice(0, 50) + '"');
    await shot('5-scan-fix');
    await page.click('.dialog-actions .ds-btn--primary');
    await page.waitForFunction(() => window.__importDone, null, { timeout: 30000 });
    const res = await page.evaluate(() => window.__importDone);
    ok(res && res.ok, 'the scanned song is added to the library');
  }
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 2).join(' | ') : ''));
  await b.close();
  console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nAll fix checks passed');
  process.exit(fails ? 1 : 0);
})();
