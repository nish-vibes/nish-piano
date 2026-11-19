#!/usr/bin/env node
/* PDF reader test: imports the vector PDFs in fixtures/pdf (printed from the MusicXML fixtures with an SMuFL font, like a
 * MuseScore export) and compares the notes with what the MusicXML import of the same score gives (fixtures/expected.json).
 * Usage: node tests/run_pdf.js [app.html] */
const fs = require('fs'), path = require('path');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const html = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist', 'nish_marksteady_piano_v2_0_0.html'));
const fx = path.join(__dirname, '..', 'fixtures');
const spec = JSON.parse(fs.readFileSync(path.join(fx, 'expected.json'), 'utf8'));
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const page = await b.newPage();
  const errs = [], ext = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.route('**/*', (r) => { const u = r.request().url(); if (/^(file|data|blob):/.test(u)) return r.continue(); ext.push(u); return r.abort(); });
  await page.goto('file://' + html);
  await page.waitForFunction(() => window.WapiroCore);
  let fails = 0;
  const pdfs = fs.readdirSync(path.join(fx, 'pdf')).filter((f) => f.endsWith('.pdf')).sort();
  for (const f of pdfs) {
    const exp = spec.fixtures.find((x) => x.file === f.replace(/\.pdf$/, '.musicxml'));
    const t0 = Date.now();
    const res = await page.evaluate(async ({ name, b64 }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      try { const s = await window.WapiroCore.importFile(name, bin.buffer); return { ok: true, s: JSON.parse(JSON.stringify({ title: s.title, notes: s.notes, measures: s.measures, timeSigs: s.timeSigs, keySigs: s.keySigs, tempos: s.tempos, warnings: s.warnings })) }; }
      catch (e) { return { ok: false, msg: e.message }; }
    }, { name: f, b64: fs.readFileSync(path.join(fx, 'pdf', f)).toString('base64') });
    const ms = Date.now() - t0;
    if (!res.ok) { fails++; console.log('FAIL  ' + f + '  threw: ' + res.msg); continue; }
    const s = res.s, probs = [];
    const key = (n) => n.q.toFixed(3) + ':' + n.midi + ':' + n.hand;
    const got = new Map(s.notes.map((n) => [key(n), n])), want = new Map(exp.notes.map((n) => [key(n), n]));
    let ok = 0, durBad = 0;
    for (const [k, n] of want) { const g = got.get(k); if (!g) probs.push('missing ' + n.spelled + ' at q=' + n.q + ' (' + n.hand + ')'); else { ok++; if (Math.abs(g.durQ - n.durQ) > 0.01) { durBad++; probs.push('length of ' + n.spelled + ' at q=' + n.q + ': ' + g.durQ + ' (expected ' + n.durQ + ')'); } } }
    for (const [k, n] of got) if (!want.has(k)) probs.push('extra midi ' + n.midi + ' at q=' + n.q + ' (' + n.hand + ')');
    if (s.measures.length !== exp.measures.length) probs.push('bars: ' + s.measures.length + ', expected ' + exp.measures.length);
    const ts = s.timeSigs.map((t) => t.q + ':' + t.num + '/' + t.den).join(' '), tsE = exp.timeSigs.map((t) => t.q + ':' + t.num + '/' + t.den).join(' ');
    if (ts !== tsE) probs.push('time signatures: ' + ts + ', expected ' + tsE);
    const ks = (s.keySigs[0] || {}).fifths, ksE = (exp.keySigs[0] || {}).fifths;
    if (ks !== ksE) probs.push('key: ' + ks + ', expected ' + ksE);
    if (exp.title && s.title !== exp.title) probs.push('title: ' + JSON.stringify(s.title));
    const score = ok + '/' + want.size + ' notes found, ' + durBad + ' with a wrong length';
    if (probs.length) { fails++; console.log('FAIL  ' + f + '  (' + score + ', ' + ms + ' ms)'); probs.slice(0, 14).forEach((p) => console.log('        ' + p)); }
    else console.log('pass  ' + f + '  (' + score + ', ' + ms + ' ms)');
    console.log('        warnings: ' + (s.warnings || []).join(' | ').slice(0, 300));
  }
  // a broken "PDF" must be refused with a message that names the MusicXML route
  const bad = await page.evaluate(async () => { try { await window.WapiroCore.importFile('x.pdf', new TextEncoder().encode('%PDF-1.4\n% nothing\n').buffer); return 'accepted'; } catch (e) { return e.message; } });
  if (/MusicXML/.test(bad)) console.log('pass  a broken PDF is refused: ' + bad); else { fails++; console.log('FAIL  broken PDF: ' + bad); }
  if (ext.length) { fails++; console.log('FAIL  network requests: ' + ext.slice(0, 3).join(', ')); }
  if (errs.length) { fails++; console.log('FAIL  page errors: ' + errs.slice(0, 3).join(' | ')); }
  await b.close();
  console.log(fails ? '\n' + fails + ' PDF check(s) FAILED' : '\nAll PDF checks passed');
  process.exit(fails ? 1 : 0);
})();
