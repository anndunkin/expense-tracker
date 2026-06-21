/**
 * electron-builder afterPack hook
 * Embeds the custom icon AND full version-string metadata into "Expense Track.exe"
 * using rcedit (via Wine on Linux/macOS, native on Windows).
 *
 * Why this matters for the pinned taskbar icon:
 *   Windows identifies a pinned shortcut's target application by matching the
 *   AppUserModelID (AUMI) stored in the .lnk file against the AUMI of running
 *   processes.  When Expense Track is distributed as a plain ZIP (no NSIS
 *   installer), Windows creates a generic shortcut without an embedded AUMI.
 *   It then falls back to matching by the exe's FileDescription / ProductName
 *   version-string resources.  If those are absent or still read "Electron",
 *   Windows can route a taskbar click to ANY running Electron process — e.g.
 *   TimeTrack — instead of launching a fresh Expense Track instance.
 *
 *   The fix: embed both the icon AND the version strings so the exe is
 *   unambiguously identifiable to the Windows shell.
 */
const { execFileSync } = require('child_process');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

module.exports = async function afterPack(context) {
  // Only applies to Windows targets
  if (context.electronPlatformName !== 'win32') return;

  const productName = context.packager.appInfo.productName; // "Expense Track"
  const version     = context.packager.appInfo.version;     // e.g. "1.1.0"
  const exePath     = path.join(context.appOutDir, `${productName}.exe`);

  // Resolve icon — prefer build/icon.ico, fall back to electron/icon.ico
  const icoFromBuild    = path.join(__dirname, 'icon.ico');
  const icoFromElectron = path.join(__dirname, '..', 'electron', 'icon.ico');
  const resolvedIco = fs.existsSync(icoFromBuild) ? icoFromBuild : icoFromElectron;

  // Find rcedit — prefer electron-builder's cached x64 copy
  const rceditPaths = [
    path.join(os.homedir(), '.cache/electron-builder/winCodeSign/winCodeSign-2.6.0/rcedit-x64.exe'),
    path.join(os.homedir(), '.cache/electron-builder/winCodeSign/winCodeSign-2.6.0/rcedit-ia32.exe'),
    path.join(__dirname, '..', 'node_modules/electron-winstaller/vendor/rcedit.exe'),
  ];
  const rcedit = rceditPaths.find(p => fs.existsSync(p));

  if (!rcedit) {
    console.warn('[afterPack] rcedit not found — skipping icon + version embed');
    return;
  }
  if (!fs.existsSync(exePath)) {
    console.warn('[afterPack] exe not found at', exePath);
    return;
  }
  if (!fs.existsSync(resolvedIco)) {
    console.warn('[afterPack] icon.ico not found at', resolvedIco);
    return;
  }

  // Pad version to 4-part format required by Windows (e.g. "1.1.0" → "1.1.0.0")
  const versionParts = version.split('.').concat(['0', '0', '0']).slice(0, 4).join('.');

  const args = [
    exePath,
    // Icon
    '--set-icon', resolvedIco,
    // Version numbers
    '--set-file-version',    versionParts,
    '--set-product-version', versionParts,
    // Version strings — these are what Windows Shell reads to identify the app.
    // FileDescription must be unique across all apps; it is used as a fallback
    // AUMI when no explicit AUMI is set in a shortcut .lnk file.
    '--set-version-string', 'FileDescription',  productName,
    '--set-version-string', 'ProductName',      productName,
    '--set-version-string', 'InternalName',     'ExpenseTrack',
    '--set-version-string', 'OriginalFilename', `${productName}.exe`,
    '--set-version-string', 'CompanyName',      'Dunkin Global Advisors',
    '--set-version-string', 'LegalCopyright',   `Copyright © 2026 Dunkin Global Advisors`,
    '--set-version-string', 'ProductVersion',   version,
    '--set-version-string', 'FileVersion',      versionParts,
  ];

  console.log('[afterPack] Embedding icon + version strings into', path.basename(exePath));
  console.log('[afterPack]   icon:    ', resolvedIco);
  console.log('[afterPack]   rcedit:  ', rcedit);
  console.log('[afterPack]   version: ', versionParts);

  try {
    if (os.platform() === 'win32') {
      execFileSync(rcedit, args, { stdio: 'pipe' });
    } else {
      // Linux/macOS — run rcedit through Wine
      execFileSync('wine', [rcedit, ...args], {
        stdio: 'pipe',
        env: { ...process.env, WINEDEBUG: '-all' },
      });
    }
    console.log('[afterPack] Icon + version strings embedded successfully');
  } catch (err) {
    console.error('[afterPack] rcedit failed:', err.message);
    throw err;
  }
};
