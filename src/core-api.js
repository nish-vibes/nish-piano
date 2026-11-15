/* Public core API: window.WapiroCore. */
(function () {
  'use strict';
  const W = window.Wapiro, U = W.util, N = W.notation;

  const PDF_MSG = 'Convert it to MusicXML with a tool such as Audiveris, then import that file here.';

  function decodeText(u8) {
    if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8.subarray(2));
    if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8.subarray(2));
    return new TextDecoder('utf-8').decode(u8).replace(/^﻿/, '');
  }

  function finish(song) {
    if (!song.notation) song.notation = N.fromNotes(song);
    if (!song.warnings) song.warnings = [];
    return song;
  }

  async function importFile(fileName, buffer) {
    const name = String(fileName || 'Untitled');
    const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (!u8.length) throw new Error('This file is empty.');
    const ext = (/\.([A-Za-z0-9]+)$/.exec(name) || [, ''])[1].toLowerCase();
    const sig4 = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
    if (sig4 === '%PDF' || ext === 'pdf') {
      if (sig4 !== '%PDF') throw new Error('This file is not a PDF. ' + PDF_MSG);
      let res;
      try { res = await W.pdf.read(u8, name); } catch (e) { const err = new Error(((e && e.message) || String(e)) + (/MusicXML/.test(e && e.message) ? '' : ' ' + PDF_MSG)); err.pdf = true; err.code = e && e.code; throw err; }
      const song = W.musicxml.parse(res.xml, name);
      song.source = 'pdf';
      song.pdfXml = res.xml;
      song.pdfReport = { pages: res.report.pages, systems: res.report.systems, measures: res.report.measures, notes: res.report.notes };
      song.warnings = res.report.warnings.concat(song.warnings || []);
      return finish(song);
    }
    if (u8[0] === 0x50 && u8[1] === 0x4b && u8[2] === 3 && u8[3] === 4) {
      const text = await W.musicxml.mxlToText(u8);
      return finish(W.musicxml.parse(text, name));
    }
    if (sig4 === 'MThd') return finish(W.midi.parse(u8, name));
    // Look for XML in the first bytes
    const head = decodeText(u8.subarray(0, Math.min(u8.length, 2048)));
    if (/^\s*<\?xml|^\s*<!DOCTYPE|^\s*<score-/i.test(head) || /<score-(partwise|timewise)/.test(head)) return finish(W.musicxml.parse(decodeText(u8), name));
    if (ext === 'mid' || ext === 'midi') throw new Error('This is not a MIDI file (it does not start with MThd).');
    if (ext === 'mxl') throw new Error('This is not a compressed MusicXML file (.mxl).');
    if (ext === 'musicxml' || ext === 'xml') throw new Error('This file is not valid MusicXML.');
    throw new Error('This file type is not supported. Import MusicXML (.musicxml, .xml, .mxl) or MIDI (.mid).');
  }

  function exportMidi(song) { return W.midi.exportMidi(song); }

  W.core = { importFile, exportMidi, PDF_MSG, finish };
  window.WapiroCore = { importFile, exportMidi };
})();
