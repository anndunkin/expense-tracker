#!/usr/bin/env bash
# ExpenseTrack — Post-build signing script
#
# Signs all .exe and .dll files in dist-electron/win-unpacked/ using
# osslsigncode and the self-signed certificate in build/signing.pfx.
#
# Certificate: CN=Ann Dunkin, O=Dunkin Global Advisors, OU=Software, C=US
# Valid through: April 2031
#
# Usage (run from project root after npm run build:electron):
#   bash build/sign.sh
#
# Prerequisites:
#   sudo apt-get install osslsigncode   (Ubuntu/Debian)
#   brew install osslsigncode           (macOS)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
UNPACKED="$PROJECT_DIR/dist-electron/win-unpacked"
CERT="$SCRIPT_DIR/signing.crt"
KEY="$SCRIPT_DIR/signing.key"
URL="https://github.com/anndunkin/expense-tracker"
APP_NAME="ExpenseTrack"

if [ ! -f "$CERT" ] || [ ! -f "$KEY" ]; then
  echo "ERROR: Signing certificate or key not found in build/"
  echo "  Expected: build/signing.crt and build/signing.key"
  echo "  Run: openssl genrsa ... and openssl req ... to regenerate"
  exit 1
fi

if ! command -v osslsigncode &>/dev/null; then
  echo "ERROR: osslsigncode not installed"
  echo "  Ubuntu/Debian: sudo apt-get install osslsigncode"
  echo "  macOS:         brew install osslsigncode"
  exit 1
fi

if [ ! -d "$UNPACKED" ]; then
  echo "ERROR: win-unpacked directory not found at $UNPACKED"
  echo "  Run: npx electron-builder --win --x64 first"
  exit 1
fi

echo "Signing binaries in: $UNPACKED"
echo ""

PASS=0
FAIL=0

sign_file() {
  local FILE="$1"
  local NAME
  NAME=$(basename "$FILE")
  local TMP="${FILE}.signed"

  osslsigncode sign \
    -certs "$CERT" \
    -key "$KEY" \
    -n "$APP_NAME" \
    -i "$URL" \
    -h sha256 \
    -in "$FILE" \
    -out "$TMP" 2>&1

  if [ $? -eq 0 ] && [ -f "$TMP" ]; then
    mv "$TMP" "$FILE"
    echo "  ✅  $NAME"
    ((PASS++))
  else
    rm -f "$TMP"
    echo "  ❌  FAILED: $NAME"
    ((FAIL++))
  fi
}

# Sign main executable first, then all DLLs
for FILE in "$UNPACKED"/*.exe "$UNPACKED"/*.dll; do
  [ -f "$FILE" ] && sign_file "$FILE"
done

echo ""
echo "Done: $PASS signed, $FAIL failed"

if [ $FAIL -gt 0 ]; then
  exit 1
fi

# Re-zip
echo ""
echo "Re-packaging..."
VERSION=$(node -p "require('$PROJECT_DIR/package.json').version" 2>/dev/null || echo "1.0.2")
ZIP="$PROJECT_DIR/dist-electron/ExpenseTrack-${VERSION}-Windows-x64.zip"
cd "$PROJECT_DIR/dist-electron"
rm -f "$ZIP"
zip -r "$ZIP" win-unpacked/ > /dev/null
echo "✅  Signed zip: $ZIP ($(du -sh "$ZIP" | cut -f1))"
