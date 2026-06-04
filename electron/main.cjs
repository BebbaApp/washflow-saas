const { app, BrowserWindow, Menu, Tray, shell, nativeImage } = require('electron');
const path = require('path');

let mainWindow;
let tray;

// In a packaged app, __dirname points inside the asar archive.
// app.getAppPath() gives the correct root in both dev and packaged.
const appRoot = app.getAppPath();
const appIcon = path.join(appRoot, 'public', 'favicon.ico');
const indexPath = path.join(appRoot, 'dist', 'index.html');

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
      preload: path.join(appRoot, 'electron', 'preload.cjs'),
      webSecurity: false,
    },
  });

  mainWindow.loadFile(indexPath);

  // Always reload index.html on any failed navigation (handles React Router)
  mainWindow.webContents.on('did-fail-load', () => {
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
