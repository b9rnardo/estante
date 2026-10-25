// Desktop app: runs the same HTTP server inside Electron's main process and shows it in a window.
import { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, shell } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const HOST = '127.0.0.1';
const MAC = process.platform === 'darwin';
const ICON = path.join(import.meta.dirname, '../build/icon.png');
let server = null; // server/index.js, imported once ESTANTE_DATA is set
let origin = null; // http://127.0.0.1:<port>
let win = null;

// localStorage (enabled sources, reader preferences) is keyed by origin, port included,
// so reuse the port from the last launch instead of getting a new one every time.
async function listen() {
  const file = path.join(app.getPath('userData'), 'port');
  const last = Number(await readFile(file, 'utf8').catch(() => '')) || 0;
  const port = await server.start({ port: last, host: HOST }).catch(() => server.start({ port: 0, host: HOST }));
  if (port !== last) await writeFile(file, String(port));
  return port;
}

async function boot() {
  // library.js reads ESTANTE_DATA at import time, so set it before importing the server.
  process.env.ESTANTE_DATA ||= path.join(app.getPath('userData'), 'data');
  server = await import('../server/index.js');
  origin = `http://${HOST}:${await listen()}`;
  // `npm run app` runs the stock Electron binary: show the app's icon in the Dock instead.
  if (!app.isPackaged) app.dock?.setIcon(ICON);
  Menu.setApplicationMenu(menu());
  createWindow();
}

const openOutside = (url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); };

function createWindow() {
  const dark = nativeTheme.shouldUseDarkColors;
  win = new BrowserWindow({
    title: 'Estante',
    width: 1200,
    height: 820,
    minWidth: 380,
    minHeight: 480,
    backgroundColor: dark ? '#141413' : '#faf9f6', // --bg in public/css/app.css
    // No native title bar: the app's own 52px header takes its place, with the traffic
    // lights centered in its left corner (see the .titlebar class in public/index.html and css/).
    // Windows and Linux draw their caption buttons over the right corner instead, in
    // colours the page keeps in step with what is under them (preload.cjs).
    titleBarStyle: 'hidden',
    titleBarOverlay: MAC
      ? { height: 52 }
      : { height: 52, color: dark ? '#141413' : '#faf9f6', symbolColor: dark ? '#ecebe6' : '#1c1b19' }, // --bg, --text
    trafficLightPosition: { x: 18, y: 18 }, // y is ignored: the overlay height centers them
    ...(!MAC && { webPreferences: { preload: path.join(import.meta.dirname, 'preload.cjs') } }),
    // The packaged app has its icon in the .exe; `npm run app` on Windows/Linux needs it here.
    ...(!MAC && !app.isPackaged && { icon: ICON }),
    show: false,
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });

  // Anything that would leave the app (links, window.open) goes to the default browser.
  const page = win.webContents;
  page.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: 'deny' };
  });
  page.on('will-navigate', (event) => {
    if (new URL(event.url).origin === origin) return;
    event.preventDefault();
    openOutside(event.url);
  });
  page.on('context-menu', (_event, p) => {
    const items = p.isEditable
      ? [
        { role: 'cut', label: 'Recortar', enabled: p.editFlags.canCut },
        { role: 'copy', label: 'Copiar', enabled: p.editFlags.canCopy },
        { role: 'paste', label: 'Colar', enabled: p.editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', label: 'Selecionar Tudo' },
      ]
      : p.selectionText.trim() ? [{ role: 'copy', label: 'Copiar' }] : [];
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });

  win.loadURL(`${origin}/`);
}

// Colours for the caption buttons, from public/js/titlebar.js through preload.cjs.
ipcMain.on('titlebar-colors', (event, color, symbolColor) => {
  try {
    BrowserWindow.fromWebContents(event.sender)?.setTitleBarOverlay({ color, symbolColor });
  } catch { /* not a CSS colour */ }
});

function showWindow() {
  if (!origin) return; // still starting up
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.focus();
}

function menu() {
  const sep = { type: 'separator' };
  return Menu.buildFromTemplate([
    // On Windows and Linux the menu bar stays hidden (there is no title bar to hold it),
    // so only its shortcuts count; the app menu and the Mac-only roles are left out.
    ...(MAC ? [{
      label: app.name,
      submenu: [
        { role: 'about', label: 'Sobre a Estante' },
        sep,
        { role: 'services', label: 'Serviços' },
        sep,
        { role: 'hide', label: 'Ocultar Estante' },
        { role: 'hideOthers', label: 'Ocultar Outros' },
        { role: 'unhide', label: 'Mostrar Tudo' },
        sep,
        { role: 'quit', label: 'Encerrar Estante' },
      ],
    }] : []),
    {
      label: 'Editar',
      submenu: [
        { role: 'undo', label: 'Desfazer' },
        { role: 'redo', label: 'Refazer' },
        sep,
        { role: 'cut', label: 'Recortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Colar' },
        { role: 'selectAll', label: 'Selecionar Tudo' },
      ],
    },
    {
      label: 'Visualizar',
      submenu: [
        { role: 'reload', label: 'Recarregar' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools', label: 'Ferramentas do Desenvolvedor' }]),
        sep,
        { role: 'resetZoom', label: 'Tamanho Real' },
        { role: 'zoomIn', label: 'Aumentar Zoom', accelerator: 'CommandOrControl+=' },
        { role: 'zoomOut', label: 'Reduzir Zoom' },
        sep,
        { role: 'togglefullscreen', label: 'Tela Cheia' },
      ],
    },
    {
      label: 'Janela',
      role: 'window',
      submenu: [
        { role: 'minimize', label: 'Minimizar' },
        ...(MAC ? [{ role: 'zoom', label: 'Zoom' }] : []),
        { role: 'close', label: 'Fechar Janela' },
        ...(MAC ? [sep, { role: 'front', label: 'Trazer Tudo para a Frente' }] : []),
      ],
    },
  ]);
}

// A second launch just brings the existing window forward.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.on('activate', showWindow); // Dock icon clicked after the window was closed
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('will-quit', () => server?.stop());
  // Same ID as the installer's shortcuts (build.appId in package.json), or Windows shows
  // the running app apart from its pinned taskbar icon.
  if (process.platform === 'win32' && app.isPackaged) app.setAppUserModelId('local.estante.app');
  app.whenReady().then(boot).catch((err) => {
    dialog.showErrorBox('A Estante não conseguiu abrir', err.message);
    app.quit();
  });
}
