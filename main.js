const { app, BrowserWindow, shell, Menu } = require("electron");
const path = require("path");

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
