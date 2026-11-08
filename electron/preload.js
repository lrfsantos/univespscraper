const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getEnv: () => ipcRenderer.invoke('get-env'),
  launchBrowser: () => ipcRenderer.invoke('launch-browser'),
  checkAuth: () => ipcRenderer.invoke('check-auth'),
  discoverCourses: () => ipcRenderer.invoke('discover-courses'),
  discoverWeeks: (ids) => ipcRenderer.invoke('discover-weeks', ids),
  runExtraction: (selection) => ipcRenderer.invoke('run-extraction', selection),
  cancelExtraction: () => ipcRenderer.invoke('cancel-extraction'),
  saveZip: () => ipcRenderer.invoke('save-zip'),
  revealZip: (p) => ipcRenderer.invoke('reveal-zip', p),
  onStatus: (cb) => ipcRenderer.on('status', (_e, data) => cb(data)),
});
