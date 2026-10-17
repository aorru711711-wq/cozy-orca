#!/bin/sh
cd "$(dirname "$0")" || exit 1
app=
for candidate in "$PWD"/*.app; do
  app=$candidate
  break
done
if [ ! -d "$app" ]; then
  echo "Could not find Cozy Orca.app beside this script." >&2
  exit 1
fi
xattr -dr com.apple.quarantine "$app" 2>/dev/null || true
open "$app"
