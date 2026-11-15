const fs = require('fs'), path = require('path');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const page = await b.newPage();
  page.on('console', (m) => console.log(m.text()));
  await page.goto('file://' + path.resolve(__dirname, '..', 'dist', 'marksteady_waterfall_piano_roll_v2_0_0.html'));
  await page.waitForFunction(() => window.WapiroCore);
  const out = await page.evaluate(async (b64) => {
    const W = window.Wapiro, D = W.pdf._debug, lib = await W.pdf.lib();
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const doc = await lib.getDocument({ data: bin, isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
    const pg = await D.extractPage(await doc.getPage(1), lib);
    const st = D.findStaves(pg);
    const sy = D.pairSystems(pg, st);
    const r = D.readSystem(pg, sy[0]);
    const vsegs = pg.segs.filter(s=>s.v).map(s=>[+s.x1.toFixed(1), +s.y1.toFixed(1), +s.y2.toFixed(1), +s.w.toFixed(2)]);
    return { staves: st.map(s=>[s.top.toFixed(1), s.bot.toFixed(1), s.sp.toFixed(2), s.x1.toFixed(1), s.x2.toFixed(1)]), systems: sy.length,
      bars: r.bars.map(b=>[b.x1.toFixed(1), b.x2.toFixed(1), b.thick, b.repStart, b.repEnd]),
      events: r.events.map(e => (e.rest ? 'R' + e.q : e.kind + '/' + e.heads.length + (e.stemX ? (e.up ? 'u' : 'd') : '-') + 'b' + e.beams + 'f' + e.flags + 'd' + e.dots) + '@' + e.col.toFixed(1) + 's' + e.staff),
      meas: D.measuresOf(r, 2).map(m => [m.x1.toFixed(1), m.x2.toFixed(1), m.evs.length]), vsegs: vsegs.slice(0, 60), heads: pg.glyphs.filter(g=>g.sym&&g.sym.name==='head').length, beams: pg.beams.length, blobs: pg.blobs.length, curves: pg.curves.length };
  }, fs.readFileSync(process.argv[2]).toString('base64'));
  console.log(JSON.stringify(out, null, 0).replace(/\],\[/g, '],\n['));
  await b.close();
})();
