/* Makes tests/scan/smoke_page.png: a fixture PDF rendered small (like a poor scan), then prepared by the app. */
const fs = require('fs'), path = require('path');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const page = await b.newPage();
  await page.goto('file://' + path.resolve(__dirname, '..', 'dist', 'marksteady_waterfall_piano_roll_v2_0_0.html'));
  await page.waitForFunction(() => window.WapiroTest && window.WapiroTest.state);
  const src = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'pdf', 'x2_bflat_spelling.pdf')).toString('base64');
  const out = await page.evaluate(async (b64) => {
    const W = window.Wapiro, u8 = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const lib = await W.pdf.lib(), doc = await lib.getDocument({ data: u8, verbosity: 0 }).promise, pg = await doc.getPage(1);
    const vp = pg.getViewport({ scale: 0.75 }), c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: x, viewport: vp }).promise;
    // soften like a cheap scan
    const s = document.createElement('canvas'); s.width = c.width; s.height = c.height; const sx = s.getContext('2d'); sx.filter = 'blur(0.6px)'; sx.drawImage(c, 0, 0);
    const blob = await new Promise((r) => s.toBlob(r, 'image/jpeg', 0.6));
    const pages = await W.scan.prepare('smoke.jpg', await blob.arrayBuffer());
    return { png: pages[0].prepared.toDataURL('image/png'), interline: pages[0].interline, factor: pages[0].factor, size: [s.width, s.height] };
  }, src);
  fs.writeFileSync(path.join(__dirname, 'scan', 'smoke_page.png'), Buffer.from(out.png.split(',')[1], 'base64'));
  console.log('smoke page', out.size, 'interline', out.interline, 'factor', out.factor.toFixed(2));
  await b.close();
})();
