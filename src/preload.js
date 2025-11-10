const { contextBridge, ipcRenderer, clipboard } = require('electron');

contextBridge.exposeInMainWorld('ezgbp', {
  onDeepLink: (cb) => ipcRenderer.on('deeplink', (_e, url) => cb(url)),
  ping: () => ipcRenderer.invoke('ping'),
  readClipboardText: () => clipboard.readText(),
  // Desktop notifications
  showNotification: (options) => {
    return ipcRenderer.invoke('show-notification', options);
  }
});

