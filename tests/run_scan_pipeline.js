#!/usr/bin/env node
/* The whole scan path as the desktop app runs it: the app prepares the pages (W.scan.prepare, W.scan.pagesToPdf),
 * Audiveris reads them (same command line as desktop/main.js), the app parses the MusicXML.
 * Usage: node tests/run_scan_pipeline.js <path to Audiveris executable> <scan.pdf|png|jpg> [...] */
const fs = require('fs'), path = require('path'), os = require('os');
const { spawnSync } = require('child_process');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const html = path.resolve(path.join(__dirname, '..', 'dist', 'nish_marksteady_piano_v2_0_0.html'));
const [exe, ...files] = process.argv.slice(2);
if (!exe || !files.length) { console.log('Usage: node tests/run_scan_pipeline.js <Audiveris> <scan> [...]'); process.exit(2); }

(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const page = await b.newPage();
  await page.goto('file://' + html);
  await page.waitForFunction(() => window.Wapiro && window.Wapiro.scan);
  let fails = 0;
  for (const f of files) {
    const name = path.basename(f);
    const prep = await page.evaluate(async (b64) => {
      const u8 = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const pages = await window.Wapiro.scan.prepare('scan', u8.buffer);
      const use = pages.filter((p) => p.verdict !== 'none');
      const pdf = await window.Wapiro.scan.pagesToPdf(use.map((p) => p.prepared));
      let s = ''; for (let i = 0; i < pdf.length; i += 0x8000) s += String.fromCharCode.apply(null, pdf.subarray(i, i + 0x8000));
      return { pdf: btoa(s), pages: pages.map((p) => ({ verdict: p.verdict, interline: p.interline, factor: Math.round(p.factor * 100) / 100, size: p.prepared.width + 'x' + p.prepared.height })) };
    }, fs.readFileSync(f).toString('base64'));
    console.log(name + ': ' + prep.pages.map((p, i) => 'page ' + (i + 1) + ' ' + p.verdict + ', lines ' + p.interline + ' px apart, enlarged ' + p.factor + 'x to ' + p.size).join('; '));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wapiro-omr-test-')), out = path.join(dir, 'out'), input = path.join(dir, 'scan.pdf');
    fs.mkdirSync(out);
    fs.writeFileSync(input, Buffer.from(prep.pdf, 'base64'));
    const t0 = Date.now();
    const run = spawnSync(exe, ['-batch', '-export', '-output', out, '--', input], { encoding: 'utf8', timeout: 600000 });
    const mxl = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.mxl$/i.test(e.name)) mxl.push(p); } };
    walk(out);
    console.log('        Audiveris: exit ' + run.status + ' after ' + Math.round((Date.now() - t0) / 1000) + ' s, ' + mxl.length + ' MusicXML file(s)');
    if (!mxl.length) {
      fails++;
      console.log('FAIL  ' + name + ': no MusicXML. Last lines:\n        ' + String(run.stdout + run.stderr).split('\n').filter((l) => /WARN|ERROR|xception/.test(l)).slice(-6).join('\n        '));
      continue;
    }
    const r = await page.evaluate(async (b64) => {
      const u8 = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const xml = await window.Wapiro.musicxml.mxlToText(u8);
      const s = window.Wapiro.musicxml.parse(xml, 'scan');
      window.Wapiro.core.finish(s);
      const hands = { R: 0, L: 0 }; s.notes.forEach((n) => hands[n.hand]++);
      return { bars: s.measures.length, notes: s.notes.length, hands, key: (s.keySigs[0] || {}).fifths, time: s.timeSigs.map((t) => t.num + '/' + t.den).join(','),
        first: s.notes.slice(0, 16).map((n) => n.spelled + '@' + n.q + n.hand).join(' '), warnings: s.warnings || [] };
    }, fs.readFileSync(mxl.sort()[0]).toString('base64'));
    const ok = r.notes >= 8 && r.hands.R && r.hands.L;
    if (!ok) fails++;
    console.log((ok ? 'pass  ' : 'FAIL  ') + name + ': ' + r.bars + ' bars, ' + r.notes + ' notes (' + r.hands.R + ' R, ' + r.hands.L + ' L), key ' + r.key + ', time ' + r.time);
    console.log('        first notes: ' + r.first);
    if (r.warnings.length) console.log('        warnings: ' + r.warnings.join(' | ').slice(0, 300));
    fs.rmSync(dir, { recursive: true, force: true });
  }
  await b.close();
  console.log(fails ? '\n' + fails + ' scan check(s) FAILED' : '\nAll scan checks passed');
  process.exit(fails ? 1 : 0);
})();
