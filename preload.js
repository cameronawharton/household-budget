const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("appInfo", {
  version: "1.0.1",
  platform: process.platform,
});
