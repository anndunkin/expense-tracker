const { app, BrowserWindow, shell, Menu, dialog, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { allocateFreePort, waitForOwnServer } = require("./port-utils.cjs");

const isDev = !app.isPackaged;

// Port the in-process Express server listens on. Resolved at runtime by
// allocateFreePort() -- never hard-coded. See the note in startServer().
let serverPort = null;
let mainWindow = null;

// ─── Windows app identity ─────────────────────────────────────────────────────
// Explicit AppUserModelID is required so Windows treats Expense Track as a
// distinct application from any other Electron app the user may have running
// (e.g. TimeTrack). Without this, Windows can route a fresh launch of this
// shortcut to another already-running Electron process, causing the wrong
// app to come to the foreground. Must match electron-builder.yml `appId`.
if (process.platform === "win32") {
  app.setAppUserModelId("com.expensetrack.app");
}

// ─── Single-instance lock ─────────────────────────────────────────────────────
// Scope the instance lock to *this* AppUserModelID. If a second copy of
// Expense Track is launched, focus the existing window instead of spawning
// a duplicate process.
const gotInstanceLock = app.requestSingleInstanceLock();
if (!gotInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ─── Run Express server in-process ───────────────────────────────────────────
function startServer(port) {
  serverPort = port;
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
      process.env.PORT = String(port);
      // Loopback-only bind: this is a single-user desktop app.
      process.env.HOST = "127.0.0.1";
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

      // Wait for readiness AND confirm the responder is *our* server.
      // The identity assertion is what guarantees we can never display another
      // application's UI, whatever else happens to be listening locally.
      waitForOwnServer(port).then(() => resolve()).catch(reject);

    } catch (err) {
      reject(err);
    }
  });
}

// ─── Create window ────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 600,
    title: "Expense Track",
    icon: path.join(__dirname, "icon.png"),
    backgroundColor: "#f5f7fa",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
    show: false,
  });
  mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);
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
        type: "info", title: "About Expense Track", message: "Expense Track",
        detail: `Version ${app.getVersion()}\n\nExpense reporting for monthly and travel expenses.\n\nMileage reimbursed at 2026 IRS rate: $0.725/mile.`,
        buttons: ["OK"],
      })},
    ]},
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────
ipcMain.handle("show-save-dialog", async (_event, opts = {}) => {
  if (!mainWindow) return { canceled: true };
  const result = await dialog.showSaveDialog(mainWindow, {
    title: opts.title || "Save Expense Report",
    defaultPath: opts.defaultPath || undefined,
    filters: opts.filters || [
      { name: "Expense Reports", extensions: ["expense"] },
      { name: "JSON Files", extensions: ["json"] },
      { name: "All Files", extensions: ["*"] },
    ],
    properties: ["createDirectory", "showOverwriteConfirmation"],
  });
  return result; // { canceled, filePath }
});

ipcMain.handle("show-open-dialog", async (_event, opts = {}) => {
  if (!mainWindow) return { canceled: true };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: opts.title || "Select Folder",
    defaultPath: opts.defaultPath || undefined,
    properties: ["openDirectory", "createDirectory"],
  });
  // returns { canceled, filePaths: string[] }
  return { canceled: result.canceled, filePath: result.filePaths?.[0] ?? null };
});

ipcMain.handle("read-file", async (_event, filePath) => {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return { content };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle("write-file", async (_event, { filePath, content }) => {
  try {
    fs.writeFileSync(filePath, content, "utf8");
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

// ─── Lifecycle ─────────────────────────────────────────────────────────────────
if (gotInstanceLock) {
  app.whenReady().then(async () => {
    buildMenu();
    try {
      const port = await allocateFreePort();
      console.log(`[electron] Expense Track server port: ${port}`);
      await startServer(port);
      createWindow();
    } catch (err) {
      dialog.showErrorBox("Startup Error", `ExpenseTrack could not start.\n\n${err.message}`);
      app.quit();
    }
  });
  app.on("window-all-closed", () => app.quit());
}
