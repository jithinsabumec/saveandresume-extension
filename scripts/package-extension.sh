#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ZIP_NAME="save-and-resume-upload.zip"
ZIP_PATH="$ROOT_DIR/$ZIP_NAME"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/save-resume-release.XXXXXX")"
RELEASE_DIR="$TMP_DIR/release"
FILE_LIST="$TMP_DIR/runtime-files.txt"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "Building extension..."
npm run build

echo "Collecting runtime files from manifest and local file references..."
node > "$FILE_LIST" <<'NODE'
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const manifestPath = path.join(root, 'manifest.json');

if (!fs.existsSync(manifestPath)) {
  throw new Error('manifest.json was not found in project root.');
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const files = new Set(['manifest.json']);
const parsed = new Set();

const STATIC_SOURCE_RE = /\.(?:html?|css|js|mjs|cjs)$/i;
const EMBEDDED_ASSET_RE = /["'`]([^"'`]+?\.(?:svg|png|jpe?g|gif|webp|ttf|woff2?|css|js|html))["'`]/gi;

function normalizeRel(rawPath, baseDir = '.') {
  if (!rawPath) return null;

  let candidate = String(rawPath).trim();
  if (!candidate) return null;

  candidate = candidate.replace(/^['"]|['"]$/g, '');
  candidate = candidate.split('#')[0].split('?')[0].trim();
  if (!candidate) return null;

  if (/^(?:https?:|data:|chrome:|mailto:|about:|javascript:)/i.test(candidate)) return null;
  if (candidate.startsWith('//')) return null;
  if (candidate.startsWith('/')) return null;

  const normalized = path.normalize(path.join(baseDir, candidate));
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) return null;
  return normalized.replace(/\\/g, '/');
}

function enqueue(filePath, baseDir = '.') {
  const rel = normalizeRel(filePath, baseDir);
  if (!rel) return;

  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return;
  if (!fs.statSync(abs).isFile()) return;

  files.add(rel);
  if (STATIC_SOURCE_RE.test(rel) && !parsed.has(rel)) {
    parseFile(rel);
  }
}

function parseFile(relPath) {
  if (parsed.has(relPath)) return;
  parsed.add(relPath);

  const abs = path.join(root, relPath);
  let content = '';
  try {
    content = fs.readFileSync(abs, 'utf8');
  } catch {
    return;
  }

  const dir = path.posix.dirname(relPath);
  const ext = path.extname(relPath).toLowerCase();

  if (ext === '.html' || ext === '.htm') {
    const attrRefRe = /(?:src|href)=["']([^"']+)["']/gi;
    let match;
    while ((match = attrRefRe.exec(content))) {
      enqueue(match[1], dir);
    }
  }

  if (ext === '.css') {
    const urlRe = /url\(([^)]+)\)/gi;
    let match;
    while ((match = urlRe.exec(content))) {
      enqueue(match[1], dir);
    }

    const importRe = /@import\s+(?:url\()?['"]([^"']+)['"]\)?/gi;
    while ((match = importRe.exec(content))) {
      enqueue(match[1], dir);
    }
  }

  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
    const getUrlRe = /chrome\.runtime\.getURL\(\s*['"]([^'"]+)['"]\s*\)/gi;
    let match;
    while ((match = getUrlRe.exec(content))) {
      enqueue(match[1], dir);
    }

    // Skip deep string scanning for large generated bundles.
    if (content.length <= 350000) {
      const importRe = /(?:import\s+[^'"]*from\s*|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]\s*\)?/gi;
      while ((match = importRe.exec(content))) {
        const specifier = match[1];
        if (!(specifier.startsWith('.') || specifier.startsWith('/'))) continue;

        const candidates = [
          specifier,
          `${specifier}.js`,
          `${specifier}.mjs`,
          `${specifier}.cjs`,
          `${specifier}.json`,
          `${specifier}/index.js`
        ];
        for (const candidate of candidates) {
          enqueue(candidate, dir);
        }
      }

      EMBEDDED_ASSET_RE.lastIndex = 0;
      let embeddedMatch;
      while ((embeddedMatch = EMBEDDED_ASSET_RE.exec(content))) {
        enqueue(embeddedMatch[1], dir);
      }
    }
  }
}

function addFromManifest() {
  if (manifest.background && manifest.background.service_worker) {
    enqueue(manifest.background.service_worker);
  }

  if (manifest.action && manifest.action.default_popup) {
    enqueue(manifest.action.default_popup);
  }

  if (manifest.action && manifest.action.default_icon) {
    if (typeof manifest.action.default_icon === 'string') {
      enqueue(manifest.action.default_icon);
    } else {
      Object.values(manifest.action.default_icon).forEach((iconPath) => enqueue(iconPath));
    }
  }

  if (manifest.icons && typeof manifest.icons === 'object') {
    Object.values(manifest.icons).forEach((iconPath) => enqueue(iconPath));
  }

  for (const scriptBlock of manifest.content_scripts || []) {
    for (const jsFile of scriptBlock.js || []) {
      enqueue(jsFile);
    }
    for (const cssFile of scriptBlock.css || []) {
      enqueue(cssFile);
    }
  }

  for (const resourceBlock of manifest.web_accessible_resources || []) {
    for (const resource of resourceBlock.resources || []) {
      enqueue(resource);
    }
  }

  if (manifest.options_page) enqueue(manifest.options_page);
  if (manifest.options_ui && manifest.options_ui.page) enqueue(manifest.options_ui.page);
  if (manifest.devtools_page) enqueue(manifest.devtools_page);
  if (manifest.side_panel && manifest.side_panel.default_path) enqueue(manifest.side_panel.default_path);

  if (manifest.chrome_url_overrides && typeof manifest.chrome_url_overrides === 'object') {
    Object.values(manifest.chrome_url_overrides).forEach((overridePage) => enqueue(overridePage));
  }
}

addFromManifest();

for (const file of [...files].sort((a, b) => a.localeCompare(b))) {
  console.log(file);
}
NODE

if [[ ! -s "$FILE_LIST" ]]; then
  echo "ERROR: Runtime file list is empty. Packaging stopped." >&2
  exit 1
fi

echo "Checking for forbidden files in package list..."
forbidden_matches=()
while IFS= read -r rel; do
  [[ -z "$rel" ]] && continue

  if [[ "$rel" == node_modules/* || "$rel" == .git/* || "$rel" == ".env" || "$rel" == .env.* || "$rel" == *.zip || "$rel" == *.backup || "$rel" == *.bak || "$rel" == README.md || "$rel" == docs/* || "$rel" == doc/* ]]; then
    forbidden_matches+=("$rel")
  fi
done < "$FILE_LIST"

if (( ${#forbidden_matches[@]} > 0 )); then
  echo "ERROR: Packaging blocked because forbidden files were selected:" >&2
  printf ' - %s\n' "${forbidden_matches[@]}" >&2
  exit 1
fi

mkdir -p "$RELEASE_DIR"
while IFS= read -r rel; do
  [[ -z "$rel" ]] && continue
  mkdir -p "$RELEASE_DIR/$(dirname "$rel")"
  cp -p "$rel" "$RELEASE_DIR/$rel"
done < "$FILE_LIST"

echo "Creating $ZIP_NAME..."
rm -f "$ZIP_PATH"
(
  cd "$RELEASE_DIR"
  zip -qr "$ZIP_PATH" .
)

zip_human="$(du -h "$ZIP_PATH" | awk '{print $1}')"
zip_bytes="$(wc -c < "$ZIP_PATH" | tr -d '[:space:]')"
file_count="$(wc -l < "$FILE_LIST" | tr -d '[:space:]')"

echo
echo "Package ready."
echo "Files included: $file_count"
echo "Zip size: $zip_human ($zip_bytes bytes)"
echo "Zip path: $ZIP_PATH"
