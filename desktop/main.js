// NiSH MarkSteady Piano desktop shell: one window around the offline web app, Web MIDI allowed,
// and a bridge to the bundled Audiveris music reader for scanned sheet music.
const { app, BrowserWindow, ipcMain, session, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const nativeAudio = require('./native-audio');

const APP_HTML = path.join(__dirname, 'app', 'index.html');
let win = null, omrChild = null;

if (!app.requestSingleInstanceLock()) app.quit();

function audiverisExe() {
  const base = app.isPackaged ? path.join(process.resourcesPath, 'audiveris') : path.join(__dirname, 'resources', 'audiveris');
  for (const name of ['Audiveris.exe', 'audiveris.exe', 'bin/Audiveris', 'bin/audiveris']) {
    const p = path.join(base, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 900, minHeight: 600,
    backgroundColor: '#111111', show: false, autoHideMenuBar: true,
    title: 'NiSH MarkSteady Piano',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => win.show());
  win.loadFile(APP_HTML);
  // links open in the default browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
  win.webContents.once('did-finish-load', () => openArgs(process.argv));
}

function openArgs(argv) {
  for (const a of argv.slice(app.isPackaged ? 1 : 2)) {
    if (!/\.(musicxml|xml|mxl|mid|midi|pdf|png|jpe?g)$/i.test(a) || !fs.existsSync(a)) continue;
    const data = fs.readFileSync(a);
    win.webContents.send('file:open', { name: path.basename(a), data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) });
  }
}

app.on('second-instance', (_e, argv) => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  openArgs(argv);
});

app.whenReady().then(() => {
  // MIDI keyboards: allow Web MIDI (and only what the app needs) for the local app page
  const allowed = new Set(['midi', 'midiSysex', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen']);
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(allowed.has(perm) && wc.getURL().startsWith('file:')));
  session.defaultSession.setPermissionCheckHandler((_wc, perm, origin) => allowed.has(perm) && (!origin || origin.startsWith('file:')));
  createWindow();
  nativeAudio.register(() => win);
});
app.on('window-all-closed', () => { if (omrChild) omrChild.kill(); nativeAudio.stop(); app.quit(); });

// ------------------------------------------------------------------ Audiveris bridge
ipcMain.handle('omr:available', () => !!audiverisExe());
ipcMain.handle('omr:cancel', () => { if (omrChild) { omrChild.kill(); omrChild = null; } return true; });

ipcMain.handle('omr:run', async (event, { name, pdf, pages }) => {
  const exe = audiverisExe();
  if (!exe) return { error: 'The music reader (Audiveris) is missing from this installation. Reinstall NiSH MarkSteady Piano.' };
  if (omrChild) return { error: 'The reader is already busy with another scan.' };
  const safe = String(name || 'scan').replace(/[^\w\- ]+/g, ' ').trim().slice(0, 60) || 'scan';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nish-marksteady-omr-'));
  const input = path.join(dir, safe + '.pdf'), out = path.join(dir, 'out');
  fs.mkdirSync(out);
  fs.writeFileSync(input, Buffer.from(pdf));
  const total = Math.max(1, pages | 0);
  const send = (k, text) => { if (!event.sender.isDestroyed()) event.sender.send('omr:progress', k, total, text); };
  const log = [];
  const code = await new Promise((resolve) => {
    // -batch: no window; -export: transcribe then write MusicXML (.mxl) into the output folder
    omrChild = spawn(exe, ['-batch', '-export', '-output', out, '--', input], { windowsHide: true, cwd: dir });
    let page = 1;
    const onData = (buf) => {
      for (const line of String(buf).split(/\r?\n/)) {
        if (!line.trim()) continue;
        log.push(line); if (log.length > 400) log.shift();
        const m = line.match(/sheet\s*#?(\d+)/i) || line.match(/\[#?(\d+)\]/);
        if (m) page = Math.min(total, Math.max(page, +m[1]));
        const step = line.match(/\b(LOAD|BINARY|SCALE|GRID|HEADERS|STEM_SEEDS|BEAMS|LEDGERS|HEADS|STEMS|REDUCTION|CUE_BEAMS|TEXTS|MEASURES|CHORDS|CURVES|SYMBOLS|LINKS|RHYTHMS|PAGE)\b/);
        if (step) send(page - 1 + stepFraction(step[1]), 'Reading page ' + page + ' of ' + total + ': ' + stepLabel(step[1]) + '…');
      }
    };
    omrChild.stdout.on('data', onData);
    omrChild.stderr.on('data', onData);
    omrChild.on('error', (e) => { log.push(String(e)); resolve(-1); });
    omrChild.on('close', (c) => resolve(c));
  });
  omrChild = null;
  const mxl = [];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.mxl$/i.test(f.name)) mxl.push(p); } };
  try { walk(out); } catch (e) { /* no output */ }
  mxl.sort();
  const result = { mxl: mxl.map((p) => { const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }), log: log.slice(-60).join('\n') };
  if (!mxl.length) result.error = code === 0 ? 'The reader finished but found no music to export. Try a sharper scan or a straighter page.' : 'The reader stopped (code ' + code + '). ' + (log.filter((l) => /WARN|ERROR|exception/i.test(l)).slice(-2).join(' ') || '');
  fs.rm(dir, { recursive: true, force: true }, () => {});
  return result;
});

const STEPS = ['LOAD', 'BINARY', 'SCALE', 'GRID', 'HEADERS', 'STEM_SEEDS', 'BEAMS', 'LEDGERS', 'HEADS', 'STEMS', 'REDUCTION', 'CUE_BEAMS', 'TEXTS', 'MEASURES', 'CHORDS', 'CURVES', 'SYMBOLS', 'LINKS', 'RHYTHMS', 'PAGE'];
const stepFraction = (s) => (STEPS.indexOf(s) + 1) / STEPS.length;
function stepLabel(s) {
  return ({ LOAD: 'loading', BINARY: 'cleaning the image', SCALE: 'measuring', GRID: 'finding staves', HEADERS: 'clefs and keys', HEADS: 'note heads', STEMS: 'stems', BEAMS: 'beams', TEXTS: 'text', MEASURES: 'bars', CHORDS: 'chords', SYMBOLS: 'symbols', RHYTHMS: 'rhythm', PAGE: 'finishing' })[s] || 'working';
}
