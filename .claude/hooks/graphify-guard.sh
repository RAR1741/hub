#!/bin/bash
# Wraps graphify hook-guard calls. Exits 0 (no-op allow) when graphify is not
# installed — prevents the Windows-native EXE path from blocking all tool calls
# in a remote Linux environment.
set -euo pipefail

GRAPHIFY=""
if command -v graphify >/dev/null 2>&1; then
  GRAPHIFY="graphify"
elif command -v graphify.EXE >/dev/null 2>&1; then
  GRAPHIFY="graphify.EXE"
fi

[ -z "$GRAPHIFY" ] && exit 0

exec "$GRAPHIFY" hook-guard "$@"
