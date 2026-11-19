#!/usr/bin/env node
/* Acceptance test for the import/export core of NiSH MarkSteady Piano v2.0.
 * Loads the built single-file app in headless Chrome with every network request blocked,
 * imports each stand-in fixture through window.WapiroCore.importFile and compares the
 * result with fixtures/expected.json. Also round-trips each score through exportMidi.
 *
 * Usage: node tests/run_acceptance.js [path/to/app.html]
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');

const html = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist', 'nish_marksteady_piano_v2_0_0.html'));
const fxDir = path.join(__dirname, '..', 'fixtures');
const spec = JSON.parse(fs.readFileSync(path.join(fxDir, 'expected.json'), 'utf8'));
const TOL_Q = spec.tolerance.q, TOL_BPM = spec.tolerance.bpm;

const near = (a, b, t) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= t;
const sortNotes = (ns) => ns.slice().sort((a, b) => (a.q - b.q) || (a.midi - b.midi) || String(a.hand).localeCompare(String(b.hand)));

function compareList(name, got, exp, fields, problems) {
  if (!Array.isArray(got)) { problems.push(`${name}: missing (expected ${exp.length} entries)`); return; }
  if (got.length !== exp.length) problems.push(`${name}: ${got.length} entries, expected ${exp.length}  got=${JSON.stringify(got).slice(0, 220)}`);
  for (let i = 0; i < Math.min(got.length, exp.length); i++) {
    for (const [f, tol] of fields) {
      const ok = tol === null ? got[i][f] === exp[i][f] : near(got[i][f], exp[i][f], tol);
      if (!ok) { problems.push(`${name}[${i}].${f}: got ${JSON.stringify(got[i][f])}, expected ${JSON.stringify(exp[i][f])}`); break; }
    }
  }
}

function compareNotes(label, gotNotes, expNotes, opts, problems) {
  if (!Array.isArray(gotNotes)) { problems.push(`${label}: song.notes missing`); return; }
  const g = sortNotes(gotNotes), e = sortNotes(expNotes);
  if (g.length !== e.length) problems.push(`${label}: ${g.length} notes, expected ${e.length}`);
  let shown = 0;
  for (let i = 0; i < Math.min(g.length, e.length) && shown < 6; i++) {
    const bad = [];
    if (!near(g[i].q, e[i].q, opts.tol)) bad.push(`q ${g[i].q} != ${e[i].q}`);
    if (!near(g[i].durQ, e[i].durQ, opts.tol)) bad.push(`durQ ${g[i].durQ} != ${e[i].durQ}`);
    if (g[i].midi !== e[i].midi) bad.push(`midi ${g[i].midi} != ${e[i].midi}`);
    if (opts.hands && e[i].hand && g[i].hand !== e[i].hand) bad.push(`hand ${g[i].hand} != ${e[i].hand}`);
    if (opts.spelling && e[i].spelled && g[i].spelled !== e[i].spelled) bad.push(`spelled ${g[i].spelled} != ${e[i].spelled}`);
    if (!opts.hands && g[i].hand !== 'R' && g[i].hand !== 'L') bad.push(`hand must be "R" or "L", got ${JSON.stringify(g[i].hand)}`);
    if (bad.length) { problems.push(`${label} note #${i} (expected q=${e[i].q} midi=${e[i].midi}): ${bad.join('; ')}`); shown++; }
  }
}

(async () => {
  if (!fs.existsSync(html)) { console.error('App file not found: ' + html); process.exit(2); }
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = [], external = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console.error: ' + m.text()); });
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('file:') || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
    external.push(u); return route.abort();
  });
  await page.goto('file://' + html);
  let failures = 0;
  const report = (name, problems) => {
    if (problems.length) { failures++; console.log(`FAIL  ${name}`); problems.slice(0, 12).forEach((p) => console.log('        ' + p)); }
    else console.log(`pass  ${name}`);
  };

  try {
    await page.waitForFunction(() => window.WapiroCore && typeof window.WapiroCore.importFile === 'function' && typeof window.WapiroCore.exportMidi === 'function', null, { timeout: 8000 });
  } catch (e) {
    console.log('FAIL  window.WapiroCore.importFile / exportMidi not available within 8 s of page load');
    pageErrors.slice(0, 5).forEach((p) => console.log('        ' + p));
    await browser.close(); process.exit(1);
  }
  await page.waitForTimeout(600);

  const importInPage = async (name, buf) => page.evaluate(async ({ name, b64 }) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    try {
      const song = await window.WapiroCore.importFile(name, bin.buffer);
      return { ok: true, song: JSON.parse(JSON.stringify(song)) };
    } catch (err) { return { ok: false, message: String((err && err.message) || err) }; }
  }, { name, b64: buf.toString('base64') });

  for (const fx of spec.fixtures) {
    const buf = fs.readFileSync(path.join(fxDir, fx.file));
    const res = await importInPage(fx.file, buf);
    const problems = [];
    if (fx.error) {
      if (res.ok) problems.push('import succeeded but this file must be rejected with a readable error');
      else if (!res.message || res.message.length < 8) problems.push('rejected, but the error message is empty or too short: ' + JSON.stringify(res.message));
      report(fx.file + '  (must be rejected)', problems);
      continue;
    }
    if (!res.ok) { report(fx.file, ['import threw: ' + res.message]); continue; }
    const s = res.song;
    if (fx.title && s.title !== fx.title) problems.push(`title: got ${JSON.stringify(s.title)}, expected ${JSON.stringify(fx.title)}`);
    if (fx.composer && s.composer !== fx.composer) problems.push(`composer: got ${JSON.stringify(s.composer)}, expected ${JSON.stringify(fx.composer)}`);
    if (s.exactNotation !== fx.exactNotation) problems.push(`exactNotation: got ${s.exactNotation}, expected ${fx.exactNotation}`);
    if (s.handsGuessed !== fx.handsGuessed) problems.push(`handsGuessed: got ${s.handsGuessed}, expected ${fx.handsGuessed}`);
    if (fx.keySigs) compareList('keySigs', s.keySigs, fx.keySigs, [['q', TOL_Q], ['fifths', null]], problems);
    compareList('timeSigs', s.timeSigs, fx.timeSigs, [['q', TOL_Q], ['num', null], ['den', null]], problems);
    compareList('tempos', s.tempos, fx.tempos, [['q', TOL_Q], ['bpm', TOL_BPM]], problems);
    compareList('measures', s.measures, fx.measures, [['q', TOL_Q], ['lenQ', TOL_Q]], problems);
    compareNotes('notes', s.notes, fx.notes, { tol: TOL_Q, hands: !fx.handsGuessed, spelling: true }, problems);
    report(fx.file, problems);

    // MusicXML -> MIDI -> import again: the exported MIDI file must carry the same music.
    if (fx.kind !== 'midi') {
      const rt = await page.evaluate(async ({ name, b64 }) => {
        const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        try {
          const song = await window.WapiroCore.importFile(name, bin.buffer);
          const bytes = window.WapiroCore.exportMidi(song);
          const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
          const head = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
          const again = await window.WapiroCore.importFile('roundtrip.mid', u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
          return { ok: true, head, song: JSON.parse(JSON.stringify(again)) };
        } catch (err) { return { ok: false, message: String((err && err.message) || err) }; }
      }, { name: fx.file, b64: buf.toString('base64') });
      const p2 = [];
      if (!rt.ok) p2.push('export/import threw: ' + rt.message);
      else {
        if (rt.head !== 'MThd') p2.push('exported bytes do not start with MThd');
        compareNotes('round-trip notes', rt.song.notes, fx.notes, { tol: 0.01, hands: true, spelling: false }, p2);
        // A pickup bar may be written to MIDI as a short bar, so time signatures are only compared when the score has no pickup.
        const implied = fx.timeSigs[0].num * 4 / fx.timeSigs[0].den;
        if (Math.abs(fx.measures[0].lenQ - implied) < 0.001) compareList('round-trip timeSigs', rt.song.timeSigs, fx.timeSigs, [['q', 0.01], ['num', null], ['den', null]], p2);
        compareList('round-trip tempos', rt.song.tempos, fx.tempos, [['q', 0.01], ['bpm', 1]], p2);
        if (rt.song.handsGuessed !== false) p2.push('round-trip: hands must be read back from the two exported tracks (handsGuessed should be false)');
      }
      report(fx.file + '  -> exportMidi -> import', p2);
    }
  }

  report('no network requests (the app must work fully offline)', external.length ? ['requested: ' + [...new Set(external)].slice(0, 6).join(', ')] : []);
  report('no page errors', pageErrors.slice(0, 6));
  await browser.close();
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll acceptance checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
