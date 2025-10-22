const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nativeAPI', {
  toggleDevtools: () => ipcRenderer.invoke('window-control', 'toggle-devtools'),
  focusWindow: () => ipcRenderer.invoke('window-control', 'focus'),
  createNewWindow: (url) => ipcRenderer.invoke('create-new-window', url),
  onOpenUrlInTab: (callback) => {
    ipcRenderer.removeAllListeners('open-url-in-tab');
    ipcRenderer.on('open-url-in-tab', (_event, payload) => {
      if (!payload) return;
      // 兼容旧格式字符串
      if (typeof payload === 'string') {
        callback({ url: payload });
      } else {
        callback(payload);
      }
    });
  },
  getAppInfo: () => ipcRenderer.invoke('app-info:get'),
  getOpenAIConfig: () => ipcRenderer.invoke('openai:config'),
  captureActiveTabScreenshot: (webContentsId) => ipcRenderer.invoke('capture-active-tab-screenshot', webContentsId),
});
