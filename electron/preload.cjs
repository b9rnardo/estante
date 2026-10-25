// What the page gets from the desktop app (electron/main.js), as window.estante.
// CommonJS because sandboxed preload scripts can't be ES modules.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('estante', {
  // Windows and Linux only: the caption buttons are drawn over the page's top-right corner,
  // and the page reports the colours under them (public/js/titlebar.js).
  ...(process.platform !== 'darwin' && {
    titleBarColors: (color, symbolColor) => ipcRenderer.send('titlebar-colors', String(color), String(symbolColor)),
  }),
  // A newer release on GitHub: `callback` gets { version, url } if one is already known,
  // and again when a later check finds one (public/js/app.js).
  onUpdate: (callback) => {
    ipcRenderer.on('update', (_event, u) => callback(u));
    ipcRenderer.invoke('update').then((u) => u && callback(u));
  },
});
