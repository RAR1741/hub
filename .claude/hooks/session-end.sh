#!/bin/bash
# SessionEnd hook: stop this worktree's isolated Docker stack when a session
# closes, so containers don't pile up between sessions. Only stops containers
# (cheap to resume via SessionStart) — full removal of a merged worktree's
# stack happens when it's reaped: git's post-merge hook on the next `git pull`
# on master, or the next main-checkout SessionStart (scripts/reap-worktrees.sh).
set -euo pipefail

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] && exit 0
cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || exit 0
[ -f .env ] || exit 0
grep -q '^COMPOSE_PROJECT_NAME=' .env || exit 0

set -a; source .env; set +a
echo "[session-end] Stopping isolated stack '$COMPOSE_PROJECT_NAME'…"
docker compose -p "$COMPOSE_PROJECT_NAME" down >"/tmp/compose-down-$COMPOSE_PROJECT_NAME.log" 2>&1 || true
