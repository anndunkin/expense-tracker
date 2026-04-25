const { app, BrowserWindow, shell, Menu, dialog } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");

// ─── Determine paths ──────────────────────────────────────────────────────────
const isDev = !app.isPackaged;
const PORT = 5000;

// In production, server bundle is next to the electron main file
const serverPath = isDev
  ? path.join(__dirname, "..", "dist", "index.cjs")
  : path.join(process.resourcesPath, "server", "index.cjs");

// Data directory: use %APPDATA%/ExpenseTrack in production, project root in dev
const dataDir = isDev
  ? path.join(__dirname, "..")
  : path.join(app.getPath("userData"));

let serverProcess = null;
let mainWindow = null;

// ─── Start Express backend ─────────────────────────────────────────────────────
function startServer() {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(serverPath)) {
      reject(new Error(`Server bundle not found: ${serverPath}`));
      return;
    }

    // Ensure data directory exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const env = {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      DATA_DIR: dataDir,
    };

    const nodeBin = isDev
      ? process.execPath
      : path.join(process.resourcesPath, "node", "node.exe");

    const nodeExec = fs.existsSync(nodeBin) ? nodeBin : process.execPath;

    serverProcess = spawn(nodeExec, [serverPath], {
      env,
      cwd: dataDir,
      windowsHide: true,
    });

    serverProcess.stdout.on("data", (d) => console.log("[server]", d.toString().trim()));
    serverProcess.stderr.on("data", (d) => console.error("[server]", d.toString().trim()));

    serverProcess.on("error", (err) => {
      console.error("Failed to start server:", err);
      reject(err);
    });

    // Poll until server is ready
    const start = Date.now();
    const poll = setInterval(() => {
      http.get(`http://localhost:${PORT}/api/reports`, (res) => {
        if (res.statusCode < 500) {
          clearInterval(poll);
          resolve();
        }
      }).on("error", () => {
        if (Date.now() - start > 15000) {
          clearInterval(poll);
          reject(new Error("Server startup timed out"));
        }
      });
    }, 300);
  });
}

// ─── Create main window ────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: "ExpenseTrack",
    icon: path.join(__dirname, "icon.png"),
    backgroundColor: "#f5f7fa",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  // Open external links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => { mainWindow = null; });
}

// ─── Application menu ──────────────────────────────────────────────────────────
function buildMenu() {
  const template = [
    {
      label: "File",
      submenu: [
        {
          label: "New Monthly Report",
          accelerator: "CmdOrCtrl+Shift+M",
          click: () => mainWindow?.webContents.executeJavaScript(
            `window.location.hash = '/report/new/monthly'`
          ),
        },
        {
          label: "New Travel Report",
          accelerator: "CmdOrCtrl+Shift+T",
          click: () => mainWindow?.webContents.executeJavaScript(
            `window.location.hash = '/report/new/travel'`
          ),
        },
        { type: "separator" },
        {
          label: "Open File…",
          accelerator: "CmdOrCtrl+O",
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              filters: [
                { name: "Expense Reports", extensions: ["expense", "json"] },
              ],
              properties: ["openFile"],
            });
            if (!result.canceled && result.filePaths[0]) {
              const filePath = JSON.stringify(result.filePaths[0]);
              mainWindow?.webContents.executeJavaScript(
                `window.__electronOpenFile && window.__electronOpenFile(${filePath})`
              );
            }
          },
        },
        {
          label: "Save",
          accelerator: "CmdOrCtrl+S",
          click: () => mainWindow?.webContents.executeJavaScript(
            `window.__electronSave && window.__electronSave()`
          ),
        },
        {
          label: "Save As…",
          accelerator: "CmdOrCtrl+Shift+S",
          click: () => mainWindow?.webContents.executeJavaScript(
            `window.__electronSaveAs && window.__electronSaveAs()`
          ),
        },
        { type: "separator" },
        { role: "quit", label: "Exit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "All Reports",
          accelerator: "CmdOrCtrl+Home",
          click: () => mainWindow?.webContents.executeJavaScript(
            `window.location.hash = '/'`
          ),
        },
        { type: "separator" },
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "About ExpenseTrack",
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: "info",
              title: "About ExpenseTrack",
              message: "ExpenseTrack",
              detail: `Version ${app.getVersion()}\n\nExpense reporting for monthly and travel expenses.\n\nMileage reimbursed at 2026 IRS rate: $0.725/mile.`,
              buttons: ["OK"],
            });
          },
        },
      ],
    },
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
    dialog.showErrorBox(
      "Startup Error",
      `ExpenseTrack could not start the backend server.\n\n${err.message}`
    );
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  app.quit();
});

app.on("before-quit", () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});
