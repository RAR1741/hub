#!/bin/bash
# OPTIONAL Claude Code adapter: after a `gh pr merge` run from inside a
# worktree, clean up immediately instead of waiting for the next `git pull` on
# master (git's own post-merge hook) or the next session start.
#
# All the logic lives in scripts/reap-worktrees.sh — this only decides WHEN.
# Deleting this file costs you nothing but promptness.
set -uo pipefail

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

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
MAIN_ROOT="$(cd "$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)/.." && pwd)" || exit 0

# The reap knows this worktree is its own cwd and queues it for the next run
# rather than trying to delete the directory out from under this process (which
# silently no-ops on Windows).
bash "$MAIN_ROOT/scripts/reap-worktrees.sh" 2>&1 | sed 's/^/[post-merge-cleanup] /'

echo "[post-merge-cleanup] PR merged. Stack torn down; the worktree finishes cleaning up on the next session start or the next 'git pull' on master."
