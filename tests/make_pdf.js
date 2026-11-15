#!/usr/bin/env node
/* Test tool: engrave a fixture with the app's sheet renderer, symbols as SMuFL text (test font), and print it to a vector PDF,
 * the way notation software exports. Usage: node tests/make_pdf.js <fixture> <out.pdf> [staffSize] [width] */
const fs = require('fs'), path = require('path');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const html = path.resolve(__dirname, '..', 'dist', 'marksteady_waterfall_piano_roll_v2_0_0.html');
(async () => {
  const [file, outp, size = '10', width = '760'] = process.argv.slice(2);
  const map = JSON.parse(fs.readFileSync(path.join(__dirname, 'smufl_map.json'), 'utf8'));
  const font = fs.readFileSync(path.join(__dirname, 'WapiroTestSMuFL.ttf')).toString('base64');
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('file://' + html);
  await page.waitForFunction(() => window.WapiroTest && window.WapiroTest.state);
  await page.evaluate(() => window.WapiroTest.reset());
  const f = path.isAbsolute(file) ? file : path.join(__dirname, '..', 'fixtures', file);
  const r = await page.evaluate(async ({ name, b64 }) => { const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); return await window.WapiroTest.importBytes(name, bin.buffer); }, { name: path.basename(f), b64: fs.readFileSync(f).toString('base64') });
  if (!r.ok) { console.error(r); process.exit(1); }
  const svg = await page.evaluate(({ map, size, width }) => {
    const SH = window.Wapiro.sheet;
    SH.textGlyphs = { family: 'WapiroTestSMuFL', map };
    SH.layout(width, size);
    for (let i = 0; i < SH.lay.systems.length; i++) SH.renderSystem(i);
    const c = SH.svg.cloneNode(true);
    c.querySelectorAll('.sh-cursor, .sh-miss').forEach((n) => n.remove());
    return { html: c.outerHTML, w: SH.lay.width, h: SH.lay.height, title: window.Wapiro.engine.song.title };
  }, { map, size: +size, width: +width });
  const p2 = await b.newPage();
  await p2.goto('file://' + path.join(__dirname, '..', 'pdftest', 'blank.html'));
  await p2.setContent(`<html><head><style>
    @font-face { font-family: WapiroTestSMuFL; src: url(data:font/ttf;base64,${font}); }
    body { margin: 0; font-family: FreeSerif, serif; }
    h1 { font: 600 22px FreeSerif, serif; text-align: center; margin: 24px 0 4px; }
    .sh-ink { fill: #000; } .sh-line { stroke: #000; fill: none; } .sh-time { fill: #000; font-family: FreeSerif, serif; font-weight: bold; }
    .sh-num, .sh-tup { fill: #000; font-family: FreeSerif, serif; font-size: 11px; } .sh-paper { fill: #fff; }
  </style></head><body><h1>${svg.title}</h1><div style="padding: 0 24px">${svg.html}</div></body></html>`);
  await p2.evaluate(() => document.fonts.ready);
  await p2.pdf({ path: outp, width: (svg.w + 48) + 'px', height: Math.max(600, svg.h + 120) + 'px', printBackground: true });
  console.log('wrote', outp);
  await b.close();
})();
