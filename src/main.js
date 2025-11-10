const { app, BrowserWindow, shell, protocol, ipcMain, Menu, Tray, nativeImage, Notification } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

const START_URL = process.env.ELECTRON_START_URL || 'https://app.theezgbp.com';
const ALLOWED_HOST = new URL(START_URL).host; // app.theezgbp.com

// OAuth and authentication domains that should stay in-app
const ALLOWED_OAUTH_DOMAINS = [
  'accounts.google.com',
  'oauth2.googleapis.com',
  'www.googleapis.com',
  'google.com', // Allow all google.com subdomains
  'gstatic.com', // Google static resources
  'googleusercontent.com', // Google user content
  'login.microsoftonline.com',
  'github.com',
  'githubusercontent.com',
  'auth0.com'
];

function isAllowedDomain(url) {
  try {
    const urlObj = new URL(url);
    const host = urlObj.host.toLowerCase();

    // Allow the main app domain
    if (host === ALLOWED_HOST.toLowerCase()) return true;

    // Allow OAuth provider domains
    if (ALLOWED_OAUTH_DOMAINS.some(domain => host === domain || host.endsWith('.' + domain))) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

let mainWindow;
let tray;

// ----- Create main window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'The EzGBP',
    icon: path.join(__dirname, 'icons', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadURL(START_URL);

  // Explicitly show the window
  mainWindow.show();

  // Handle new window requests (popups, OAuth, etc.)
  mainWindow.webContents.setWindowOpenHandler(({ url, disposition }) => {
    console.log('Window open request:', url, disposition);

    // Always create our own window for OAuth flows - never use system browser
    if (isAllowedDomain(url)) {
      const popup = new BrowserWindow({
        width: 500,
        height: 600,
        parent: mainWindow,
        modal: false,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      });

      popup.loadURL(url);

      // When popup navigates back to our domain, close it and update main window
      popup.webContents.on('will-navigate', (e, navUrl) => {
        console.log('Popup navigating to:', navUrl);
        try {
          const navHost = new URL(navUrl).host.toLowerCase();
          if (navHost === ALLOWED_HOST.toLowerCase()) {
            // OAuth callback - navigate main window and close popup
            console.log('OAuth callback detected, closing popup and navigating main window');
            mainWindow.loadURL(navUrl);
            popup.close();
            e.preventDefault();
          } else if (!isAllowedDomain(navUrl)) {
            e.preventDefault();
            shell.openExternal(navUrl);
          }
        } catch (err) {
          console.error('Error handling popup navigation:', err);
        }
      });

      // Also listen for did-navigate in case will-navigate doesn't catch it
      popup.webContents.on('did-navigate', (event, navUrl) => {
        console.log('Popup navigated to:', navUrl);
        try {
          const navHost = new URL(navUrl).host.toLowerCase();
          if (navHost === ALLOWED_HOST.toLowerCase()) {
            console.log('OAuth callback detected (did-navigate), closing popup and navigating main window');
            mainWindow.loadURL(navUrl);
            popup.close();
          }
        } catch (err) {
          console.error('Error handling popup did-navigate:', err);
        }
      });

      popup.on('closed', () => {
        console.log('Popup closed');
        // Popup closed, ensure main window is focused
        if (mainWindow) mainWindow.focus();
      });

      // Always deny to prevent system browser from opening
      return { action: 'deny' };
    }

    // Open truly external links in default browser
    console.log('Opening external URL in browser:', url);
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Handle navigation - allow OAuth flows but block other external navigation
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!isAllowedDomain(url)) {
      e.preventDefault();
      // Only open in browser if it's not an OAuth flow
      shell.openExternal(url);
    }
    // Allow navigation to allowed domains (including OAuth providers)
  });

  // Handle redirects after navigation (for OAuth callbacks)
  mainWindow.webContents.on('did-navigate', (event, url) => {
    // Ensure we stay in the app after OAuth redirects
    if (isAllowedDomain(url)) {
      console.log('Navigated to:', url);
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ----- Tray menu (background friendly)
function createTray() {
  try {
    const iconPath = path.join(__dirname, 'icons', 'icon.png');
    const icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      console.warn('Icon is empty, using default');
    } else {
      const resizedIcon = icon.resize({ width: 16, height: 16 });
      tray = new Tray(resizedIcon);
      const menu = Menu.buildFromTemplate([
        { label: 'Open The EzGBP', click: () => { if (!mainWindow) createWindow(); else mainWindow.show(); } },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() }
      ]);
      tray.setToolTip('The EzGBP');
      tray.setContextMenu(menu);
    }
  } catch (error) {
    console.error('Failed to create tray icon:', error);
    // Continue without tray if it fails
  }
}

// ----- Deep link protocol: ezgbp://...
function registerProtocol() {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'ezgbp', privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ]);

  // macOS handler
  app.setAsDefaultProtocolClient('ezgbp');

  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (mainWindow) {
      mainWindow.webContents.send('deeplink', url);
      mainWindow.show();
    } else {
      createWindow();
      setTimeout(() => mainWindow.webContents.send('deeplink', url), 500);
    }
  });

  // Windows handler (second-instance event)
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) app.quit();
  app.on('second-instance', (_e, argv) => {
    const deeplink = argv.find(a => a.startsWith('ezgbp://'));
    if (deeplink) {
      if (!mainWindow) createWindow();
      else mainWindow.show();
      mainWindow.webContents.send('deeplink', deeplink);
    }
  });
}

