const fs = require('fs'), path = require('path');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const html = path.resolve(__dirname, '..', 'dist', 'marksteady_waterfall_piano_roll_v2_0_0.html');
const out = path.join(__dirname, '..', 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const theme = process.argv[2] || 'light';
  const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.route('**/*', (r) => (/^(file|data|blob):/.test(r.request().url()) ? r.continue() : r.abort()));
  await page.goto('file://' + html);
  await page.waitForFunction(() => window.WapiroTest && window.WapiroTest.state);
  const T = (n, ...a) => page.evaluate(([n, a]) => window.WapiroTest[n](...a), [n, a]);
  await T('reset'); await T('setAppearance', theme);
  await page.evaluate(() => { localStorage.removeItem('x'); });
  await page.reload(); await page.waitForFunction(() => window.WapiroTest && window.WapiroTest.state); await sleep(400);
  await page.screenshot({ path: path.join(out, `ui_firstrun_${theme}.png`) });
  const pdf = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'pdf', 'x4_voices_pickup_repeat.pdf')).toString('base64');
  page.evaluate(async (b64) => { const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); window.__r = await window.Wapiro.library.importBuffer('x4_voices_pickup_repeat.pdf', bin.buffer, false); }, pdf);
  await page.waitForSelector('.review', { timeout: 20000 }); await sleep(500);
  await page.screenshot({ path: path.join(out, `ui_review_pdf_${theme}.png`) });
  await page.click('.dialog-actions .ds-btn--primary'); await sleep(500);
  await T('setView', 'sheet'); await sleep(400);
  await page.screenshot({ path: path.join(out, `ui_pdf_sheet_${theme}.png`) });
  await page.click('.title-btn'); await sleep(300);
  await page.hover('.lib-row:nth-child(2)'); await sleep(200);
  await page.screenshot({ path: path.join(out, `ui_library_${theme}.png`) });
  await page.keyboard.press('Escape');
  // results after an in-tempo run with mistakes
  const songs = await T('listSongs');
  await T('openSong', songs.find((s) => /Twinkle|vous/.test(s.title)).id);
  await T('setView', 'waterfall');
  await T('setOptions', { wait: false, hands: 'R', speed: 1.5, loop: null, metronome: false, countIn: false });
  await T('seekMeasure', 1); await T('play');
  for (const m of [60, 60, 67, 66, 69]) { await sleep(380); await T('noteOn', m, 80); await T('noteOff', m); }
  await page.waitForSelector('.results', { timeout: 20000 }); await sleep(300);
  await page.screenshot({ path: path.join(out, `ui_results_${theme}.png`) });
  await page.keyboard.press('Escape');
  // editor
  await page.evaluate(() => window.Wapiro.editor.start()); await sleep(300);
  const box = await page.locator('.wf-canvas').boundingBox();
  await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.55); await sleep(300);
  await page.screenshot({ path: path.join(out, `ui_editor_${theme}.png`) });
  await page.evaluate(() => window.Wapiro.editor.stop());
  // pdf that cannot be read
  page.evaluate(async () => { await window.Wapiro.library.importBuffer('scan.pdf', new TextEncoder().encode('%PDF-1.4\n%x\n').buffer, false); });
  await page.waitForSelector('.pdf-help', { timeout: 20000 }); await sleep(200);
  await page.screenshot({ path: path.join(out, `ui_pdf_fail_${theme}.png`) });
  console.log(errs.length ? 'ERRORS ' + errs.join(' | ') : 'no page errors');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
