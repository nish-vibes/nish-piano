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
});
