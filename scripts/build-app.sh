#!/usr/bin/env bash
# Builds the release app bundle and copies it to outputs/Writedown.app.
# Run through `npm run build:app`. With --universal (`npm run build:app:universal`) the app is
# built for both Apple silicon and Intel; that needs the Intel Rust target
# (`rustup target add x86_64-apple-darwin`).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

universal=0
for arg in "$@"; do
  case "$arg" in
    --universal) universal=1 ;;
    *)
      echo "usage: scripts/build-app.sh [--universal]" >&2
      exit 2
      ;;
  esac
done

if [[ "$universal" -eq 1 ]]; then
  npm run tauri -- build --bundles app --target universal-apple-darwin
  bundle="src-tauri/target/universal-apple-darwin/release/bundle/macos/Writedown.app"
else
  npm run tauri -- build --bundles app
  bundle="src-tauri/target/release/bundle/macos/Writedown.app"
fi

if [[ ! -d "$bundle" ]]; then
  echo "error: expected app bundle not found at $bundle" >&2
  exit 1
fi

mkdir -p outputs
rm -rf outputs/Writedown.app
ditto "$bundle" outputs/Writedown.app
echo "Built outputs/Writedown.app"
