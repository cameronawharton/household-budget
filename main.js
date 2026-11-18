const { app, BrowserWindow, shell, Menu, ipcMain, net } = require("electron");
const path = require("path");
const updater = require("./updater");
const APP_VERSION = require("./package.json").version;

// ---- version and updates (called from the window through preload.js) ----
ipcMain.handle("app:version", () => APP_VERSION);
ipcMain.handle("update:check", () => updater.check((u, o) => net.fetch(u, o), APP_VERSION));
ipcMain.handle("update:install", async (e, info) => {
  try {
    const file = await updater.download((u, o) => net.fetch(u, o), info, (pct) => {
      if (!e.sender.isDestroyed()) e.sender.send("update:progress", pct);
    });
    if (process.env.HB_UPDATE_DRYRUN) return { ok: true, file };
    updater.launchInstaller(file);
    setTimeout(() => app.quit(), 800);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 680,
    title: "Household Budget",
    backgroundColor: "#f4f6f8",
    icon: path.join(__dirname, "app", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, "app", "index.html"));

  // Links open in the normal browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("file://")) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });
  // Ctrl+R reloads, Ctrl+Shift+I opens developer tools for troubleshooting.
  win.webContents.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown" || !input.control) return;
    if (input.key.toLowerCase() === "r") { win.webContents.reload(); e.preventDefault(); }
    if (input.shift && input.key.toLowerCase() === "i") { win.webContents.toggleDevTools(); e.preventDefault(); }
  });
}

app.on("second-instance", () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});
app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
