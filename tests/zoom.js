#!/usr/bin/env node
/* Zoomed crop of the sheet pane. Usage: node tests/zoom.js <fixture file> <out.png> [x y w h] [staffSize] [bar] */
const fs = require('fs'), path = require('path');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const html = path.resolve(__dirname, '..', 'dist', 'nish_marksteady_piano_v2_0_0.html');
(async () => {
  const [file, outp, x = 0, y = 100, w = 720, h = 260, size = 0] = process.argv.slice(2);
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => console.log('pageerror', e));
  await page.goto('file://' + html);
  await page.waitForFunction(() => window.WapiroTest && window.WapiroTest.state);
  await page.evaluate(() => window.WapiroTest.reset());
  const f = path.isAbsolute(file) ? file : path.join(__dirname, '..', 'fixtures', file);
  const r = await page.evaluate(async ({ name, b64 }) => { const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); return await window.WapiroTest.importBytes(name, bin.buffer); }, { name: path.basename(f), b64: fs.readFileSync(f).toString('base64') });
  if (!r.ok) console.log(r);
  await page.evaluate(() => window.WapiroTest.setView('sheet'));
  if (+size) { await page.evaluate((s) => { window.Wapiro.shell.setStaff(s); }, +size); }
  await page.waitForTimeout(400);
  await page.screenshot({ path: outp, clip: { x: +x, y: +y, width: +w, height: +h } });
  await browser.close();
})();
