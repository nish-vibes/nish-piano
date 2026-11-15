/* Scans and photos of printed sheet music (PNG, JPG, image-only PDFs).
 * 1. Prepare: get every page at full resolution, measure the staff-line spacing, enlarge until the lines are about
 *    20 px apart (what the recognition engine expects), grey-scale, stretch contrast, sharpen.
 * 2. Check: show each page with a plain quality verdict before anything is read.
 * 3. Read: the desktop app runs the bundled Audiveris engine on the prepared pages and returns MusicXML.
 *    In a browser there is no engine: the prepared pages can be downloaded instead.
 * 4. The MusicXML goes through the normal import review, with the original page beside the result.
 */
(function () {
  'use strict';
  const W = window.Wapiro, UI = W.ui, h = UI.h, U = W.util;
  const SC = (W.scan = {});
  const TARGET = 20, MAX_SIDE = 6000, MAX_PAGES = 30;

  SC.isImage = (name, u8) => /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i.test(name) ||
    (u8[0] === 0x89 && u8[1] === 0x50) || (u8[0] === 0xff && u8[1] === 0xd8) || (u8[0] === 0x52 && u8[1] === 0x49 && u8[8] === 0x57);
  /** The desktop app exposes window.wapiroDesktop with an omr() function; the browser build has none. */
  SC.engine = () => (window.wapiroDesktop && typeof window.wapiroDesktop.omr === 'function' ? window.wapiroDesktop : null);

  // ---------------------------------------------------------------- measuring
  /** Staff-line spacing and thickness from vertical run lengths (the method Audiveris itself uses). */
  SC.measure = function (gray, w, hgt) {
    const thr = otsu(gray);
    const combo = new Uint32Array(200), black = new Uint32Array(60);
    const step = Math.max(1, Math.floor(w / 400));
    for (let x = 0; x < w; x += step) {
      let run = 0, isB = gray[x] < thr, lastWhite = -1;
      for (let y = 0; y <= hgt; y++) {
        const b = y < hgt ? gray[y * w + x] < thr : !isB;
        if (b === isB) { run++; continue; }
        if (isB) { if (run < 60) black[run]++; if (lastWhite > 0 && lastWhite + run < 200) combo[lastWhite + run]++; }
        else lastWhite = run;
        isB = b; run = 1;
      }
    }
    const peak = (arr, lo) => { let best = lo, bv = 0; for (let i = lo; i < arr.length; i++) if (arr[i] > bv) { bv = arr[i]; best = i; } return { at: best, n: bv }; };
    const line = peak(black, 1), inter = peak(combo, 3);
    return { interline: inter.n > 20 ? inter.at : null, line: line.at, threshold: thr };
  };
  function otsu(g) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < g.length; i++) hist[g[i]]++;
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sB = 0, wB = 0, best = 0, thr = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue;
      const wF = g.length - wB; if (!wF) break;
      sB += t * hist[t];
      const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; thr = t; }
    }
    return thr;
  }
  function grayOf(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data, g = new Uint8ClampedArray(canvas.width * canvas.height);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 * (d[i + 3] / 255) + 255 * (1 - d[i + 3] / 255);
    return g;
  }
  const canvasOf = (w, hgt) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(hgt)); return c; };

  /** Enlarge in steps of at most 2x (sharper than one big jump), then grey-scale, stretch contrast and sharpen. */
  function enlarge(src, factor) {
    let cur = src, f = factor;
    while (f > 1.001) {
      const s = Math.min(2, f);
      const c = canvasOf(cur.width * s, cur.height * s), x = c.getContext('2d');
      x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height);
      x.drawImage(cur, 0, 0, c.width, c.height);
      cur = c; f /= s;
    }
    if (cur === src) { const c = canvasOf(src.width, src.height); c.getContext('2d').drawImage(src, 0, 0); cur = c; }
    clean(cur);
    return cur;
  }
  function clean(c) {
    const ctx = c.getContext('2d', { willReadFrequently: true }), w = c.width, hgt = c.height;
    const img = ctx.getImageData(0, 0, w, hgt), d = img.data;
    const g = new Float32Array(w * hgt);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    // contrast stretch between the 1st and 99th percentile
    const hist = new Uint32Array(256); for (let j = 0; j < g.length; j++) hist[g[j] | 0]++;
    let lo = 0, hi = 255, acc = 0; for (; lo < 255; lo++) { acc += hist[lo]; if (acc > g.length * 0.01) break; }
    acc = 0; for (; hi > 0; hi--) { acc += hist[hi]; if (acc > g.length * 0.01) break; }
    const span = Math.max(1, hi - lo);
    // unsharp mask (3x3 box blur), amount 0.8
    const out = new Uint8ClampedArray(g.length);
    for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= hgt) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; s += g[yy * w + xx]; n++; } }
      const v = g[y * w + x] + 0.8 * (g[y * w + x] - s / n);
      const t = (v - lo) / span;
      out[y * w + x] = 255 / (1 + Math.exp(-(t - 0.55) * 9));
    }
    for (let i = 0, j = 0; j < out.length; i += 4, j++) { d[i] = d[i + 1] = d[i + 2] = out[j]; d[i + 3] = 255; }
    ctx.putImageData(img, 0, 0);
  }

  // ---------------------------------------------------------------- getting the pages
  async function pagesFromImage(buffer, name) {
    const blob = new Blob([buffer]);
    let bmp;
    try { bmp = await createImageBitmap(blob); } catch (e) { throw new Error('"' + name + '" could not be opened as an image. Use PNG or JPG.'); }
    const c = canvasOf(bmp.width, bmp.height); c.getContext('2d').drawImage(bmp, 0, 0);
    return [{ canvas: c, source: 'image' }];
  }
  /** Each page of an image PDF: if a page holds one big image, take its pixels as they are; otherwise render the page. */
  async function pagesFromPdf(u8) {
    const lib = await W.pdf.lib();
    const doc = await lib.getDocument({ data: u8.slice(), isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
    const out = [];
    for (let p = 1; p <= Math.min(doc.numPages, MAX_PAGES); p++) {
      const page = await doc.getPage(p);
      const vp1 = page.getViewport({ scale: 1 });
      // render at a scale that keeps the embedded image's own resolution (a 510 px wide image on an A4 page is about 0.86x)
      const ops = await page.getOperatorList();
      let imgW = 0;
      for (let i = 0; i < ops.fnArray.length; i++) {
        if (ops.fnArray[i] === lib.OPS.paintImageXObject || ops.fnArray[i] === lib.OPS.paintInlineImageXObject) {
          const id = ops.argsArray[i][0];
          const obj = typeof id === 'string' ? await new Promise((res) => { try { page.objs.get(id, res); } catch (e) { res(null); } }) : id;
          if (obj && obj.width) imgW = Math.max(imgW, obj.width);
        }
      }
      const scale = imgW ? Math.min(4, Math.max(0.5, imgW / vp1.width)) : 2;
      const vp = page.getViewport({ scale });
      const c = canvasOf(vp.width, vp.height), ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      out.push({ canvas: c, source: 'pdf', imgW });
    }
    if (doc.numPages > MAX_PAGES) out.truncated = doc.numPages;
    return out;
  }

  /** Prepare all pages: measure, enlarge, clean. Returns [{ original, prepared, interline, factor, verdict }]. */
  SC.prepare = async function (name, buffer) {
    const u8 = new Uint8Array(buffer);
    const isPdf = u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46;
    const pages = isPdf ? await pagesFromPdf(u8) : await pagesFromImage(buffer, name);
    const out = [];
    for (const pg of pages) {
      const src = pg.canvas;
      const m = SC.measure(grayOf(src), src.width, src.height);
      let factor = m.interline ? TARGET / m.interline : 1;
      factor = Math.max(1, Math.min(factor, 8, MAX_SIDE / Math.max(src.width, src.height)));
      const prepared = enlarge(src, factor);
      const after = m.interline ? m.interline * factor : null;
      const verdict = !m.interline ? 'none' : m.interline >= 14 ? 'good' : m.interline >= 8 ? 'fair' : 'poor';
      out.push({ original: src, prepared, interline: m.interline, line: m.line, factor, after, verdict });
    }
    out.truncated = pages.truncated || 0;
    return out;
  };

  const VERDICT = {
    good: ['check', 'Good', 'The staff lines are clear. Expect few corrections.'],
    fair: ['alert', 'Fair', 'Small print. Expect some corrections.'],
    poor: ['alert', 'Low resolution', 'The music is very small in this image. The page was enlarged, but expect many corrections. A sharper scan (300 dpi) reads much better.'],
    none: ['alert', 'No staff found', 'No five-line staff was found on this page. Is it sheet music, and is the page the right way up?'],
  };

  // ---------------------------------------------------------------- the dialog
  /** Open the scan flow. Resolves with the import result ({ ok, id } or { ok: false, error }). */
  SC.open = function (name, buffer) {
    return new Promise(async (resolve) => {
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      const status = h('div', { class: 'ds-help', role: 'status', text: 'Preparing the pages…' });
      const body = h('div', { class: 'scan' }, status);
      UI.openDialog('Read a scan', body, null, { cls: 'dialog--wide', onClose: () => done({ ok: false, error: 'Cancelled' }) });
      let pages;
      try { pages = await SC.prepare(name, buffer); }
      catch (e) { status.className = 'ds-help is-error'; status.textContent = (e && e.message) || String(e); return; }
      const engine = SC.engine();
      body.textContent = '';
      const grid = h('div', { class: 'scan-pages' });
      pages.forEach((p, i) => {
        const [icon, word, text] = VERDICT[p.verdict];
        const thumb = p.original.cloneNode ? copyCanvas(p.original, 220) : null;
        grid.append(h('figure', { class: 'scan-page' }, thumb,
          h('figcaption', null,
            h('div', { class: 'scan-verdict is-' + p.verdict }, UI.icon(icon), h('span', { class: 'ds-control-text', text: 'Page ' + (i + 1) + ': ' + word })),
            h('div', { class: 'ds-caption', text: p.interline ? 'Staff lines ' + p.interline + ' px apart' + (p.factor > 1.01 ? ', enlarged ' + (Math.round(p.factor * 10) / 10) + '× to ' + Math.round(p.after) + ' px.' : '.') : '' }),
            h('div', { class: 'ds-caption', text }))));
      });
      const anyStaff = pages.some((p) => p.verdict !== 'none');
      const add = (...xs) => body.append(...xs.filter(Boolean));
      add(
        h('p', { class: 'ds-reading', text: pages.length === 1 ? 'Here is the page as the reader will see it.' : 'Here are the ' + pages.length + ' pages as the reader will see them.' }),
        pages.truncated ? h('div', { class: 'ds-help is-warn' }, UI.icon('alert'), 'Only the first ' + MAX_PAGES + ' of ' + pages.truncated + ' pages are read.') : null,
        grid,
        engine ? h('p', { class: 'ds-caption', text: 'Reading takes about 10 to 60 seconds per page. After that you check the result against the original, bar by bar.' })
          : h('div', { class: 'ds-alert' }, UI.icon('alert'), h('div', null, h('strong', { text: 'Reading scans needs the desktop app.' }),
            h('span', { text: 'The Windows app includes the Audiveris music reader. In the browser you can download the prepared pages and open them in Audiveris yourself, then import its MusicXML file here.' }))));
      const actions = h('div', { class: 'dialog-actions' },
        h('button', { class: 'ds-btn ds-btn--outline', type: 'button', onclick: () => { UI.closeDialog(); } }, 'Cancel'),
        h('button', { class: 'ds-btn ds-btn--outline', type: 'button', onclick: () => downloadPages(pages, name) }, UI.icon('download'), 'Download prepared pages'),
        engine && anyStaff ? h('button', { class: 'ds-btn ds-btn--primary', type: 'button', onclick: () => read() }, 'Read the music') : null);
      body.append(actions);
      const read = async () => {
        body.textContent = '';
        const prog = h('div', { class: 'ds-progress', role: 'progressbar', 'aria-label': 'Reading the music', 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('i', { style: 'width:4%' }));
        const msg = h('div', { class: 'ds-help', role: 'status', text: 'Reading page 1 of ' + pages.length + '…' });
        body.append(msg, prog, h('p', { class: 'ds-caption', text: 'You can keep this window open or close it; closing stops the reading.' }));
        try {
          const use = pages.filter((p) => p.verdict !== 'none');
          const pdf = await SC.pagesToPdf(use.map((p) => p.prepared));
          const res = await engine.omr({ name: U.cleanTitle(name), pdf, pages: use.length,
            onProgress: (k, n, text) => { msg.textContent = text || 'Reading page ' + k + ' of ' + n + '…'; prog.firstChild.style.width = Math.round(4 + 92 * Math.min(1, k / n)) + '%'; } });
          if (!res || !res.mxl || !res.mxl.length) throw new Error((res && res.error) || 'The reader found no music it could export. Try a sharper scan.');
          res.xml = await W.musicxml.mxlToText(new Uint8Array(res.mxl[0]));
          if (res.mxl.length > 1) res.warnings = (res.warnings || []).concat(['The reader split the score into ' + res.mxl.length + ' parts; only the first is shown.']);
          const song = W.musicxml.parse(res.xml, name);
          song.source = 'scan';
          song.scanPages = pages.map((p) => copyCanvas(p.original, 1400).toDataURL('image/jpeg', 0.8));
          song.scanXml = res.xml;
          song.warnings = ['Read from a scan by Audiveris. Check every bar against the original before you practise.'].concat(res.warnings || [], song.warnings || []);
          W.core.finish(song);
          UI.closeDialog();
          W.library.review(song, done);
        } catch (e) {
          body.textContent = '';
          body.append(h('div', { class: 'ds-alert ds-alert--danger', role: 'alert' }, UI.icon('alert'), h('div', null, h('strong', { text: 'The music could not be read.' }), h('span', { text: (e && e.message) || String(e) }))),
            h('div', { class: 'dialog-actions' }, h('button', { class: 'ds-btn ds-btn--outline', type: 'button', onclick: () => UI.closeDialog() }, 'Close')));
        }
      };
    });
  };
  function copyCanvas(src, maxW) {
    const k = Math.min(1, maxW / src.width), c = canvasOf(src.width * k, src.height * k), x = c.getContext('2d');
    x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, c.width, c.height); c.className = 'scan-thumb';
    return c;
  }
  const canvasBlob = (c, type, q) => new Promise((res) => c.toBlob(res, type, q));

  /** A minimal PDF with one JPEG per page at 300 dpi, so the reader keeps the pixels exactly as prepared. */
  SC.pagesToPdf = async function (canvases) {
    const enc = new TextEncoder(), parts = [], offs = [];
    let len = 0;
    const put = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
    const obj = (n, body) => { offs[n] = len; put(n + ' 0 obj\n'); body(); put('\nendobj\n'); };
    put('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
    const n = canvases.length, kids = [];
    for (let i = 0; i < n; i++) kids.push((3 + i * 3) + ' 0 R');
    obj(1, () => put('<< /Type /Catalog /Pages 2 0 R >>'));
    obj(2, () => put('<< /Type /Pages /Count ' + n + ' /Kids [' + kids.join(' ') + '] >>'));
    for (let i = 0; i < n; i++) {
      const c = canvases[i], jpg = new Uint8Array(await (await canvasBlob(c, 'image/jpeg', 0.92)).arrayBuffer());
      const pw = (c.width * 72 / 300).toFixed(2), ph = (c.height * 72 / 300).toFixed(2);
      const pg = 3 + i * 3, im = pg + 1, ct = pg + 2, draw = 'q ' + pw + ' 0 0 ' + ph + ' 0 0 cm /Im0 Do Q';
      obj(pg, () => put('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pw + ' ' + ph + '] /Resources << /XObject << /Im0 ' + im + ' 0 R >> >> /Contents ' + ct + ' 0 R >>'));
      obj(im, () => { put('<< /Type /XObject /Subtype /Image /Width ' + c.width + ' /Height ' + c.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpg.length + ' >>\nstream\n'); put(jpg); put('\nendstream'); });
      obj(ct, () => put('<< /Length ' + draw.length + ' >>\nstream\n' + draw + '\nendstream'));
    }
    const xref = len, total = 3 + n * 3;
    let x = 'xref\n0 ' + total + '\n0000000000 65535 f \n';
    for (let i = 1; i < total; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
    put(x + 'trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    const out = new Uint8Array(len); let p = 0; for (const b of parts) { out.set(b, p); p += b.length; }
    return out;
  };
  async function downloadPages(pages, name) {
    const base = U.cleanTitle(name).replace(/[\\/:*?"<>|]+/g, ' ');
    for (let i = 0; i < pages.length; i++) {
      const b = await canvasBlob(pages[i].prepared, 'image/png');
      const url = URL.createObjectURL(b), a = h('a', { href: url, download: base + (pages.length > 1 ? ' page ' + (i + 1) : '') + ' (prepared).png' });
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
  }
})();
