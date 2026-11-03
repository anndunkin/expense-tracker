# Windows SQLite Native Binding

Pre-built `better-sqlite3` native module for Electron 43.4.0 / ABI 148 on Windows x64.

Recovered unchanged from the existing Expense Track v1.1.5 Windows installer,
whose release workflow rebuilt `better-sqlite3` for Electron on Windows:
https://github.com/anndunkin/expense-tracker/releases/download/v1.1.5/ExpenseTrack-1.1.5-Windows-x64-Setup.exe

SHA-256: `684e05547997ac7617b87b86a70fae7625fbd31c31f4147093c274128065f59a`

Verified by loading it in the Windows Electron 43.4.0 runtime under Wine and
performing SQLite create/insert/select operations. The packaged server also
passed health, frontend-serving, and report-save/readback smoke tests.

This file is vendored here so Windows builds can be produced from any host
(Linux, macOS) without accidentally packaging the host-platform .node file.
electron-builder copies it to resources/native/better_sqlite3.node via
the extraResources entry in electron-builder.yml.
