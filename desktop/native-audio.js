// Main-process side of the low-latency sound engine (nish-audio.exe, ASIO) and the
// "Disable Windows audio effects" setting.
// SPDX-License-Identifier: GPL-3.0-or-later
const { app, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFile } = require('child_process');

let child = null, buf = '', getWin = () => null;
const renders = new Map();   // id -> { resolve, dir }

function engineExe() {
  const base = app.isPackaged ? path.join(process.resourcesPath, 'native') : path.join(__dirname, 'resources', 'native');
  const p = path.join(base, 'nish-audio.exe');
  return process.platform === 'win32' && fs.existsSync(p) ? p : null;
}
const toRenderer = (msg) => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send('naudio:event', msg); };

function start() {
  if (child) return true;
  const exe = engineExe();
  if (!exe) return false;
  child = spawn(exe, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let msg = null;
      try { msg = JSON.parse(line); } catch (e) { toRenderer({ ev: 'log', text: line }); continue; }
      if (msg.ev === 'rendered' && renders.has(msg.id)) { const r = renders.get(msg.id); renders.delete(msg.id); r.resolve(msg); continue; }
      toRenderer(msg);
    }
  });
  child.stderr.on('data', (d) => toRenderer({ ev: 'log', text: String(d) }));
  const c = child;
  child.on('error', (e) => { toRenderer({ ev: 'exit', error: String(e.message || e) }); if (child === c) child = null; });
  child.on('exit', (code) => {
    toRenderer({ ev: 'exit', code });
    for (const [id, r] of renders) { renders.delete(id); r.resolve({ ok: false, message: 'The sound engine stopped.' }); }
    if (child === c) child = null;
  });
  return true;
}
function send(line) {
  if (!child || typeof line !== 'string' || line.length > 200 || /[\r\n]/.test(line)) return;
  try { child.stdin.write(line + '\n'); } catch (e) { /* the engine has gone; its exit event follows */ }
}
function stop() {
  if (!child) return;
  const c = child;
  send('quit');
  setTimeout(() => { try { c.kill(); } catch (e) { /* already gone */ } }, 1500);
  child = null;
}

// ------------------------------------------------------------------ Windows audio effects (enhancements)
// Windows keeps a per-device switch, "Disable_SysFx" (the "Audio enhancements" setting), in the registry.
// Reading it needs no rights; changing it needs administrator rights, so that step runs in an elevated
// PowerShell (Windows asks for permission). The values found before the change are kept, so "Turn back on"
// restores each device exactly as it was. ASIO itself already bypasses these effects.
const FX_KEY = '{1da5d803-d492-4edd-8c23-e0c0ffee7f0e},5';
const ROOT = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\MMDevices\\Audio\\Render';
const backupPath = () => path.join(app.getPath('userData'), 'windows-audio-effects-backup.json');

const STATUS_PS = `
$ErrorActionPreference = 'SilentlyContinue'
$root = '${ROOT}'; $k = '${FX_KEY}'
$out = @()
foreach ($d in Get-ChildItem $root) {
  if ((Get-ItemProperty $d.PSPath).DeviceState -ne 1) { continue }
  $p = Get-ItemProperty (Join-Path $d.PSPath 'Properties')
  $name = $p.'{a45c254e-df1c-4efd-8020-67d146a850e0},2'
  $iface = $p.'{b3f8fa53-0004-438e-9003-51a46e139bfc},6'
  $fx = Get-ItemProperty (Join-Path $d.PSPath 'FxProperties')
  $v = $null; if ($fx) { $v = $fx.$k }
  $out += [pscustomobject]@{ id = $d.PSChildName; name = (@($name, $iface) | Where-Object { $_ }) -join ' - '; off = ($v -eq 1) }
}
ConvertTo-Json -InputObject @($out) -Compress
`;
const SET_PS = `
param([string]$Mode, [string]$Result, [string]$Backup)
$root = '${ROOT}'; $k = '${FX_KEY}'
$res = @()
if ($Mode -eq 'off') {
  foreach ($d in Get-ChildItem $root) {
    if ((Get-ItemProperty $d.PSPath).DeviceState -ne 1) { continue }
    $fxp = Join-Path $d.PSPath 'FxProperties'
    try {
      if (-not (Test-Path $fxp)) { New-Item $fxp -Force -ErrorAction Stop | Out-Null }
      $old = (Get-ItemProperty $fxp -ErrorAction SilentlyContinue).$k
      New-ItemProperty -Path $fxp -Name $k -PropertyType DWord -Value 1 -Force -ErrorAction Stop | Out-Null
      $res += [pscustomobject]@{ id = $d.PSChildName; old = $old; ok = $true }
    } catch { $res += [pscustomobject]@{ id = $d.PSChildName; ok = $false; error = $_.Exception.Message } }
  }
} else {
  foreach ($e in (Get-Content $Backup -Raw | ConvertFrom-Json)) {
    $fxp = Join-Path (Join-Path $root $e.id) 'FxProperties'
    try {
      if ($null -eq $e.old) { Remove-ItemProperty -Path $fxp -Name $k -ErrorAction SilentlyContinue }
      else { New-ItemProperty -Path $fxp -Name $k -PropertyType DWord -Value ([int]$e.old) -Force -ErrorAction Stop | Out-Null }
      $res += [pscustomobject]@{ id = $e.id; ok = $true }
    } catch { $res += [pscustomobject]@{ id = $e.id; ok = $false; error = $_.Exception.Message } }
  }
}
# the Windows audio service reads the switch when it starts
try { Restart-Service -Name Audiosrv -Force -ErrorAction Stop } catch { }
ConvertTo-Json -InputObject @($res) -Compress | Set-Content -Path $Result -Encoding UTF8
`;

