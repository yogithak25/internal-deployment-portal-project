#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/build"
PKG="$BUILD/lambda_pkg"
ZIP="$BUILD/lambda.zip"
BACKEND="$ROOT/backend"
rm -rf "$PKG"
mkdir -p "$PKG"
python3 -m pip install -r "$BACKEND/requirements.txt" -t "$PKG"
cp "$BACKEND"/*.py "$PKG/"
rm -f "$ZIP"
(cd "$PKG" && zip -r "$ZIP" .)
echo "Created $ZIP"
