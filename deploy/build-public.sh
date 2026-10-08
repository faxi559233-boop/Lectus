#!/usr/bin/env bash
# Copies ONLY the public front-end files (allow-list) into a directory that a web server can serve.
# Usage: build-public.sh <source-repo-dir> <target-dir> [--no-portal]
set -euo pipefail
SRC="${1:?source dir}"; DST="${2:?target dir}"; WITH_PORTAL=1; [ "${3:-}" = "--no-portal" ] && WITH_PORTAL=0
FILES=(index.html styles.css app.js ui.js icons.js xlsx.js i18n.js sw.js manifest.webmanifest)
rm -rf "$DST.new"; mkdir -p "$DST.new"
for f in "${FILES[@]}"; do cp "$SRC/$f" "$DST.new/$f"; done
cp -r "$SRC/icons" "$DST.new/icons"
if [ "$WITH_PORTAL" = 1 ] && [ -d "$SRC/portal" ]; then cp -r "$SRC/portal" "$DST.new/portal"; fi
rm -rf "$DST.old"; [ -d "$DST" ] && mv "$DST" "$DST.old"; mv "$DST.new" "$DST"; rm -rf "$DST.old"
echo "public files -> $DST ($(find "$DST" -type f | wc -l) files)"
