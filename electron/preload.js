const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  startPoc: () => ipcRenderer.invoke('start-poc'),
  getEnv: () => ipcRenderer.invoke('get-env'),
  onStatus: (cb) => ipcRenderer.on('status', (_e, data) => cb(data)),
});