// ----- Application menu
function createApplicationMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Check for Updates',
          click: () => {
            autoUpdater.checkForUpdates().catch(err => {
              console.error('Error checking for updates:', err);
              if (Notification.isSupported() && mainWindow) {
                const notification = new Notification({
                  title: 'Update Check',
                  body: 'Unable to check for updates. Please try again later.',
                  icon: path.join(__dirname, 'icons', 'icon.png'),
                  silent: false
                });
                notification.show();
              }
            });
          }
        },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => app.quit()
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo', label: 'Undo' },
        { role: 'redo', label: 'Redo' },
        { type: 'separator' },
        { role: 'cut', label: 'Cut' },
        { role: 'copy', label: 'Copy' },
        { role: 'paste', label: 'Paste' },
        { role: 'selectAll', label: 'Select All' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload', label: 'Reload' },
        { role: 'forceReload', label: 'Force Reload' },
        { role: 'toggleDevTools', label: 'Toggle Developer Tools' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Actual Size' },
        { role: 'zoomIn', label: 'Zoom In' },
        { role: 'zoomOut', label: 'Zoom Out' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Toggle Fullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize', label: 'Minimize' },
        { role: 'close', label: 'Close' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About The EzGBP',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('show-about');
            }
          }
        }
      ]
    }
  ];

  // macOS specific menu adjustments
  if (process.platform === 'darwin') {
    template.unshift({
      label: app.getName(),
      submenu: [
        { role: 'about', label: 'About The EzGBP' },
        { type: 'separator' },
        { role: 'services', label: 'Services' },
        { type: 'separator' },
        { role: 'hide', label: 'Hide The EzGBP' },
        { role: 'hideOthers', label: 'Hide Others' },
        { role: 'unhide', label: 'Show All' },
        { type: 'separator' },
        { role: 'quit', label: 'Quit The EzGBP' }
      ]
    });

    // Window menu for macOS
    template[4].submenu = [
      { role: 'close', label: 'Close' },
      { role: 'minimize', label: 'Minimize' },
      { role: 'zoom', label: 'Zoom' },
      { type: 'separator' },
      { role: 'front', label: 'Bring All to Front' }
    ];
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ----- Auto-updates
function initAutoUpdater() {
  // Configure auto-updater
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // Check for updates on startup (after a short delay)
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch(err => {
      console.error('Error checking for updates:', err);
    });
  }, 3000);

  // Check for updates every 4 hours
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify().catch(err => {
      console.error('Error checking for updates:', err);
    });
  }, 4 * 60 * 60 * 1000);

  // Update available - downloading
  autoUpdater.on('update-available', (info) => {
    console.log('Update available:', info.version);
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: 'Update Available',
        body: `Downloading version ${info.version}...`,
        icon: path.join(__dirname, 'icons', 'icon.png'),
        silent: false
      });
      notification.show();
    }
  });

  // Update downloaded - ready to install
  autoUpdater.on('update-downloaded', (info) => {
    console.log('Update downloaded:', info.version);
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: 'Update Ready',
        body: `Version ${info.version} is ready. The app will restart to install the update.`,
        icon: path.join(__dirname, 'icons', 'icon.png'),
        silent: false
      });
      notification.show();
      notification.on('click', () => {
        autoUpdater.quitAndInstall();
      });
    }
    // Auto-install after 5 seconds if user doesn't click
    setTimeout(() => {
      autoUpdater.quitAndInstall();
    }, 5000);
  });

  // Update error
  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err);
    // Don't show error notifications to users for network issues, etc.
  });

  // Download progress
  autoUpdater.on('download-progress', (progressObj) => {
    const percent = Math.round(progressObj.percent);
    console.log(`Update download progress: ${percent}%`);
  });
}

// ----- IPC handlers
ipcMain.handle('ping', () => 'pong');

// Desktop notifications
ipcMain.handle('show-notification', (event, { title, body, icon }) => {
  // Request notification permission if not already granted
  if (!Notification.isSupported()) {
    return { success: false, error: 'Notifications not supported' };
  }

  const notification = new Notification({
    title: title || 'The EzGBP',
    body: body || '',
    icon: icon || path.join(__dirname, 'icons', 'icon.png'),
    silent: false
  });

  notification.show();

  notification.on('click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  return { success: true };
});

// ----- App lifecycle
app.whenReady().then(() => {
  try {
    registerProtocol();
    createApplicationMenu();
    createWindow();
    createTray();
    initAutoUpdater();
    console.log('App initialized successfully');
  } catch (error) {
    console.error('Error during app initialization:', error);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

