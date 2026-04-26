const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Show a native Save As dialog — returns { filePath: string } or { canceled: true }
  showSaveDialog: (opts) => ipcRenderer.invoke("show-save-dialog", opts),

  // Write a file to disk — returns { ok: true } or { error: string }
  writeFile: (filePath, content) => ipcRenderer.invoke("write-file", { filePath, content }),

  // Read a file from disk — returns { content: string } or { error: string }
  readFile: (filePath) => ipcRenderer.invoke("read-file", filePath),

  // Show a native directory picker — returns { filePath: string } or { canceled: true }
  showOpenDialog: (opts) => ipcRenderer.invoke("show-open-dialog", opts),

  // Check if running inside Electron
  isElectron: true,
});
