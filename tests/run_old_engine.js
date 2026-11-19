#!/usr/bin/env node
/* PDF import on an older browser engine: removes the JavaScript features that Chrome added after version 130
 * (the engine inside Electron 33) before the app loads, then imports real-world PDFs.
 * A notation-software PDF must be read directly; a scanned PDF must be sent to the scan flow (code NO_VECTOR).
 * Usage: node tests/run_old_engine.js [vector.pdf ...] [--scan scanned.pdf ...] */
const fs = require('fs'), path = require('path');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const html = path.resolve(path.join(__dirname, '..', 'dist', 'nish_marksteady_piano_v2_0_0.html'));
const args = process.argv.slice(2);
const vec = [], scans = [];
let into = vec;
for (const a of args) { if (a === '--scan') { into = scans; continue; } into.push(a); }
if (!vec.length && !scans.length) vec.push(...fs.readdirSync(path.join(__dirname, '..', 'fixtures', 'pdf')).filter((f) => f.endsWith('.pdf')).slice(0, 2).map((f) => path.join(__dirname, '..', 'fixtures', 'pdf', f)));

(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const page = await b.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.addInitScript(() => {
    for (const k of ['toHex', 'toBase64', 'setFromHex', 'setFromBase64']) delete Uint8Array.prototype[k];
    for (const k of ['fromHex', 'fromBase64']) delete Uint8Array[k];
    delete Promise.try; delete Math.sumPrecise; delete RegExp.escape; delete Error.isError;
    window.__oldEngine = typeof new Uint8Array(1).toHex !== 'function';
  });
  await page.goto('file://' + html);
  await page.waitForFunction(() => window.WapiroCore);
  let fails = 0;
  if (!(await page.evaluate(() => window.__oldEngine))) { console.log('FAIL  could not remove toHex'); fails++; }
  const run = (f) => page.evaluate(async ({ name, b64 }) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    try {
      const s = await Promise.race([window.WapiroCore.importFile(name, bin.buffer), new Promise((_, no) => setTimeout(() => no(new Error('no answer after 90 s')), 90000))]);
      const hands = { R: 0, L: 0 }; s.notes.forEach((n) => hands[n.hand]++);
      return { ok: true, title: s.title, notes: s.notes.length, bars: s.measures.length, hands, key: (s.keySigs[0] || {}).fifths, time: s.timeSigs.map((t) => t.num + '/' + t.den).join(','),
        first: s.notes.slice(0, 12).map((n) => n.spelled + '@' + n.q + n.hand).join(' '), warnings: s.warnings || [] };
    } catch (e) { return { ok: false, msg: e.message, code: e.code || null }; }
  }, { name: path.basename(f), b64: fs.readFileSync(f).toString('base64') });
  for (const f of vec) {
    const r = await run(f);
    if (!r.ok) { fails++; console.log('FAIL  ' + path.basename(f) + ' threw: ' + r.msg); continue; }
    console.log((r.notes > 20 ? 'pass  ' : 'FAIL  ') + path.basename(f) + ': "' + r.title + '", ' + r.bars + ' bars, ' + r.notes + ' notes (' + r.hands.R + ' R, ' + r.hands.L + ' L), key ' + r.key + ', time ' + r.time);
    console.log('        first notes: ' + r.first);
    if (r.warnings.length) console.log('        warnings: ' + r.warnings.join(' | ').slice(0, 400));
    if (r.notes <= 20) fails++;
  }
  for (const f of scans) {
    const r = await run(f);
    if (!r.ok && r.code === 'NO_VECTOR') console.log('pass  ' + path.basename(f) + ' goes to the scan flow');
    else { fails++; console.log('FAIL  ' + path.basename(f) + ': ' + (r.ok ? 'read as vector?' : r.msg)); }
  }
  if (errs.length) { fails++; console.log('FAIL  page errors: ' + errs.slice(0, 3).join(' | ')); }
  await b.close();
  console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nAll old-engine checks passed');
  process.exit(fails ? 1 : 0);
})();
