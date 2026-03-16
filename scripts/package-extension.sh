#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ZIP_NAME="save-and-resume-upload.zip"
ZIP_PATH="$ROOT_DIR/$ZIP_NAME"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/save-resume-release.XXXXXX")"
RELEASE_DIR="$TMP_DIR/release"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "Building extension..."
npm run build

if [[ ! -d dist ]]; then
  echo "ERROR: dist directory was not created. Packaging stopped." >&2
  exit 1
fi

mkdir -p "$RELEASE_DIR"
cp -R dist/. "$RELEASE_DIR/"

echo "Creating $ZIP_NAME..."
rm -f "$ZIP_PATH"
(
  cd "$RELEASE_DIR"
  zip -qr "$ZIP_PATH" .
)

zip_human="$(du -h "$ZIP_PATH" | awk '{print $1}')"
zip_bytes="$(wc -c < "$ZIP_PATH" | tr -d '[:space:]')"
file_count="$(find "$RELEASE_DIR" -type f | wc -l | tr -d '[:space:]')"

echo
echo "Package ready."
echo "Files included: $file_count"
echo "Zip size: $zip_human ($zip_bytes bytes)"
echo "Zip path: $ZIP_PATH"
