/**
 * electron-builder afterPack hook
 * Embeds the custom icon into "Expense Track.exe" using rcedit (via Wine on Linux).
 * This runs after the app is packaged, ensuring the exe carries the correct icon
 * so it appears on the Windows taskbar and in Explorer.
 */
const { execFileSync } = require('child_process');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

module.exports = async function afterPack(context) {
  // Only applies to Windows targets
  if (context.electronPlatformName !== 'win32') return;

  const exePath = path.join(context.appOutDir, `${context.packager.appInfo.productName}.exe`);
  const icoPath = path.join(__dirname, 'icon.ico');

  // Resolve icon path — the ico lives in the electron/ directory
  const icoFromElectron = path.join(__dirname, '..', 'electron', 'icon.ico');
  const resolvedIco = fs.existsSync(icoPath) ? icoPath : icoFromElectron;

  // Find rcedit — prefer electron-builder's cached x64 copy, fall back to winstaller vendor
  const rceditPaths = [
    path.join(os.homedir(), '.cache/electron-builder/winCodeSign/winCodeSign-2.6.0/rcedit-x64.exe'),
    path.join(os.homedir(), '.cache/electron-builder/winCodeSign/winCodeSign-2.6.0/rcedit-ia32.exe'),
    path.join(__dirname, '..', 'node_modules/electron-winstaller/vendor/rcedit.exe'),
  ];
  const rcedit = rceditPaths.find(p => fs.existsSync(p));

  if (!rcedit) {
    console.warn('[afterPack] rcedit not found — skipping icon embed');
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

  console.log('[afterPack] Embedding icon into', path.basename(exePath));
  console.log('[afterPack]   icon:', resolvedIco);
  console.log('[afterPack]   rcedit:', rcedit);

  try {
    if (os.platform() === 'win32') {
      execFileSync(rcedit, [exePath, '--set-icon', resolvedIco], { stdio: 'pipe' });
    } else {
      // Linux/macOS — run rcedit through Wine
      execFileSync('wine', [rcedit, exePath, '--set-icon', resolvedIco], {
        stdio: 'pipe',
        env: { ...process.env, WINEDEBUG: '-all' },
      });
    }
    console.log('[afterPack] Icon embedded successfully');
  } catch (err) {
    console.error('[afterPack] rcedit failed:', err.message);
    throw err;
  }
};
