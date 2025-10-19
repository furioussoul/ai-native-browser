const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nativeAPI', {
  toggleDevtools: () => ipcRenderer.invoke('window-control', 'toggle-devtools'),
  focusWindow: () => ipcRenderer.invoke('window-control', 'focus'),
  createNewWindow: (url) => ipcRenderer.invoke('create-new-window', url),
  onOpenUrlInTab: (callback) => {
    ipcRenderer.removeAllListeners('open-url-in-tab');
    ipcRenderer.on('open-url-in-tab', (_event, url) => callback(url));
  },
  getAppInfo: () => ipcRenderer.invoke('app-info:get'),
  getOpenAIConfig: () => ipcRenderer.invoke('openai:config')
});
