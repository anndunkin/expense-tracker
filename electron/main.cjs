const { app, BrowserWindow, shell, Menu, dialog } = require("electron");
const path = require("path");
const http = require("http");
const fs = require("fs");

const isDev = !app.isPackaged;
const PORT = 5000;
let mainWindow = null;

// ─── Run Express server in-process ───────────────────────────────────────────
function startServer() {
  return new Promise((resolve, reject) => {
    try {
      // Data directory: %APPDATA%/ExpenseTrack in production
      const dataDir = isDev
        ? path.join(__dirname, "..")
        : app.getPath("userData");
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

      // Native SQLite binding location
      const nativeBinding = isDev
        ? path.join(__dirname, "..", "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node")
        : path.join(process.resourcesPath, "native", "better_sqlite3.node");

      // Server bundle location
      const serverBundle = isDev
        ? path.join(__dirname, "..", "dist", "index.cjs")
        : path.join(process.resourcesPath, "server", "index.cjs");

      // Set env vars before requiring the server — storage.ts reads these at module load time
      process.env.DATA_DIR = dataDir;
      process.env.PORT = String(PORT);
      process.env.NODE_ENV = "production";
      process.env.BETTER_SQLITE3_BINDING = nativeBinding;
      // STATIC_DIR tells static.ts where the built React frontend lives.
      // __dirname inside index.cjs resolves to resources/server/, but public is at resources/public/.
      process.env.STATIC_DIR = isDev
        ? path.join(__dirname, "..", "dist", "public")
        : path.join(process.resourcesPath, "public");

      console.log("[electron] serverBundle:", serverBundle);
      console.log("[electron] nativeBinding:", nativeBinding);
      console.log("[electron] binding exists:", fs.existsSync(nativeBinding));

      if (!fs.existsSync(serverBundle)) {
        return reject(new Error(`Server bundle not found:\n${serverBundle}`));
      }
      if (!fs.existsSync(nativeBinding)) {
        return reject(new Error(`SQLite native binding not found:\n${nativeBinding}`));
      }

      // Load the Express server — it self-starts on PORT
      require(serverBundle);

      // Poll until ready
      const start = Date.now();
      const poll = setInterval(() => {
        http.get(`http://localhost:${PORT}/api/reports`, (res) => {
          if (res.statusCode < 500) { clearInterval(poll); resolve(); }
        }).on("error", () => {
          if (Date.now() - start > 15000) {
            clearInterval(poll);
            reject(new Error("Server did not respond after 15 seconds."));
          }
        });
      }, 200);

    } catch (err) {
      reject(err);
    }
  });
}

// ─── Create window ────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 600,
    title: "ExpenseTrack",
    icon: path.join(__dirname, "icon.png"),
    backgroundColor: "#f5f7fa",
    webPreferences: { nodeIntegration: false, contextIsolation: true },
    show: false,
  });
  mainWindow.loadURL(`http://localhost:${PORT}`);
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url); return { action: "deny" };
  });
  mainWindow.on("closed", () => { mainWindow = null; });
}

// ─── Menu ─────────────────────────────────────────────────────────────────────
function buildMenu() {
  const template = [
    { label: "File", submenu: [
      { label: "New Monthly Report", accelerator: "CmdOrCtrl+Shift+M",
        click: () => mainWindow?.webContents.executeJavaScript(`window.location.hash = '/report/new/monthly'`) },
      { label: "New Travel Report", accelerator: "CmdOrCtrl+Shift+T",
        click: () => mainWindow?.webContents.executeJavaScript(`window.location.hash = '/report/new/travel'`) },
      { type: "separator" },
      { label: "Open File…", accelerator: "CmdOrCtrl+O",
        click: async () => {
          const r = await dialog.showOpenDialog(mainWindow, {
            filters: [{ name: "Expense Reports", extensions: ["expense","json"] }],
            properties: ["openFile"],
          });
          if (!r.canceled && r.filePaths[0]) {
            const fp = JSON.stringify(r.filePaths[0]);
            mainWindow?.webContents.executeJavaScript(`window.__electronOpenFile && window.__electronOpenFile(${fp})`);
          }
        }},
      { label: "Save", accelerator: "CmdOrCtrl+S",
        click: () => mainWindow?.webContents.executeJavaScript(`window.__electronSave && window.__electronSave()`) },
      { label: "Save As…", accelerator: "CmdOrCtrl+Shift+S",
        click: () => mainWindow?.webContents.executeJavaScript(`window.__electronSaveAs && window.__electronSaveAs()`) },
      { type: "separator" },
      { role: "quit", label: "Exit" },
    ]},
    { label: "Edit", submenu: [
      { role: "undo" }, { role: "redo" }, { type: "separator" },
      { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
    ]},
    { label: "View", submenu: [
      { label: "All Reports", accelerator: "CmdOrCtrl+Home",
        click: () => mainWindow?.webContents.executeJavaScript(`window.location.hash = '/'`) },
      { type: "separator" },
      { role: "reload" }, { role: "toggleDevTools" },
      { type: "separator" },
      { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
      { type: "separator" }, { role: "togglefullscreen" },
    ]},
    { label: "Help", submenu: [
      { label: "About ExpenseTrack", click: () => dialog.showMessageBox(mainWindow, {
        type: "info", title: "About ExpenseTrack", message: "ExpenseTrack",
        detail: `Version ${app.getVersion()}\n\nExpense reporting for monthly and travel expenses.\n\nMileage reimbursed at 2026 IRS rate: $0.725/mile.`,
        buttons: ["OK"],
      })},
    ]},
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ─── Lifecycle ─────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  buildMenu();
  try {
    await startServer();
    createWindow();
  } catch (err) {
    dialog.showErrorBox("Startup Error", `ExpenseTrack could not start.\n\n${err.message}`);
    app.quit();
  }
});
app.on("window-all-closed", () => app.quit());
