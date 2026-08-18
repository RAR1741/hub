#!/usr/bin/env bash
# WorktreeRemove hook — fires when a native worktree (isolation:"worktree",
# --worktree) is torn down at session/subagent exit. Exit codes and stdout
# are ignored for control flow here, so this is best-effort: tear the stack
# down before the directory disappears out from under it.
set -uo pipefail

LOG="/tmp/worktree-hook.log"
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
[ -f "$WORKTREE_PATH/.env" ] || exit 0
grep -q '^COMPOSE_PROJECT_NAME=' "$WORKTREE_PATH/.env" || exit 0

(
  set -a; source "$WORKTREE_PATH/.env"; set +a
  echo "[$(date)] tearing down '$COMPOSE_PROJECT_NAME'" >>"$LOG"
  docker compose -p "$COMPOSE_PROJECT_NAME" down -v >>"$LOG" 2>&1 || true
)

exit 0
