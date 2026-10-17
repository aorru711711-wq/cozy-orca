#!/bin/sh
cd "$(dirname "$0")" || exit 1
export COZY_DATA_DIR="$PWD/data"
export TMPDIR="$PWD/.tmp"
mkdir -p "$TMPDIR" "$COZY_DATA_DIR"
exec "$PWD/Cozy Orca" --no-sandbox "$@"
