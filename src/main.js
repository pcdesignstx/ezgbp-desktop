const { app, BrowserWindow, shell, protocol, ipcMain, Menu, Tray, nativeImage, Notification, dialog, session } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

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
let isManualCheck = false; // Track if this is a manual check (to show notifications)

// ----- Create main window
function createWindow() {
  const startTime = Date.now();
  console.log('[Startup] Creating main window...');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'The EzGBP',
    icon: path.join(__dirname, 'icons', 'icon.png'),
    show: true, // Show window immediately
    backgroundColor: '#0b0f1a', // Dark background to match theme while loading
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  console.log(`[Startup] Window created in ${Date.now() - startTime}ms`);

  // Load URL - window is already visible
  mainWindow.loadURL(START_URL);
  console.log(`[Startup] Loading URL: ${START_URL}`);

  // Ensure window is shown and focused (redundant but safe)
  mainWindow.show();
  mainWindow.focus();

  // Log when content finishes loading
  mainWindow.webContents.on('did-finish-load', () => {
    console.log(`[Startup] Content loaded in ${Date.now() - startTime}ms`);
  });

  mainWindow.on('show', () => {
    console.log(`[Startup] Window shown in ${Date.now() - startTime}ms`);
  });

  // Intercept download requests before they navigate
  mainWindow.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;
    
    // Check if this looks like a download request
    if (url.endsWith('.zip') || url.includes('ezgbp-plugin') || url.includes('plugin.zip') || 
        (url.includes('download') && (url.includes('.zip') || details.requestHeaders['content-type']?.includes('zip')))) {
      console.log('[Download] Intercepted download request:', url);
      // Let it proceed - the will-download handler will catch it
      callback({});
      return;
    }
    
    callback({});
  }, { urls: ['*://*/*'] });

  // Log failed resource loads (like broken images)
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame && validatedURL) {
      // This is likely a resource (image, CSS, etc.) that failed to load
      console.warn(`[Resource Load Failed] ${errorCode}: ${errorDescription} - ${validatedURL}`);
    } else if (isMainFrame) {
      // Main frame failed to load
      console.error(`[Page Load Failed] ${errorCode}: ${errorDescription} - ${validatedURL}`);
      // If it's a 404 and looks like a download URL, log it specifically
      if (errorCode === -105 && (validatedURL.includes('.zip') || validatedURL.includes('download') || validatedURL.includes('plugin'))) {
        console.error(`[Download Error] File not found (404): ${validatedURL}`);
        console.error(`[Download Error] This suggests the download URL is incorrect or the file doesn't exist on the server.`);
        // Show user-friendly error
        if (Notification.isSupported()) {
          const notification = new Notification({
            title: 'Download Failed',
            body: 'The file you tried to download was not found. Please check the download link.',
            icon: path.join(__dirname, 'icons', 'icon.png'),
            silent: false
          });
          notification.show();
        }
      }
    }
  });

  // Handle new window requests (popups, OAuth, downloads, etc.)
  mainWindow.webContents.setWindowOpenHandler(({ url, disposition }) => {
    console.log('Window open request:', url, disposition);

    // Allow ZIP file downloads - let them proceed normally
    if (url.endsWith('.zip') || url.includes('ezgbp-plugin') || url.includes('plugin.zip') || url.includes('download') || url.includes('.zip?')) {
      console.log('[Download] Allowing download via window open:', url);
      // Don't create a new window, let the download proceed in the current context
      return { action: 'allow' }; // Allow the download to proceed
    }

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

  // Handle navigation - allow OAuth flows, downloads, but block other external navigation
  mainWindow.webContents.on('will-navigate', (e, url) => {
    console.log('[Navigation] will-navigate to:', url);
    
    // Allow ZIP file downloads and plugin downloads
    if (url.endsWith('.zip') || url.includes('ezgbp-plugin') || url.includes('plugin.zip') || url.includes('download') || url.includes('.zip?')) {
      console.log('[Download] Allowing download via navigation:', url);
      // Allow the download to proceed - Electron's download handler will catch it
      // Don't prevent default, let it navigate/trigger download
      return;
    }
    
    if (!isAllowedDomain(url)) {
      console.log('[Navigation] Blocking external navigation:', url);
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
// This MUST be called before app.whenReady()
protocol.registerSchemesAsPrivileged([
  { scheme: 'ezgbp', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

function setupProtocolHandlers() {
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

  // Function to handle manual check for updates
  const checkForUpdatesHandler = async () => {
    if (!app.isPackaged) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Check',
        message: 'Updates are only available in the packaged application.',
        detail: 'Please install the app from the DMG to enable auto-updates.'
      });
      return;
    }

    try {
      isManualCheck = true;
      log.info('Manual update check initiated');

      // Show notification that check is starting
      if (Notification.isSupported()) {
        const notification = new Notification({
          title: 'Checking for Updates',
          body: 'Looking for the latest version...',
          icon: path.join(__dirname, 'icons', 'icon.png'),
          silent: false
        });
        notification.show();
      }

      const result = await autoUpdater.checkForUpdates();

      // If no update info returned and no update-available event fired,
      // show that we're up to date
      if (!result?.updateInfo) {
        // Wait a moment to see if update-available event fires
        setTimeout(() => {
          if (Notification.isSupported()) {
            const notification = new Notification({
              title: 'Up to Date',
              body: `You are running the latest version (${app.getVersion()}).`,
              icon: path.join(__dirname, 'icons', 'icon.png'),
              silent: false
            });
            notification.show();
          }
        }, 500);
      }
      // If update is available, the 'update-available' event will handle the notification
    } catch (err) {
      log.error('Manual update check failed:', err);
      if (Notification.isSupported()) {
        const notification = new Notification({
          title: 'Update Check Failed',
          body: err.message || 'Unable to check for updates.',
          icon: path.join(__dirname, 'icons', 'icon.png'),
          silent: false
        });
        notification.show();
      }
    } finally {
      // Reset after a delay to allow events to fire
      setTimeout(() => {
        isManualCheck = false;
      }, 2000);
    }
  };

  // macOS specific menu adjustments
  const isMac = process.platform === 'darwin';
  if (isMac) {
    // Use role: 'appMenu' for macOS - this ensures it appears as the app name menu
    template.unshift({
      role: 'appMenu',
      submenu: [
        { role: 'about', label: 'About The EzGBP' },
        { type: 'separator' },
        {
          id: 'checkForUpdates',
          label: 'Check for Updates…',
          enabled: true, // Keep it visible and enabled in both dev and prod
          click: checkForUpdatesHandler
        },
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

  try {
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
    console.log('Application menu created successfully');

    // Diagnostic: verify menu structure
    const appMenu = Menu.getApplicationMenu();
    if (appMenu) {
      const topLevelLabels = appMenu.items.map(i => i.label);
      console.log('Top-level menu items:', topLevelLabels);

      if (isMac && appMenu.items.length > 0) {
        const firstMenu = appMenu.items[0];
        const firstSubmenuLabels = firstMenu.submenu?.items.map(i => i.label) || [];
        console.log('First menu (appMenu) submenu items:', firstSubmenuLabels);

        // Verify "Check for Updates" is present
        if (firstSubmenuLabels.includes('Check for Updates…')) {
          console.log('✓ "Check for Updates" found in app menu');
        } else {
          console.warn('✗ "Check for Updates" NOT found in app menu');
        }
      }
    }
  } catch (error) {
    console.error('Error creating application menu:', error);
  }
}

// ----- Auto-updates
function initAutoUpdater() {
  // Only run auto-updater when packaged (not in dev mode)
  if (!app.isPackaged) {
    log.info('Auto-updater disabled: running in development mode');
    return;
  }

  // Configure logging for auto-updater
  autoUpdater.logger = log;
  autoUpdater.logger.transports.file.level = 'info';
  log.info('Auto-updater initialized for packaged app');

  // For private repos: set GitHub token if available
  // Store GH_TOKEN in environment (via CI/CD or .env) - never hard-code
  if (process.env.GH_TOKEN) {
    autoUpdater.requestHeaders = {
      Authorization: `token ${process.env.GH_TOKEN}`
    };
    log.info('GitHub token configured for private repo access');
  }

  // Configure auto-updater
  // Note: Provider is auto-detected from electron-builder.yml publish config
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // Log the configured update server for debugging
  log.info('Update server configured:', {
    provider: 'github',
    owner: 'pcdesignstx',
    repo: 'ezgbp-desktop',
    version: app.getVersion()
  });
  log.info('Auto-update system ready - will check for updates on startup and every 4 hours');

  // Event listeners with logging and notifications
  autoUpdater.on('checking-for-update', () => {
    log.info('Checking for update...');
    // Show notification for manual checks
    if (isManualCheck && Notification.isSupported()) {
      const notification = new Notification({
        title: 'Checking for Updates',
        body: 'Looking for the latest version...',
        icon: path.join(__dirname, 'icons', 'icon.png'),
        silent: false
      });
      notification.show();
    }
  });

  autoUpdater.on('update-available', (info) => {
    log.info('Update available:', info.version);
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

  autoUpdater.on('update-not-available', (info) => {
    log.info('Update not available. Running latest version:', info.version || app.getVersion());
    // Show notification for manual checks
    if (isManualCheck && Notification.isSupported()) {
      const notification = new Notification({
        title: 'Up to Date',
        body: `You are running the latest version (${app.getVersion()}).`,
        icon: path.join(__dirname, 'icons', 'icon.png'),
        silent: false
      });
      notification.show();
    }
  });

  autoUpdater.on('error', (err) => {
    log.error('Auto-updater error:', err);
    log.error('Error details:', {
      message: err.message,
      stack: err.stack,
      code: err.code,
      name: err.name,
      statusCode: err.statusCode
    });

    // Only show notifications for critical errors, not expected ones like 406
    // 406 errors are handled gracefully by safeCheckForUpdates and logged
    const isExpectedError = err.statusCode === 406 ||
      (err.message && err.message.includes('406')) ||
      (err.message && err.message.includes('Unable to find latest version'));

    if (!isExpectedError && Notification.isSupported() && mainWindow) {
      let errorMessage = err.message || 'Unknown error';
      // Make error messages more user-friendly
      if (err.message && (err.message.includes('404') || err.statusCode === 404)) {
        errorMessage = 'Update server not found. The repository may be private or the release may not exist.';
      } else if (err.message && (err.message.includes('403') || err.statusCode === 403)) {
        errorMessage = 'Access denied. The repository may be private.';
      } else if (err.message && (err.message.includes('network') || err.message && err.message.includes('ENOTFOUND'))) {
        errorMessage = 'Network error. Please check your internet connection.';
      }
      const notification = new Notification({
        title: 'Update Check Failed',
        body: errorMessage,
        icon: path.join(__dirname, 'icons', 'icon.png'),
        silent: false
      });
      notification.show();
    }
  });

  autoUpdater.on('download-progress', (progressObj) => {
    const percent = Math.round(progressObj.percent);
    log.info(`Download progress: ${percent}%`);
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info('Update downloaded:', info.version);
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

  // Safe update check function (defensive error handling)
  async function safeCheckForUpdates() {
    try {
      log.info('Checking for updates...');
      await autoUpdater.checkForUpdates();
    } catch (e) {
      // Log but don't crash - GitHub hiccups shouldn't break the app
      log.warn('Auto-update check failed (non-fatal):', e?.message || e);
      // Don't show notification for expected errors (like 406) to avoid annoying users
      // The error handler above will show notifications for critical issues
    }
  }

  // Check for updates on startup (after a short delay to ensure window is visible)
  setTimeout(() => {
    safeCheckForUpdates();
  }, 3000);

  // Check for updates every 4 hours
  setInterval(() => {
    safeCheckForUpdates();
  }, 4 * 60 * 60 * 1000);
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

// ----- Download handling
function setupDownloadHandler() {
  session.defaultSession.on('will-download', (event, item, webContents) => {
    const filePath = path.join(app.getPath('downloads'), item.getFilename());
    
    item.setSavePath(filePath);
    
    console.log(`[Download] Starting download: ${item.getFilename()}`);
    console.log(`[Download] URL: ${item.getURL()}`);
    console.log(`[Download] Saving to: ${filePath}`);
    console.log(`[Download] Content-Type: ${item.getMimeType()}`);
    
    item.on('updated', (event, state) => {
      if (state === 'interrupted') {
        console.log('[Download] Download interrupted');
      } else if (state === 'progressing') {
        if (item.isPaused()) {
          console.log('[Download] Download paused');
        } else {
          const progress = Math.round((item.getReceivedBytes() / item.getTotalBytes()) * 100);
          console.log(`[Download] Progress: ${progress}%`);
        }
      }
    });
    
    item.on('done', (event, state) => {
      if (state === 'completed') {
        console.log(`[Download] Download completed: ${filePath}`);
        // Show notification when download completes
        if (Notification.isSupported()) {
          const notification = new Notification({
            title: 'Download Complete',
            body: `${item.getFilename()} has been downloaded to your Downloads folder.`,
            icon: path.join(__dirname, 'icons', 'icon.png'),
            silent: false
          });
          notification.show();
        }
      } else {
        console.log(`[Download] Download failed: ${state}`);
        if (Notification.isSupported()) {
          const notification = new Notification({
            title: 'Download Failed',
            body: `Failed to download ${item.getFilename()}.`,
            icon: path.join(__dirname, 'icons', 'icon.png'),
            silent: false
          });
          notification.show();
        }
      }
    });
  });
}

// ----- App lifecycle
const appStartTime = Date.now();
app.on('ready', () => {
  console.log(`[Startup] App ready in ${Date.now() - appStartTime}ms`);
});

app.whenReady().then(() => {
  // Setup download handler before creating windows
  setupDownloadHandler();
  try {
    console.log('[Startup] Initializing app components...');
    setupProtocolHandlers();
    createApplicationMenu();
    createWindow();
    createTray();
    initAutoUpdater();
    console.log(`[Startup] App initialized successfully in ${Date.now() - appStartTime}ms`);
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

