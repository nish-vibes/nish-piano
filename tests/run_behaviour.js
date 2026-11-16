#!/usr/bin/env node
/* Behaviour tests for MarkSteady Wapiro v2.0. They drive the real app through window.WapiroTest
 * (thin wrappers over the same functions the UI calls) and check the defects found in v1.0.
 *
 * Usage: node tests/run_behaviour.js [path/to/app.html]
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');

const html = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist', 'marksteady_waterfall_piano_roll_v2_0_0.html'));
const fxDir = path.join(__dirname, '..', 'fixtures');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.route('**/*', (route) => {
    const u = route.request().url();
    return (u.startsWith('file:') || u.startsWith('data:') || u.startsWith('blob:')) ? route.continue() : route.abort();
  });
  const ready = async () => page.waitForFunction(() => window.WapiroTest && typeof window.WapiroTest.state === 'function', null, { timeout: 8000 });
  await page.goto('file://' + html);
  try { await ready(); } catch (e) { console.log('FAIL  window.WapiroTest not available'); await browser.close(); process.exit(1); }

  const T = (name, ...args) => page.evaluate(async ([n, a]) => await window.WapiroTest[n](...a), [name, args]);
  const importFx = (file, as) => page.evaluate(async ({ name, b64 }) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return await window.WapiroTest.importBytes(name, bin.buffer);
  }, { name: as || file, b64: fs.readFileSync(path.join(fxDir, file)).toString('base64') });
  const waitFor = async (pred, ms, step = 50) => { const end = Date.now() + ms; let s; do { s = await T('state'); if (pred(s)) return s; await sleep(step); } while (Date.now() < end); return null; };
  const best = async (id) => ((await T('listSongs')).find((s) => s.id === id) || {}).best;

  let failures = 0;
  const check = (name, ok, detail) => { if (ok) console.log('pass  ' + name); else { failures++; console.log('FAIL  ' + name + (detail ? '\n        ' + detail : '')); } };
  const OPT = { wait: true, hands: 'R', speed: 1, loop: null, restartAfter: 0, metronome: false, countIn: false };

  await T('reset');
  let s = await T('state');
  let songs = await T('listSongs');
  check('first run: a song is loaded and nothing is playing', songs.length >= 1 && !!s.songId && s.playing === false, JSON.stringify({ songs: songs.length, s }));

  // v1 bug: opening the report before playing saved "Best: 100%".
  await T('openResults');
  check('opening results before playing records no best score', (await best(s.songId)) == null, 'best=' + (await best(s.songId)));
  await T('closeResults');

  const before = (await T('listSongs')).length;
  const r1 = await importFx('x1_c_major_basics.musicxml');
  const r6 = await importFx('x6_two_parts.musicxml');
  check('MusicXML files import through the app', r1 && r1.ok && r6 && r6.ok && (await T('listSongs')).length === before + 2, JSON.stringify([r1, r6]));
  const rEmpty = await importFx('m4_no_notes.mid');
  check('a MIDI file without notes is refused with a message (v1 silently loaded Ode to Joy)', rEmpty && rEmpty.ok === false && String(rEmpty.error || '').length > 8 && (await T('listSongs')).length === before + 2, JSON.stringify(rEmpty));
  const rPdf = await page.evaluate(async () => await window.WapiroTest.importBytes('score.pdf', new TextEncoder().encode('%PDF-1.4\n% not a score\n').buffer));
  check('a PDF is not "recognised": the app explains the MusicXML route instead', rPdf && rPdf.ok === false && /musicxml/i.test(String(rPdf.error || '')) && (await T('listSongs')).length === before + 2, JSON.stringify(rPdf));

  // Wait mode: holds at the first note, advances when it is played.
  await T('openSong', r1.id); await T('setOptions', OPT); await T('seekMeasure', 1); await T('play');
  s = await waitFor((x) => x.playing && x.waitingFor.some((n) => n.midi === 72), 2500);
  check('wait mode holds at the first right-hand note', !!s && s.q <= 0.06, JSON.stringify(s));
  await T('noteOn', 72, 80); await sleep(60); await T('noteOff', 72);
  s = await waitFor((x) => x.waitingFor.some((n) => n.midi === 74), 3000);
  check('after the right note it advances and waits at the next one', !!s && s.q > 0.9 && s.q < 1.06 && s.stats.hit === 1, JSON.stringify(s));
  const wrongBefore = s ? s.stats.wrong : 0;
  await T('noteOn', 61, 80); await sleep(40); await T('noteOff', 61);
  s = await T('state');
  check('a wrong key counts as wrong, not as a hit', s.stats.wrong === wrongBefore + 1 && s.stats.hit === 1, JSON.stringify(s.stats));

  // v1 bug: with wait mode on, jumping ahead snapped back to the first unplayed note.
  await T('pause'); await T('seekMeasure', 3); await T('play');
  s = await waitFor((x) => x.playing && x.waitingFor.some((n) => n.midi === 76), 2500);
  check('seeking to bar 3 in wait mode stays in bar 3', !!s && s.q >= 7.99 && s.waitingFor.every((n) => n.q >= 7.99), JSON.stringify(s));

  // v1 bug: looping a later section from a fresh start snapped back to bar 1.
  await T('stop'); await T('setOptions', Object.assign({}, OPT, { loop: { from: 2, to: 3 } })); await T('play');
  s = await waitFor((x) => x.playing && x.waitingFor.some((n) => n.midi === 81), 4000);
  check('a loop on bars 2-3 starts in bar 2 and waits there', !!s && s.q >= 4.9 && s.q <= 5.06 && s.waitingFor.every((n) => n.q >= 3.99), JSON.stringify(s));
  await T('stop'); await T('setOptions', OPT);

  // 88 keys.
  await T('noteOn', 21, 80); await T('noteOn', 108, 80);
  s = await T('state');
  check('A0 and C8 are accepted as input (v1 ignored anything outside C2-C7)', s.activeKeys.includes(21) && s.activeKeys.includes(108), JSON.stringify(s.activeKeys));
  await T('noteOff', 21); await T('noteOff', 108);

  // v1 bug: watching the demo to the end saved "Best: 100%".
  await T('openSong', r6.id); await T('setOptions', Object.assign({}, OPT, { speed: 1.5 })); await T('listen');
  const during = await waitFor((x) => x.playing && x.mode === 'listen', 1500);
  const done = await waitFor((x) => !x.playing, 9000, 100);
  check('listen mode plays to the end and records no best score', !!during && !!done && (await best(r6.id)) == null, JSON.stringify({ during: !!during, done: !!done, best: await best(r6.id) }));
  await T('closeResults');

  // In-tempo mode: notes that are not played are counted as missed.
  await T('openSong', r6.id); await T('setOptions', Object.assign({}, OPT, { wait: false, speed: 1.5 })); await T('seekMeasure', 1); await T('play');
  const ended = await waitFor((x) => !x.playing, 9000, 100);
  check('in-tempo mode counts unplayed notes as missed', !!ended && ended.stats.missed >= 4 && ended.stats.hit === 0, JSON.stringify(ended && ended.stats));
  await T('closeResults');

  // A complete, correct practice run does record a score.
  await T('openSong', r6.id); await T('setOptions', Object.assign({}, OPT, { speed: 1.5 })); await T('seekMeasure', 1); await T('play');
  let played = 0;
  for (const m of [74, 78, 81, 74]) {
    const w = await waitFor((x) => x.playing && x.waitingFor.some((n) => n.midi === m), 4000, 30);
    if (!w) break;
    await T('noteOn', m, 80); await sleep(50); await T('noteOff', m); played++;
    await sleep(60);
  }
  const fin = await waitFor((x) => !x.playing, 9000, 100);
  check('a complete correct run records best = 100', played === 4 && !!fin && (await best(r6.id)) === 100, JSON.stringify({ played, fin: fin && fin.stats, best: await best(r6.id) }));
  await T('closeResults');

  // In-tempo mode: a note may be played late until 30 % of its length has passed (never less than the timing window);
  // after that it is missed and its bar shakes. Correct, wrong and missed notes each start a waterfall effect that ends by itself.
  const fx = await page.evaluate(async () => {
    const T = window.WapiroTest, W = window.Wapiro, E = W.engine;
    const song = (await T.listSongs()).find((x) => /Prelude in C/.test(x.title)); await T.openSong(song.id); await T.setView('split');
    await T.setOptions({ wait: false, hands: 'both', playAlong: false, speed: 1, loop: null, restartAfter: 0, metronome: false, countIn: false }); await T.seekMeasure(2);
    const g = E.get(), m2 = g.measures[1].q, out = { ev: { hit: 0, miss: 0, wrong: 0 }, missAt: null };
    const longs = []; for (let i = 0; i < g.n; i++) if (g.nh[i] === 1 && g.nq[i] >= m2 - 1e-6 && g.nd[i] >= 1.5) longs.push(i);
    const a = longs[0], c = longs[1];
    E.on('hit', () => out.ev.hit++); E.on('wrong', () => out.ev.wrong++);
    E.on('miss', (e) => { out.ev.miss++; if (e.i === c) out.missAt = (E.q - g.nq[c]) / g.nd[c]; });
    const until = (fn) => new Promise((r) => { const t = setInterval(() => { if (fn()) { clearInterval(t); r(); } }, 4); });
    await T.play();
    await until(() => E.q >= g.nq[a] + 0.2 * g.nd[a]);
    E.noteOn(g.nm[a], 90); out.lateHit = E.noteStatus(a); E.noteOff(g.nm[a]);
    await until(() => E.q >= g.nq[c] + 0.4 * g.nd[c]);
    out.missed = E.noteStatus(c); E.noteOn(g.nm[c], 90); E.noteOff(g.nm[c]);
    out.fxRunning = W.waterfall.fxAlive();
    await T.pause(); await new Promise((r) => setTimeout(r, 1800));
    out.fxAtRest = !W.waterfall.fxAlive();
    return out;
  });
  check('in-tempo mode: a long note played 20 % late still counts', fx.lateHit === 1 && fx.ev.hit === 1, JSON.stringify(fx));
  check('in-tempo mode: a long note is missed once 30 % of its length has passed', fx.missed === 2 && fx.missAt != null && fx.missAt >= 0.3 && fx.missAt < 0.4 && fx.ev.wrong === 1, JSON.stringify(fx));
  check('waterfall effects start on hit, wrong and miss, and end by themselves', fx.fxRunning && fx.fxAtRest && fx.ev.miss >= 1, JSON.stringify(fx));
  await T('closeResults');

  // Freeplay hides the song and shows the waterfall alone; Record saves what is played as a song; Export makes a video file.
  const fp = await page.evaluate(async () => {
    const T = window.WapiroTest, W = window.Wapiro, E = W.engine, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = {}, before = (await T.listSongs()).length, song = E.song.id, root = document.getElementById('app');
    await T.setView('split');
    await T.freeplay(true); out.view = root.dataset.view; out.hidden = W.waterfall.free === true; await T.play(); out.noPlay = !E.playing;
    await T.freeplay(false); out.back = root.dataset.view === 'split' && E.song.id === song && !W.waterfall.free;
    await T.record(true); out.recView = root.dataset.view;
    E.noteOn(48, 90); E.noteOn(64, 90); await sleep(260); E.noteOff(48); E.noteOff(64); await sleep(120); E.noteOn(67, 90); await sleep(200); E.noteOff(67);
    const id = await T.record(false);
    out.saved = (await T.listSongs()).length === before + 1 && E.song.id === id;
    out.notes = E.song.notes.map((n) => n.midi + n.hand).join(' '); out.first = E.song.notes[0].q;
    const v = await T.exportVideo({ maxSeconds: 2 });
    out.video = { ok: v.ok, type: v.type, big: v.size > 20000, frames: v.frames > 20 };
    out.restored = root.dataset.view === 'split' && !E.playing;
    await T.deleteSong(id);
    return out;
  });
  check('Freeplay shows the waterfall alone, hides the song, and brings both back', fp.view === 'waterfall' && fp.hidden && fp.noPlay && fp.back, JSON.stringify(fp));
  check('Record saves what was played as a song, hands split at middle C', fp.recView === 'waterfall' && fp.saved && fp.notes === '48L 64R 67R' && fp.first === 0, JSON.stringify(fp));
  check('Export video makes a video file and restores the view', fp.video.ok && fp.video.big && fp.video.frames && fp.restored, JSON.stringify(fp));

  // Hand colours are set per hand and reach the waterfall; a correct key turns green while held; risky colours are warned about.
  const hc = await page.evaluate(async () => {
    const T = window.WapiroTest, W = window.Wapiro, E = W.engine, P = W.popovers, cs = () => getComputedStyle(document.documentElement), out = {};
    await T.setHandColour('L', '#2EC4B6');
    out.left = cs().getPropertyValue('--hand-left').trim(); out.rightKept = cs().getPropertyValue('--hand-right').trim() === cs().getPropertyValue('--primary').trim();
    await T.setHandColour('R', '#A78BFA'); out.right = cs().getPropertyValue('--hand-right').trim(); out.accentKept = cs().getPropertyValue('--primary').trim() !== '#A78BFA';
    await T.setHandColour('L', null); await T.setHandColour('R', null); out.cleared = cs().getPropertyValue('--hand-left').trim() !== '#2EC4B6';
    out.warn = [!!P.colourWarning('#E02020', '#5B7BFA'), !!P.colourWarning('#30C040', '#5B7BFA'), !!P.colourWarning('#5B7BFA', '#5F80F8'), P.colourWarning('#2EC4B6', '#FE8B48') === null];
    await T.setView('split'); await T.setOptions({ wait: true, hands: 'both', playAlong: false, loop: null }); await T.seekMeasure(1); await T.play();
    let w = []; for (let k = 0; k < 300 && !w.length; k++) { w = E.waitingFor(); if (!w.length) await new Promise((r) => setTimeout(r, 20)); }
    E.noteOn(w[0].midi, 90); out.green = !!document.querySelector('.key.is-ok[data-midi="' + w[0].midi + '"]');
    E.noteOff(w[0].midi); out.greenOff = !document.querySelector('.key.is-ok');
    await T.pause();
    return out;
  });
  check('hand colours are set independently and leave the accent colour alone', hc.left === '#2EC4B6' && hc.rightKept && hc.right === '#A78BFA' && hc.accentKept && hc.cleared, JSON.stringify(hc));
  check('colours near red, green or the other hand are warned about', hc.warn.every(Boolean), JSON.stringify(hc));
  check('a correct key is green while it is held', hc.green && hc.greenOff, JSON.stringify(hc));

  // v1 bug: edits were lost unless Save was pressed; there was no undo.
  await T('openSong', r1.id);
  const n0 = (await T('songInfo', r1.id)).notes;
  await T('editAddNote', { q: 15, durQ: 1, midi: 84, hand: 'R' });
  const n1 = (await T('songInfo', r1.id)).notes;
  await T('undo'); const n2 = (await T('songInfo', r1.id)).notes;
  await T('redo'); const n3 = (await T('songInfo', r1.id)).notes;
  check('editing adds a note; undo and redo work', n1 === n0 + 1 && n2 === n0 && n3 === n0 + 1, JSON.stringify([n0, n1, n2, n3]));
  await T('setAppearance', 'dark'); await T('setView', 'sheet');
  await sleep(900);
  await page.reload(); await ready(); await sleep(500);
  s = await T('state');
  check('edits are saved without a Save button and survive a reload', (await T('songInfo', r1.id)).notes === n0 + 1, 'notes=' + (await T('songInfo', r1.id)).notes);
  check('appearance and view survive a reload', s.appearance === 'dark' && s.view === 'sheet', JSON.stringify({ appearance: s.appearance, view: s.view }));
  check('the best score survives a reload', (await best(r6.id)) === 100, 'best=' + (await best(r6.id)));

  const cnt = (await T('listSongs')).length;
  await T('deleteSong', r6.id);
  check('songs can be deleted (v1 had no delete)', (await T('listSongs')).length === cnt - 1 && !(await T('listSongs')).some((x) => x.id === r6.id), '');

  check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 4).join(' | '));
  await browser.close();
  console.log(failures ? `\n${failures} behaviour check(s) FAILED` : '\nAll behaviour checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
