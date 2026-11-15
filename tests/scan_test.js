/* Scan flow on the real low-resolution example: page extraction from an image PDF, staff spacing, enlargement, dialog. */
const fs = require('fs'), path = require('path');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const page = await b.newPage({ viewport: { width: 1280, height: 860 } });
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto('file://' + path.resolve(__dirname, '..', 'dist', 'marksteady_waterfall_piano_roll_v2_0_0.html'));
  await page.waitForFunction(() => window.WapiroTest && window.WapiroTest.state);
  const real = path.join(__dirname, '..', 'real', 'river.pdf');
  const file = process.argv[2] || (fs.existsSync(real) ? real : path.join(__dirname, 'scan', 'smoke_page.png'));
  const res = await page.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const pages = await window.Wapiro.scan.prepare('river.pdf', bin.buffer);
    return pages.map((p) => ({ src: [p.original.width, p.original.height], out: [p.prepared.width, p.prepared.height], interline: p.interline, line: p.line, factor: +p.factor.toFixed(2), after: p.after, verdict: p.verdict }));
  }, fs.readFileSync(file).toString('base64'));
  console.log(JSON.stringify(res));
  page.evaluate(async (b64) => { const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); window.Wapiro.library.importBuffer('river.pdf', bin.buffer, false); }, fs.readFileSync(file).toString('base64'));
  await page.waitForSelector('.scan-pages', { timeout: 30000 }); await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/scan_dialog.png' });
  // save the prepared page for a look
  const png = await page.evaluate(async (b64) => { const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); const p = (await window.Wapiro.scan.prepare('river.pdf', bin.buffer))[0]; const c = document.createElement('canvas'); c.width = 900; c.height = 420; c.getContext('2d').drawImage(p.prepared, 250, 1250, 900, 420, 0, 0, 900, 420); return c.toDataURL('image/png'); }, fs.readFileSync(file).toString('base64'));
  fs.writeFileSync('/tmp/scan_prepared_crop.png', Buffer.from(png.split(',')[1], 'base64'));
  console.log(errs.length ? 'ERR ' + errs.join(' | ') : 'no page errors');
  await b.close();
})();