function runPs(script, args = [], elevated = false) {
  return new Promise((resolve) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nish-fx-'));
    const file = path.join(dir, 'fx.ps1');
    fs.writeFileSync(file, '﻿' + script, 'utf8');
    let cmd;
    if (elevated) {
      const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
      const list = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '"' + file + '"', ...args.map((a) => '"' + a + '"')].map(q).join(',');
      cmd = ['-NoProfile', '-Command', `Start-Process -FilePath powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList @(${list})`];
    } else cmd = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file, ...args];
    execFile('powershell.exe', cmd, { windowsHide: true, timeout: 60000 }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || ''), dir });
    });
  });
}

async function fxStatus() {
  if (process.platform !== 'win32') return { supported: false };
  const r = await runPs(STATUS_PS);
  fs.rm(r.dir, { recursive: true, force: true }, () => {});
  let devices = [];
  try { devices = JSON.parse(r.stdout.trim() || '[]'); } catch (e) { return { supported: true, error: 'Could not read the Windows sound settings.' }; }
  if (!Array.isArray(devices)) devices = [devices];
  return { supported: true, devices, changedByApp: fs.existsSync(backupPath()) };
}

async function fxSet(off) {
  if (process.platform !== 'win32') return { ok: false, error: 'Only on Windows.' };
  const backup = backupPath();
  if (!off && !fs.existsSync(backup)) return { ok: false, error: 'Nothing to restore: the app has not changed these settings.' };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nish-fx-res-'));
  const result = path.join(tmp, 'result.json');
  const r = await runPs(SET_PS, ['-Mode', off ? 'off' : 'restore', '-Result', result, '-Backup', backup], true);
  fs.rm(r.dir, { recursive: true, force: true }, () => {});
  if (!fs.existsSync(result)) {
    fs.rm(tmp, { recursive: true, force: true }, () => {});
    return { ok: false, cancelled: true, error: 'Windows did not give permission, so nothing changed.' };
  }
  let res = [];
  try { res = JSON.parse(fs.readFileSync(result, 'utf8').replace(/^﻿/, '')); } catch (e) { /* unreadable */ }
  fs.rm(tmp, { recursive: true, force: true }, () => {});
  if (!Array.isArray(res)) res = [res];
  const failed = res.filter((x) => !x.ok);
  if (off) {
    // keep the very first values we found, so a second press never overwrites the true originals
    let prev = [];
    try { prev = JSON.parse(fs.readFileSync(backup, 'utf8')); } catch (e) { /* first time */ }
    const known = new Map(prev.map((e) => [e.id, e]));
    for (const x of res) if (x.ok && !known.has(x.id)) known.set(x.id, { id: x.id, old: x.old == null ? null : x.old });
    if (known.size) fs.writeFileSync(backup, JSON.stringify([...known.values()]));
  } else if (!failed.length) fs.rmSync(backup, { force: true });
  return { ok: !failed.length, changed: res.length - failed.length, failed: failed.length, error: failed.length ? failed[0].error : null };
}

/** Render a piece offline with the engine (for video export). notes: text lines as in native/src/render.h.
 *  Resolves with { ok, wav: Uint8Array, seconds } or { ok: false, message }. Starts the engine if ASIO is off. */
let renderSeq = 0;
async function render(text) {
  if (typeof text !== 'string' || text.length > 32 * 1024 * 1024) return { ok: false, message: 'Bad note list.' };
  if (!start()) return { ok: false, message: 'The sound engine is not installed.' };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nish-render-'));
  const inPath = path.join(dir, 'notes.txt'), outPath = path.join(dir, 'piece.wav');
  // the note list may only set what render.h reads; the output path is ours
  const body = text.split(/\r?\n/).filter((l) => /^(n|p|rate|gain|tail) /.test(l)).join('\n');
  fs.writeFileSync(inPath, 'out ' + outPath + '\n' + body + '\n', 'utf8');
  const id = 'r' + (++renderSeq);
  const done = new Promise((resolve) => renders.set(id, { resolve }));
  send('render ' + id + ' ' + inPath);
  const timer = new Promise((resolve) => setTimeout(() => resolve({ ok: false, message: 'Rendering took too long.' }), 10 * 60 * 1000));
  const msg = await Promise.race([done, timer]);
  renders.delete(id);
  let wav = null;
  if (msg.ok) { try { wav = fs.readFileSync(outPath); } catch (e) { msg.ok = false; msg.message = 'The rendered audio is missing.'; } }
  fs.rm(dir, { recursive: true, force: true }, () => {});
  return msg.ok ? { ok: true, wav: new Uint8Array(wav.buffer, wav.byteOffset, wav.byteLength), seconds: msg.seconds, ms: msg.ms } : { ok: false, message: msg.message || 'Rendering failed.' };
}

function register(winGetter) {
  getWin = winGetter;
  ipcMain.handle('naudio:available', () => !!engineExe());
  ipcMain.handle('naudio:start', () => start());
  ipcMain.handle('naudio:stop', () => { stop(); return true; });
  ipcMain.on('naudio:send', (_e, line) => send(line));
  ipcMain.handle('naudio:render', (_e, text) => render(text));
  ipcMain.handle('fx:status', () => fxStatus());
  ipcMain.handle('fx:set', (_e, off) => fxSet(!!off));
  ipcMain.handle('fx:openSettings', () => shell.openExternal('ms-settings:sound'));
  ipcMain.handle('app:relaunch', () => { app.relaunch(); app.exit(0); });
  app.on('before-quit', stop);
}

module.exports = { register, stop };
