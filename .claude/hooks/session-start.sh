#!/bin/bash
# SessionStart hook for Claude Code on the web.
# Installs npm dependencies so lint, typecheck, and tests work in the session.
# Note: the full app stack (Supabase + Docker) from README is NOT started here —
# it requires Docker, which isn't available in the remote environment. This hook
# covers the static checks: eslint, tsc/typegen, and vitest.
set -euo pipefail

# Only run in the remote (web) environment; local dev uses the Docker container.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Idempotent, cache-friendly dependency install (prefer install over ci).
npm install
