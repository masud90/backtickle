#!/usr/bin/env bash
# Makes outputs/Backtickle-<version>.dmg from outputs/Backtickle.app (run `npm run build:app` first).
# Run through `npm run dmg`. The disk image holds the app and an Applications shortcut. The
# version comes from src-tauri/tauri.conf.json. Prints the SHA-256 of the image.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

app="outputs/Backtickle.app"
if [[ ! -d "$app" ]]; then
  echo "error: $app not found; run npm run build:app first" >&2
  exit 1
fi

version="$(node -p "require('./src-tauri/tauri.conf.json').version")"
dmg="outputs/Backtickle-${version}.dmg"

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

ditto "$app" "$stage/Backtickle.app"
ln -s /Applications "$stage/Applications"
cp LICENSE "$stage/LICENSE.txt"
cp THIRD_PARTY_NOTICES.md "$stage/THIRD_PARTY_NOTICES.md"
cp THIRD_PARTY_LICENSES.txt "$stage/THIRD_PARTY_LICENSES.txt"

rm -f "$dmg"
hdiutil create -volname "Backtickle" -srcfolder "$stage" -ov -format UDZO "$dmg" >/dev/null

echo "Built $dmg ($(du -h "$dmg" | cut -f1))"
shasum -a 256 "$dmg"
