// Windows and Linux only (see electron/main.js): the caption buttons are drawn over the
// page's top-right corner, and the page reports the colours under them (public/js/titlebar.js).
// CommonJS because sandboxed preload scripts can't be ES modules.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('estante', {
  titleBarColors: (color, symbolColor) => ipcRenderer.send('titlebar-colors', String(color), String(symbolColor)),
});
