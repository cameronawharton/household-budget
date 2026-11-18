const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("appInfo", {
  platform: process.platform,
  getVersion: () => ipcRenderer.invoke("app:version"),
});

contextBridge.exposeInMainWorld("updater", {
  check: () => ipcRenderer.invoke("update:check"),
  install: (info) => ipcRenderer.invoke("update:install", info),
  onProgress: (cb) => {
    const fn = (_e, pct) => cb(pct);
    ipcRenderer.on("update:progress", fn);
    return () => ipcRenderer.removeListener("update:progress", fn);
  },
});
