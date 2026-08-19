#!/usr/bin/env bash
# OPTIONAL Claude Code adapter for the WorktreeRemove hook: tear this worktree's
# stack down before the directory disappears out from under it.
#
# Not load-bearing — scripts/reap-worktrees.sh finds stacks whose worktree is
# gone and cleans them up anyway. This just does it immediately, while we still
# know which stack belonged to the worktree being removed.
#
# Exit codes and stdout are ignored by the hook, so this is best-effort.
set -uo pipefail

LOG="${TMPDIR:-/tmp}/worktree-hook.log"
INPUT="$(cat)"
echo "[$(date)] WorktreeRemove input: $INPUT" >>"$LOG"

WORKTREE_PATH="$(node -e '
let d = "";
process.stdin.on("data", c => d += c);
process.stdin.on("end", () => {
  try { process.stdout.write(JSON.parse(d).worktree_path || ""); }
  catch (e) { process.stdout.write(""); }
});
' <<<"$INPUT")"

[ -n "$WORKTREE_PATH" ] && [ -d "$WORKTREE_PATH" ] || exit 0

# Prefer the name the worktree recorded; fall back to the name setup would have
# generated, so a worktree that never got a .env is still cleaned up.
PROJECT=""
[ -f "$WORKTREE_PATH/.env" ] &&
  PROJECT="$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' "$WORKTREE_PATH/.env" | head -1 | tr -d '[:space:]')"
[ -n "$PROJECT" ] ||
  PROJECT="hub-$(basename "$WORKTREE_PATH" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]/-/g')"

echo "[$(date)] tearing down '$PROJECT'" >>"$LOG"
docker compose -p "$PROJECT" down -v >>"$LOG" 2>&1 || true

exit 0
