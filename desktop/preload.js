// The bridge the web app sees as window.wapiroDesktop. Only these calls cross into the main process.
const { contextBridge, ipcRenderer } = require('electron');

let progressHandler = null;
ipcRenderer.on('omr:progress', (_e, k, n, text) => { if (progressHandler) progressHandler(k, n, text); });

contextBridge.exposeInMainWorld('wapiroDesktop', {
  platform: process.platform,
  /** Read a multi-page PDF of prepared scan pages with Audiveris. Resolves { mxl: [ArrayBuffer], log, error }. */
  omr: async ({ name, pdf, pages, onProgress }) => {
    progressHandler = typeof onProgress === 'function' ? onProgress : null;
    try { return await ipcRenderer.invoke('omr:run', { name, pdf, pages }); }
    finally { progressHandler = null; }
  },
  cancelOmr: () => ipcRenderer.invoke('omr:cancel'),
  omrAvailable: () => ipcRenderer.invoke('omr:available'),
  /** Files passed on the command line or opened with "Open with" ({ name, data: ArrayBuffer }). */
  onOpenFile: (fn) => ipcRenderer.on('file:open', (_e, f) => fn(f)),
  /** The low-latency sound engine (ASIO), a separate program that also reads the MIDI keyboard directly. */
  nativeAudio: {
    available: () => ipcRenderer.invoke('naudio:available'),
    start: () => ipcRenderer.invoke('naudio:start'),
    stop: () => ipcRenderer.invoke('naudio:stop'),
    send: (line) => ipcRenderer.send('naudio:send', String(line)),
    onEvent: (fn) => ipcRenderer.on('naudio:event', (_e, m) => fn(m)),
  },
  /** Windows audio effects ("Audio enhancements") for all active output devices. */
  audioEffects: {
    status: () => ipcRenderer.invoke('fx:status'),
    set: (off) => ipcRenderer.invoke('fx:set', !!off),
    openSettings: () => ipcRenderer.invoke('fx:openSettings'),
  },
  relaunch: () => ipcRenderer.invoke('app:relaunch'),
});
