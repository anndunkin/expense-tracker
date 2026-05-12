# Windows SQLite Native Binding

Pre-built `better-sqlite3` native module for Electron 41 / ABI 145 on Windows x64.

Source: https://github.com/WiseLibs/better-sqlite3/releases/tag/v12.9.0
File:   better-sqlite3-v12.9.0-electron-v145-win32-x64.tar.gz

This file is vendored here so Windows builds can be produced from any host
(Linux, macOS) without accidentally packaging the host-platform .node file.
electron-builder copies it to resources/native/better_sqlite3.node via
the extraResources entry in electron-builder.yml.
