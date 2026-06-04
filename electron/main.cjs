const { app, BrowserWindow, Menu, Tray, shell, nativeImage } = require('electron');
const path = require('path');

let mainWindow;
let tray;

const appIcon = path.join(__dirname, '../public/favicon.ico');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    icon: appIcon,
    title: 'Washflow — Car Wash Management',
    backgroundColor: '#0f1319',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
      webSecurity: false,
    },
  });

  // Load index.html directly
  const indexPath = path.join(__dirname, '../dist/index.html');
  mainWindow.loadFile(indexPath);

  // Intercept any navigation attempts and always reload index.html
  // This makes React Router work correctly in Electron
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Only intercept file:// URLs (local navigation)
    if (url.startsWith('file://')) {
      event.preventDefault();
      mainWindow.loadFile(indexPath);
    }
  });

  // Handle hash-based or path-based routing after load
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    // On any load failure, fall back to index.html
    mainWindow.loadFile(indexPath);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('close', (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  let trayIcon;
  try {
    const icon = nativeImage.createFromPath(appIcon);
    trayIcon = icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 });
  } catch (e) {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Washflow', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuiting = true; app.quit(); } },
  ]);
  tray.setToolTip('Washflow — Car Wash Management');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => { mainWindow.show(); mainWindow.focus(); });
}

Menu.setApplicationMenu(null);

app.whenReady().then(() => {
  createWindow();
  createTray();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
