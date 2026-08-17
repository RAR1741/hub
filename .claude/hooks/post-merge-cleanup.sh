#!/bin/bash
# PostToolUse hook (Bash): after a `gh pr merge` call succeeds from inside one
# of our isolated worktrees (see scripts/new-worktree.sh), fully tear it down —
# stack + volumes + the worktree + its local branch — so merged feature work
# doesn't leave containers or worktrees lying around.
set -euo pipefail

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] && exit 0

INPUT="$(cat)"
PARSE='
let d="";
process.stdin.on("data", c => d += c);
process.stdin.on("end", () => {
  try {
    const j = JSON.parse(d);
    process.stdout.write(process.argv[1] === "cmd"
      ? ((j.tool_input && j.tool_input.command) || "")
      : (j.tool_response && (j.tool_response.is_error || j.tool_response.interrupted) ? "0" : "1"));
  } catch (e) {
    process.stdout.write(process.argv[1] === "cmd" ? "" : "0");
  }
});
'
CMD="$(node -e "$PARSE" cmd <<<"$INPUT")"
SUCCESS="$(node -e "$PARSE" success <<<"$INPUT")"

case "$CMD" in
  *"gh pr merge"*) ;;
  *) exit 0 ;;
esac
[ "$SUCCESS" = "1" ] || exit 0

cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || exit 0
[ -f .env ] || exit 0
grep -q '^COMPOSE_PROJECT_NAME=' .env || exit 0

set -a; source .env; set +a
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
COMMON_DIR="$(git rev-parse --git-common-dir)"
MAIN_ROOT="$(cd "$(dirname "$COMMON_DIR")" && pwd)"
WORKTREE_DIR="$(pwd)"

echo "[post-merge-cleanup] PR merged — tearing down stack '$COMPOSE_PROJECT_NAME'…"
docker compose -p "$COMPOSE_PROJECT_NAME" down -v >"/tmp/compose-down-$COMPOSE_PROJECT_NAME.log" 2>&1 || true

# Can't `git worktree remove`/rmdir this directory from here: this session's
# own process still has it as its cwd, and on Windows a directory can't be
# deleted while anything holds it open (removal silently no-ops the folder
# even though `git worktree remove` reports success). Queue it instead — the
# next SessionStart in the MAIN checkout (a different, unrelated process)
# finishes the job. See the "pending worktree cleanup" block in
# .claude/hooks/session-start.sh.
mkdir -p "$MAIN_ROOT/.claude/worktrees"
echo "$WORKTREE_DIR	$BRANCH" >> "$MAIN_ROOT/.claude/worktrees/.pending-cleanup"

echo "[post-merge-cleanup] Docker stack removed. Worktree '$BRANCH' queued for removal — it'll be cleaned up automatically next time a session starts in the main checkout (can't be deleted from inside itself)."
