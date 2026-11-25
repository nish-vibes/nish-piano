/* A small MP4 (ISO BMFF) writer for the video export: one H.264 video track and one AAC or Opus audio track,
   from WebCodecs encoder output. The file is laid out as ftyp, mdat, moov; every sample is its own chunk.
   SPDX-License-Identifier: GPL-3.0-or-later */
(function () {
  'use strict';
  const W = window.Wapiro;
  const M = (W.mp4 = {});

  // ---------------------------------------------------------------- bytes
  const u8 = (n) => [n & 255];
  const u16 = (n) => [(n >> 8) & 255, n & 255];
  const u24 = (n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const str = (s) => Array.from(s, (c) => c.charCodeAt(0));
  const flat = (parts) => {
    let len = 0; for (const p of parts) len += p.length;
    const out = new Uint8Array(len); let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  };
  const bytes = (x) => (x instanceof Uint8Array ? x : x instanceof ArrayBuffer ? new Uint8Array(x) : ArrayBuffer.isView(x) ? new Uint8Array(x.buffer, x.byteOffset, x.byteLength) : Uint8Array.from(x));
  /** A box: type + children (arrays of numbers or Uint8Arrays). */
  function box(type, ...kids) {
    const body = flat(kids.map(bytes));
    return flat([Uint8Array.from([...u32(body.length + 8), ...str(type)]), body]);
  }
  const full = (type, version, flags, ...kids) => box(type, [version, ...u24(flags)], ...kids);
  const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].flatMap(u32);

  // ---------------------------------------------------------------- tables
  /** run-length time-to-sample table from per-sample durations */
  function stts(durs) {
    const runs = [];
    for (const d of durs) { const r = runs[runs.length - 1]; if (r && r[1] === d) r[0]++; else runs.push([1, d]); }
    return full('stts', 0, 0, u32(runs.length), runs.flatMap(([c, d]) => [...u32(c), ...u32(d)]));
  }
  const stsz = (sizes) => full('stsz', 0, 0, u32(0), u32(sizes.length), sizes.flatMap(u32));
  const stsc = () => full('stsc', 0, 0, u32(1), u32(1), u32(1), u32(1));   // one sample per chunk
  const stco = (offs) => full('stco', 0, 0, u32(offs.length), offs.flatMap(u32));
  const co64 = (offs) => full('co64', 0, 0, u32(offs.length), offs.flatMap((o) => [...u32(Math.floor(o / 4294967296)), ...u32(o >>> 0)]));
  const dinf = () => box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1)));
  const hdlr = (type, name) => full('hdlr', 0, 0, u32(0), str(type), u32(0), u32(0), u32(0), str(name), [0]);
  const mdhd = (scale, dur) => full('mdhd', 0, 0, u32(0), u32(0), u32(scale), u32(dur), u16(0x55c4), u16(0));   // language "und"
  const tkhd = (id, dur, audio, w, hgt) => full('tkhd', 0, 3, u32(0), u32(0), u32(id), u32(0), u32(dur), u32(0), u32(0), u16(0), u16(audio ? 1 : 0), u16(audio ? 0x0100 : 0), u16(0), MATRIX, u32(w * 65536), u32(hgt * 65536));

  // ---------------------------------------------------------------- sample entries
  function avc1(w, hgt, avcC) {
    return box('avc1', new Array(6).fill(0), u16(1), new Array(16).fill(0), u16(w), u16(hgt), u32(0x00480000), u32(0x00480000), u32(0), u16(1),
      new Array(32).fill(0), u16(0x0018), u16(0xffff), box('avcC', avcC));
  }
  function audioEntry(type, channels, rate, ...kids) {
    return box(type, new Array(6).fill(0), u16(1), new Array(8).fill(0), u16(channels), u16(16), u16(0), u16(0), u32(rate * 65536), ...kids);
  }
  /** esds for AAC: ES descriptor with the AudioSpecificConfig */
  function esds(asc, bitrate) {
    const desc = (tag, body) => [tag, 0x80, 0x80, 0x80, body.length, ...body];
    const dsi = desc(0x05, Array.from(asc));
    const dcd = desc(0x04, [0x40, 0x15, ...u24(0), ...u32(bitrate), ...u32(bitrate), ...dsi]);
    const es = desc(0x03, [...u16(1), 0, ...dcd, ...desc(0x06, [0x02])]);
    return full('esds', 0, 0, es);
  }
  /** dOps for Opus, from the encoder's OpusHead (or defaults) */
  function dOps(head, channels, rate) {
    let preSkip = 312, inRate = rate, gain = 0;
    if (head && head.length >= 19 && String.fromCharCode(...head.slice(0, 8)) === 'OpusHead') {
      preSkip = head[10] | (head[11] << 8);
      inRate = (head[12] | (head[13] << 8) | (head[14] << 16) | (head[15] << 24)) >>> 0;
      gain = head[16] | (head[17] << 8);
    }
    return box('dOps', [0, channels], u16(preSkip), u32(inRate), u16(gain), [0]);
  }
  M.opusPreSkip = (head) => (head && head.length >= 12 && String.fromCharCode(...head.slice(0, 8)) === 'OpusHead' ? head[10] | (head[11] << 8) : 312);

  /**
   * Build the file.
   * video: { width, height, timescale, avcC (Uint8Array), samples: [{ data: Uint8Array, dur, key }] }
   * audio: { codec: 'aac'|'opus', rate, channels, bitrate, config (Uint8Array: AudioSpecificConfig or OpusHead), samples: [{ data, dur }] }
   * Returns a Blob (video/mp4).
   */
  M.build = function (video, audio) {
    const vs = video.samples, as = audio ? audio.samples : [];
    const ftyp = box('ftyp', str('isom'), u32(512), str('isom'), str('iso2'), str('avc1'), str('mp41'));
    // mdat: video samples, then audio samples (players handle this fine; one chunk per sample keeps offsets exact)
    let size = 0; for (const s of vs) size += s.data.length; for (const s of as) size += s.data.length;
    const big = size + 16 > 0xffffffff;
    const mdatHead = big ? Uint8Array.from([...u32(1), ...str('mdat'), ...u32(Math.floor((size + 16) / 4294967296)), ...u32((size + 16) >>> 0)]) : Uint8Array.from([...u32(size + 8), ...str('mdat')]);
    let off = ftyp.length + mdatHead.length;
    const vOff = vs.map((s) => { const o = off; off += s.data.length; return o; });
    const aOff = as.map((s) => { const o = off; off += s.data.length; return o; });
    const chunkTable = (offs) => (off > 0xffffffff ? co64(offs) : stco(offs));

    const vDur = vs.reduce((t, s) => t + s.dur, 0);
    const movieScale = 1000, vMovie = Math.round((vDur * movieScale) / video.timescale);
    const keys = []; vs.forEach((s, i) => { if (s.key) keys.push(i + 1); });
    const vtrak = box('trak',
      tkhd(1, vMovie, false, video.width, video.height),
      box('mdia', mdhd(video.timescale, vDur), hdlr('vide', 'NiSH MarkSteady Piano video'),
        box('minf', full('vmhd', 0, 1, u16(0), u16(0), u16(0), u16(0)), dinf(),
          box('stbl', full('stsd', 0, 0, u32(1), avc1(video.width, video.height, video.avcC)), stts(vs.map((s) => s.dur)),
            full('stss', 0, 0, u32(keys.length), keys.flatMap(u32)), stsc(), stsz(vs.map((s) => s.data.length)), chunkTable(vOff)))));
    const traks = [vtrak];
    let aMovie = 0;
    if (audio && as.length) {
      const aDur = as.reduce((t, s) => t + s.dur, 0);
      aMovie = Math.round((aDur * movieScale) / audio.rate);
      const entry = audio.codec === 'opus'
        ? audioEntry('Opus', audio.channels, audio.rate, dOps(audio.config, audio.channels, audio.rate))
        : audioEntry('mp4a', audio.channels, audio.rate, esds(audio.config, audio.bitrate || 192000));
      traks.push(box('trak',
        tkhd(2, aMovie, true, 0, 0),
        box('mdia', mdhd(audio.rate, aDur), hdlr('soun', 'NiSH MarkSteady Piano sound'),
          box('minf', full('smhd', 0, 0, u16(0), u16(0)), dinf(),
            box('stbl', full('stsd', 0, 0, u32(1), entry), stts(as.map((s) => s.dur)), stsc(), stsz(as.map((s) => s.data.length)), chunkTable(aOff))))));
    }
    const mvhd = full('mvhd', 0, 0, u32(0), u32(0), u32(movieScale), u32(Math.max(vMovie, aMovie)), u32(0x00010000), u16(0x0100), u16(0), u32(0), u32(0), MATRIX, new Array(24).fill(0), u32(traks.length + 1));
    const moov = box('moov', mvhd, ...traks);
    return new Blob([ftyp, mdatHead, ...vs.map((s) => s.data), ...as.map((s) => s.data), moov], { type: 'video/mp4' });
  };
})();
