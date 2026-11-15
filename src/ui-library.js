/* Library panel, import review, PDF helper, backup and restore, version 1 library conversion. */
(function () {
  'use strict';
  const W = window.Wapiro, E = W.engine, UI = W.ui, h = UI.h, S = W.storage, U = W.util;
  const Lib = (W.library = {});

  const KEY_NAMES = { '-7': 'C flat major', '-6': 'G flat major', '-5': 'D flat major', '-4': 'A flat major', '-3': 'E flat major', '-2': 'B flat major', '-1': 'F major',
    0: 'C major', 1: 'G major', 2: 'D major', 3: 'A major', 4: 'E major', 5: 'B major', 6: 'F sharp major', 7: 'C sharp major' };
  Lib.keyName = (f) => KEY_NAMES[f] || 'C major';
  const sorted = () => S.records.slice().sort((a, b) => a.order - b.order);
  const fileSafe = (t) => String(t).replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'song';
  function download(name, bytes, type) {
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    const a = h('a', { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  function pickFile(accept, cb) {
    const inp = h('input', { type: 'file', accept, class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
    inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0];
      inp.remove();
      if (f) cb(f);
    });
    document.body.appendChild(inp);
    inp.click();
  }
  Lib.exportMidi = function (song) {
    try { download(fileSafe(song.title) + '.mid', W.core.exportMidi(song), 'audio/midi'); }
    catch (e) { UI.toast('Could not export MIDI: ' + e.message, 'error'); }
  };

  // ---------------------------------------------------------------- library panel
  Lib.open = function () {
    let query = '';
    const search = h('input', { class: 'ds-input', type: 'search', placeholder: 'Search songs', 'aria-label': 'Search songs' });
    const list = h('ul', { class: 'lib-list', 'aria-label': 'Songs' });
    const count = h('span', { class: 'ds-caption' });
    const draw = () => {
      list.textContent = '';
      const q = query.trim().toLowerCase();
      const rows = sorted().filter((r) => !q || (r.song.title + ' ' + (r.song.composer || '')).toLowerCase().includes(q));
      count.textContent = rows.length === S.records.length ? S.records.length + (S.records.length === 1 ? ' song' : ' songs') : rows.length + ' of ' + S.records.length + ' songs';
      if (!rows.length) list.append(h('li', { class: 'lib-empty ds-caption', text: q ? 'No songs match "' + query.trim() + '".' : 'No songs yet. Import a MusicXML or MIDI file.' }));
      for (const r of rows) list.append(row(r, !!q));
    };
    const row = (r, filtered) => {
      const s = r.song, cur = E.song && E.song.id === r.id;
      const title = h('span', { class: 'ds-control-text lib-title', text: s.title });
      const open = h('button', { class: 'lib-open', type: 'button', 'aria-current': cur ? 'true' : null, onclick: () => { UI.closeDialog(); W.app.openSong(r.id); } },
        title, h('span', { class: 'ds-caption lib-sub', text: (s.composer ? s.composer + ' · ' : '') + s.measures.length + ' bars' + (r.best == null ? '' : ' · best ' + r.best + '%') }));
      const handle = h('button', { class: 'ds-handle ds-reveal lib-handle', type: 'button', 'aria-label': 'Move "' + s.title + '". Use the up and down arrow keys.', disabled: filtered ? true : null }, UI.icon('grip'));
      const act = (icon, label, fn) => h('button', { class: 'ds-btn ds-btn--ghost ds-btn--icon tip', type: 'button', 'aria-label': label + ' "' + s.title + '"', 'data-tip': label, onclick: fn }, UI.icon(icon));
      const li = h('li', { class: 'lib-row ds-row' + (cur ? ' is-current' : ''), 'data-id': r.id },
        filtered ? h('span', { class: 'lib-handle-space' }) : handle, open, h('span', { class: 'ds-badge', text: W.app.sourceLabel(s) }),
        h('span', { class: 'lib-actions ds-reveal' },
          act('edit', 'Rename', () => rename(li, r)),
          act('download', 'Export MIDI', () => Lib.exportMidi(s)),
          act('trash', 'Delete', () => del(r))));
      if (!filtered) bindDrag(handle, li, r);
      return li;
    };
    const rename = (li, r) => {
      const inp = h('input', { class: 'ds-input lib-rename', value: r.song.title, 'aria-label': 'New title' });
      const done = (ok) => {
        const v = inp.value.trim();
        if (ok && v && v !== r.song.title) { r.song.title = v; S.writeRecord(r); if (E.song && E.song.id === r.id) E.emit('song', E.song); }
        draw();
      };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done(true); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); } });
      inp.addEventListener('blur', () => done(true));
      li.querySelector('.lib-open').replaceWith(inp);
      inp.focus(); inp.select();
    };
    const del = async (r) => {
      const backup = r;
      await W.app.deleteSong(r.id);
      draw();
      UI.toast('Deleted "' + r.song.title + '".', null, { action: { label: 'Undo', run: async () => { S.records.push(backup); await S.writeRecord(backup); draw(); UI.toast('Restored "' + backup.song.title + '".'); } } });
    };
    // reorder by drag handle (pointer) or arrow keys on the handle
    const bindDrag = (handle, li, r) => {
      handle.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault(); e.stopPropagation();
        const all = sorted(), i = all.indexOf(r), j = i + (e.key === 'ArrowUp' ? -1 : 1);
        if (j < 0 || j >= all.length) return;
        [all[i], all[j]] = [all[j], all[i]];
        renumber(all); draw();
        const nh = list.querySelector('[data-id="' + r.id + '"] .lib-handle'); if (nh) nh.focus();
      });
      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        handle.setPointerCapture(e.pointerId);
        li.classList.add('is-dragging');
        const line = h('li', { class: 'ds-dropline lib-drop', 'aria-hidden': 'true' });
        let target = null;
        const move = (ev) => {
          const rows = [...list.querySelectorAll('.lib-row')].filter((x) => x !== li);
          target = rows.length;
          for (let k = 0; k < rows.length; k++) { const b = rows[k].getBoundingClientRect(); if (ev.clientY < b.top + b.height / 2) { target = k; break; } }
          if (target < rows.length) list.insertBefore(line, rows[target]); else list.appendChild(line);
        };
        const up = () => {
          handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up);
          line.remove(); li.classList.remove('is-dragging');
          if (target == null) return;
          const others = sorted().filter((x) => x !== r);
          others.splice(target, 0, r);
          renumber(others); draw();
        };
        handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
      });
    };
    const renumber = (arr) => { arr.forEach((x, k) => { if (x.order !== k + 1) { x.order = k + 1; S.writeRecord(x); } }); };
    search.addEventListener('input', () => { query = search.value; draw(); });
    const head = h('div', { class: 'lib-tools' },
      h('div', { class: 'lib-search' }, UI.icon('search'), search),
      h('button', { class: 'ds-btn ds-btn--primary', type: 'button', onclick: () => Lib.pickAndImport() }, UI.icon('upload'), 'Import'));
    const foot = h('div', { class: 'lib-foot' }, count, h('span', { class: 'grow' }),
      h('button', { class: 'ds-btn ds-btn--ghost', type: 'button', onclick: () => Lib.backup() }, 'Back up library'),
      h('button', { class: 'ds-btn ds-btn--ghost', type: 'button', onclick: () => Lib.restore() }, 'Restore backup'));
    draw();
    UI.openDialog('Library', h('div', { class: 'lib' }, head, list, foot), null, { cls: 'dialog--wide', focus: '.lib-search input' });
    Lib.redraw = draw;
  };

  // ---------------------------------------------------------------- import with review
  Lib.pickAndImport = function () {
    pickFile('.musicxml,.xml,.mxl,.mid,.midi,.pdf', (f) => Lib.importFile(f));
  };
  Lib.importFile = async function (file) {
    let buf;
    try { buf = await file.arrayBuffer(); } catch (e) { UI.toast('Could not read "' + file.name + '".', 'error'); return; }
    return Lib.importBuffer(file.name, buf, false);
  };
  const isPdf = (name, u8) => /\.pdf$/i.test(name) || (u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46);

  /** Import a file. auto = true skips the review (used by the test hook); the parse and save path is the same. */
  Lib.importBuffer = async function (name, buffer, auto) {
    const u8 = new Uint8Array(buffer);
    const pdf = isPdf(name, u8);
    let song, busy = null;
    if (pdf && !auto) busy = UI.openDialog('Reading the PDF', h('div', { class: 'ds-help', role: 'status' }, 'Reading the music in "' + U.cleanTitle(name) + '". This can take a few seconds per page.'), null);
    try { song = await W.core.importFile(name, buffer); }
    catch (err) {
      const msg = (err && err.message) || String(err);
      if (busy) UI.closeDialog();
      if (pdf && !auto) Lib.pdfHelp(name, msg);
      else if (!auto) UI.openDialog('Could not import "' + U.cleanTitle(name) + '"', h('div', { class: 'ds-alert ds-alert--danger', role: 'alert' }, UI.icon('alert'), h('div', null, h('strong', { text: 'The file was not added.' }), h('span', { text: msg }))));
      else UI.toast(msg, 'error');
      return { ok: false, error: msg };
    }
    if (busy) UI.closeDialog();
    if (auto) return Lib.add(song);
    return new Promise((resolve) => Lib.review(song, resolve));
  };
  Lib.add = async function (song) {
    const rec = await S.add(song);
    W.app.openSong(rec.id);
    if (Lib.redraw && UI.dialogOpen()) Lib.redraw();
    return { ok: true, id: rec.id };
  };

  Lib.review = function (song, resolve) {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    const isMidi = song.source === 'midi';
    const title = h('input', { class: 'ds-input', value: song.title, 'aria-label': 'Title' });
    const composer = h('input', { class: 'ds-input', value: song.composer || '', 'aria-label': 'Composer' });
    const bpm0 = song.tempos[0].bpm;
    const tempo = h('input', { class: 'ds-input', type: 'number', min: '20', max: '320', step: '1', value: String(Math.round(bpm0)), 'aria-label': 'Tempo in beats per minute' });
    const fifths0 = song.keySigs.length ? song.keySigs[0].fifths : song.estKey != null ? song.estKey : U.estimateKey(song.notes);
    const keySel = h('select', { class: 'ds-input', 'aria-label': 'Key' }, Object.keys(KEY_NAMES).map(Number).sort((a, b) => a - b).map((f) => h('option', { value: String(f), selected: f === fifths0 ? true : null }, KEY_NAMES[f])));
    const ts0 = song.timeSigs[0];
    const tsOpts = ['2/4', '3/4', '4/4', '5/4', '6/8', '9/8', '12/8', '2/2', '3/8'];
    if (!tsOpts.includes(ts0.num + '/' + ts0.den)) tsOpts.unshift(ts0.num + '/' + ts0.den);
    const tsSel = h('select', { class: 'ds-input', 'aria-label': 'Time signature' }, tsOpts.map((t) => h('option', { value: t, selected: t === ts0.num + '/' + ts0.den ? true : null }, t)));
    if (!isMidi) { keySel.disabled = true; tsSel.disabled = true; }
    const fromWhere = song.source === 'pdf' ? 'Read from the PDF' : 'From the file';
    const facts = h('dl', { class: 'facts' });
    const handsInfo = h('div', { class: 'review-hands' });
    const preview = h('div', { class: 'review-preview' });
    const warnBox = h('div', { class: 'review-warn' });
    let split = 60;

    const rebuildNotation = () => { song.notation = song.exactNotation ? song.notation : W.notation.fromNotes(song); };
    const drawFacts = () => {
      facts.textContent = '';
      const add = (k, v) => facts.append(h('dt', { text: k }), h('dd', { text: v }));
      add('Bars', String(song.measures.length));
      add('Notes', String(song.notes.length) + ' (' + song.notes.filter((n) => n.hand === 'R').length + ' right, ' + song.notes.filter((n) => n.hand === 'L').length + ' left)');
      if (song.tempos.length > 1) add('Tempo changes', String(song.tempos.length - 1));
      if (song.timeSigs.length > 1) add('Time signature changes', String(song.timeSigs.length - 1));
      if (song.pdfReport) add('Read from the PDF', song.pdfReport.pages + (song.pdfReport.pages === 1 ? ' page, ' : ' pages, ') + song.pdfReport.systems + (song.pdfReport.systems === 1 ? ' system' : ' systems'));
      add('Notation', song.source === 'pdf' ? 'Rebuilt from the PDF' : song.exactNotation ? 'From the MusicXML file' : 'Approximate (worked out from the notes)');
    };
    const drawHands = () => {
      handsInfo.textContent = '';
      const from = { staves: 'From the two staves in the file.', parts: 'From the two parts in the file (first part = right hand).', tracks: 'From the tracks in the file.', guessed: 'Guessed from pitch. Please check them.' }[song.handsFrom || (song.handsGuessed ? 'guessed' : 'tracks')];
      handsInfo.append(h('div', { class: 'ds-label', text: 'Hands' }), h('div', { class: song.handsGuessed ? 'ds-help is-warn' : 'ds-help' }, song.handsGuessed ? UI.icon('alert') : null, from));
      if (song.handsGuessed) {
        const out = h('span', { class: 'ds-caption slider-val' });
        const setOut = () => { const sp = U.spellInKey(split, fifths0); out.textContent = 'Right hand from ' + U.spell(sp.letter, sp.alter, sp.oct) + ' up'; };
        const inp = h('input', { type: 'range', class: 'range', min: '36', max: '84', step: '1', value: String(split), 'aria-label': 'Split point between the hands' });
        inp.style.setProperty('--fill', ((split - 36) / 48) * 100 + '%');
        inp.addEventListener('input', () => { split = +inp.value; inp.style.setProperty('--fill', ((split - 36) / 48) * 100 + '%'); setOut(); });
        inp.addEventListener('change', () => { song.notes.forEach((n) => { n.hand = n.midi >= split ? 'R' : 'L'; }); U.sortNotes(song.notes); rebuildNotation(); drawFacts(); drawPreview(); });
        setOut();
        handsInfo.append(
          h('div', { class: 'row-between' }, h('span', { class: 'ds-label', text: 'Split point' }), out), inp,
          h('div', null, h('button', { class: 'ds-btn ds-btn--outline', type: 'button', onclick: () => { song.notes.forEach((n) => { n.hand = n.hand === 'R' ? 'L' : 'R'; }); U.sortNotes(song.notes); rebuildNotation(); drawFacts(); drawPreview(); } }, 'Swap hands')));
      }
    };
    const drawPreview = () => {
      preview.textContent = '';
      const w = Math.max(320, (preview.clientWidth || 640) - 2);
      preview.append(W.sheet.preview(song, w, 9));
    };
    const drawWarn = () => {
      warnBox.textContent = '';
      for (const m of song.warnings || []) warnBox.append(h('div', { class: 'ds-help is-warn' }, UI.icon('alert'), m));
    };
    if (isMidi) {
      keySel.addEventListener('change', () => {
        const f = +keySel.value;
        song.keySigs = [{ q: 0, fifths: f }];
        song.notes.forEach((n) => { const sp = U.spellInKey(n.midi, f); n.spelled = U.spell(sp.letter, sp.alter, sp.oct); });
        rebuildNotation(); drawPreview();
      });
      tsSel.addEventListener('change', () => {
        const [num, den] = tsSel.value.split('/').map(Number);
        song.timeSigs = [{ q: 0, num, den }];
        const end = song.notes.reduce((m, n) => Math.max(m, n.q + n.durQ), 0);
        song.measures = W.midi.buildMeasures(song.timeSigs, end);
        rebuildNotation(); drawFacts(); drawPreview();
      });
    }
    const field = (label, ctl, hint) => h('label', { class: 'ds-field' }, h('span', { class: 'ds-label', text: label }), ctl, hint ? h('span', { class: 'ds-help', text: hint }) : null);
    const body = h('div', { class: 'review' },
      h('div', { class: 'review-grid' },
        field('Title', title), field('Composer', composer),
        field('Key', keySel, isMidi ? null : fromWhere), field('Time signature', tsSel, isMidi ? (song.timeSigs.length > 1 ? 'Changes later in the piece are kept.' : null) : fromWhere),
        field('Tempo (BPM)', tempo)),
      facts, song.pdfXml ? h('div', null, h('button', { class: 'ds-btn ds-btn--outline', type: 'button', onclick: () => download(fileSafe(title.value || song.title) + '.musicxml', song.pdfXml, 'application/vnd.recordare.musicxml+xml') }, UI.icon('download'), 'Download MusicXML')) : null,
      handsInfo, warnBox,
      h('div', { class: 'ds-label', text: 'First bars' }), preview);
    const add = async () => {
      song.title = title.value.trim() || song.title;
      song.composer = composer.value.trim();
      const bpm = Math.max(20, Math.min(320, Number(tempo.value) || bpm0));
      if (Math.abs(bpm - bpm0) > 0.01) { const k = bpm / bpm0; song.tempos.forEach((t) => { t.bpm = Math.round(t.bpm * k * 100) / 100; }); }
      const r = await Lib.add(song);
      UI.toast('Added "' + song.title + '" to your library.');
      finish(r);
    };
    UI.openDialog('Check the import', body, [{ label: 'Cancel', run: () => finish({ ok: false, error: 'Cancelled' }) }, { label: 'Add to library', primary: true, run: add }], { cls: 'dialog--wide', onClose: () => finish({ ok: false, error: 'Cancelled' }), focus: '.dialog-actions .ds-btn--primary' });
    drawFacts(); drawHands(); drawWarn();
    requestAnimationFrame(drawPreview);
  };

  // ---------------------------------------------------------------- PDF helper
  Lib.pdfHelp = function (name, reason) {
    const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer', class: 'ds-btn ds-btn--link' }, text);
    UI.openDialog('This PDF could not be read', h('div', { class: 'pdf-help' },
      reason ? h('div', { class: 'ds-alert', role: 'alert' }, UI.icon('alert'), h('span', { text: reason })) : null,
      h('p', { class: 'ds-reading', text: 'The app reads PDFs exported from notation software such as MuseScore, Dorico or Finale. A scanned PDF is a picture of the music: convert it to MusicXML first, then import that file here.' }),
      h('ul', { class: 'pdf-tools' },
        h('li', null, link('https://github.com/Audiveris/audiveris', 'Audiveris'), h('span', { class: 'ds-caption', text: 'Free program for Windows. Works offline.' })),
        h('li', null, link('https://acestudio.ai/pdf-to-musicxml/', 'ACE Studio online converter'), h('span', { class: 'ds-caption', text: 'Free tier. The PDF is uploaded to that company.' }))),
      h('p', { class: 'ds-caption', text: 'Any tool that exports MusicXML works.' + (name ? ' File: ' + name : '') })),
      [{ label: 'Close' }, { label: 'Import MusicXML', primary: true, run: () => Lib.pickAndImport() }]);
  };

  // ---------------------------------------------------------------- backup and restore
  const BACKUP_KIND = 'marksteady-wapiro-backup';
  Lib.backup = function () {
    const data = { kind: BACKUP_KIND, version: 2, app: U.VERSION, exported: new Date().toISOString(),
      songs: sorted().map((r) => ({ id: r.id, order: r.order, best: r.best, prefs: r.prefs, original: r.original || null, song: r.song })), settings: S.settings };
    download('MarkSteady Wapiro backup ' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(data), 'application/json');
    UI.toast('Saved a backup of ' + data.songs.length + ' songs.');
  };
  function validSong(s) {
    return s && typeof s === 'object' && typeof s.title === 'string' && Array.isArray(s.notes) && Array.isArray(s.measures) && s.measures.length > 0 &&
      Array.isArray(s.tempos) && s.tempos.length > 0 && Array.isArray(s.timeSigs) && s.timeSigs.length > 0 &&
      s.notes.every((n) => n && isFinite(n.q) && isFinite(n.durQ) && n.midi >= 21 && n.midi <= 108);
  }
  Lib.parseBackup = function (text) {
    let o;
    try { o = JSON.parse(text); } catch (e) { throw new Error('This file is not a backup (it is not valid JSON).'); }
    if (!o || o.kind !== BACKUP_KIND || !Array.isArray(o.songs)) throw new Error('This file is not a MarkSteady Wapiro backup.');
    if (o.version > 2) throw new Error('This backup comes from a newer version of the app.');
    const good = [], bad = [];
    for (const r of o.songs) (r && validSong(r.song) && typeof r.id === 'string' ? good : bad).push(r);
    return { songs: good, skipped: bad.length };
  };
  Lib.restore = function () {
    pickFile('.json,application/json', async (f) => {
      let parsed;
      try { parsed = Lib.parseBackup(await f.text()); } catch (e) { UI.openDialog('Could not restore', h('div', { class: 'ds-alert ds-alert--danger', role: 'alert' }, UI.icon('alert'), h('span', { text: e.message }))); return; }
      const ids = new Set(S.records.map((r) => r.id));
      const adds = parsed.songs.filter((r) => !ids.has(r.id)).length, reps = parsed.songs.length - adds;
      const keep = S.records.filter((r) => !parsed.songs.some((x) => x.id === r.id)).length;
      const parts = [];
      if (adds) parts.push('Adds ' + adds + (adds === 1 ? ' song' : ' songs'));
      if (reps) parts.push((parts.length ? 'replaces ' : 'Replaces ') + reps);
      const summary = (parts.join(', ') || 'Changes nothing') + '. ' + (keep ? 'Your other ' + keep + (keep === 1 ? ' song stays.' : ' songs stay.') : '') + (parsed.skipped ? ' ' + parsed.skipped + ' damaged ' + (parsed.skipped === 1 ? 'entry is' : 'entries are') + ' skipped.' : '');
      UI.openDialog('Restore backup', h('p', { class: 'ds-reading', text: summary }), [{ label: 'Cancel' }, { label: 'Restore', primary: true, run: async () => {
        let order = S.records.reduce((m, r) => Math.max(m, r.order), 0);
        for (const r of parsed.songs) {
          const old = S.find(r.id);
          const rec = { id: r.id, order: old ? old.order : ++order, best: r.best == null ? null : r.best, prefs: r.prefs || null, original: r.original || null, song: Object.assign({ warnings: [], keySigs: [] }, r.song, { id: r.id }) };
          if (!rec.song.notation) rec.song.notation = W.notation.fromNotes(rec.song);
          if (old) S.records[S.records.indexOf(old)] = rec; else S.records.push(rec);
          await S.writeRecord(rec);
        }
        if (E.song && parsed.songs.some((r) => r.id === E.song.id)) W.app.openSong(E.song.id);
        UI.toast('Restored ' + parsed.songs.length + (parsed.songs.length === 1 ? ' song.' : ' songs.'));
      } }]);
    });
  };

  // ---------------------------------------------------------------- version 1 library
  const V1_KEY = 'marksteady_wapiro_v1_library';
  const V1_STARTERS = ['beethoven_ode', 'bach_minuet_g', 'bach_prelude_c', 'satie_gymnopedie_1', 'chopin_prelude_em', 'mozart_twinkle'];
  /** Convert the user's own version 1 songs once. The old storage key is left untouched. */
  Lib.migrateV1 = async function () {
    if (S.settings.v1Done) return 0;
    let raw = null;
    try { raw = localStorage.getItem(V1_KEY); } catch (e) { return 0; }
    S.settings.v1Done = true; S.saveSettings();
    if (!raw) return 0;
    let list;
    try { list = JSON.parse(raw); } catch (e) { UI.toast('Your version 1 library could not be read, so it was not converted.', 'error'); return 0; }
    if (!Array.isArray(list)) return 0;
    let added = 0;
    for (const v of list) {
      if (!v || V1_STARTERS.includes(v.id) || !Array.isArray(v.notes) || !v.notes.length) continue;
      const num = Math.max(1, Math.min(12, parseInt(v.beatsPerMeasure, 10) || 4));
      const raw2 = v.notes.filter((n) => n && isFinite(n.beat) && isFinite(n.duration) && n.midi >= 21 && n.midi <= 108);
      if (!raw2.length) continue;
      const fifths = U.estimateKey(raw2.map((n) => ({ midi: n.midi, durQ: Number(n.duration) })));
      const notes = raw2.map((n) => { const sp = U.spellInKey(n.midi, fifths); return { q: Number(n.beat), durQ: Math.max(0.0625, Number(n.duration)), midi: n.midi, hand: n.hand === 'L' ? 'L' : 'R', spelled: U.spell(sp.letter, sp.alter, sp.oct) }; });
      U.sortNotes(notes);
      const end = notes.reduce((m, n) => Math.max(m, n.q + n.durQ), 0);
      const song = { id: '', title: String(v.title || 'Song from version 1'), composer: String(v.composer || ''), source: 'v1', exactNotation: false, handsGuessed: false, handsFrom: 'tracks',
        tempos: [{ q: 0, bpm: Math.max(20, Math.min(320, Number(v.bpm) || 100)) }], timeSigs: [{ q: 0, num, den: 4 }], keySigs: [], estKey: fifths,
        measures: W.midi.buildMeasures([{ q: 0, num, den: 4 }], end), notes, notation: null, warnings: ['Converted from version 1. The notation is worked out from the notes.'] };
      song.notation = W.notation.fromNotes(song);
      await S.add(song); added++;
    }
    if (added) UI.toast('Converted ' + added + (added === 1 ? ' song' : ' songs') + ' from version 1 into your library.');
    return added;
  };

  // ---------------------------------------------------------------- drop files anywhere
  Lib.bindDrop = function (root) {
    let depth = 0;
    const veil = h('div', { class: 'drop-veil', 'aria-hidden': 'true' }, h('div', { class: 'drop-card ds-card' }, UI.icon('upload'), h('span', { class: 'ds-control-text', text: 'Drop a MusicXML or MIDI file to import it' })));
    const show = (v) => { if (v) { if (!veil.isConnected) root.appendChild(veil); } else veil.remove(); };
    const hasFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
    window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; depth++; show(true); e.preventDefault(); });
    window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) show(false); });
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth = 0; show(false);
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) Lib.importFile(f);
    });
  };
})();
