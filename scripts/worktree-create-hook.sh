#!/usr/bin/env bash
# WorktreeCreate hook — fires for native worktree creation (Agent tool's
# isolation:"worktree", `claude --worktree`, EnterWorktree) and replaces
# Claude Code's default `git worktree add`, so those get the same isolated
# Docker/Supabase stack as scripts/new-worktree.sh instead of an empty,
# detached-HEAD checkout with no .env.
#
# Contract (code.claude.com/docs/en/hooks#worktreecreate):
#   - stdin: JSON. Field names have changed across doc/tool versions (seen:
#     "name" alone in an older reference impl; "branch" + "worktree_path" as
#     separate fields per current docs) — parse them independently rather
#     than collapsing to one, and log the raw payload so the real shape is
#     captured on first live run.
#   - stdout: ONLY the absolute worktree path. Anything else breaks parsing.
#   - any non-zero exit fails worktree creation outright — must be safe to
#     retry (see setup_worktree's reuse-or-create handling).
# All progress/diagnostic output must go anywhere but stdout.
set -euo pipefail

ROOT="$CLAUDE_PROJECT_DIR"
WORKTREES_DIR="$ROOT/.claude/worktrees"
LOG="/tmp/worktree-hook.log"

INPUT="$(cat)"
echo "[$(date)] WorktreeCreate input: $INPUT" >>"$LOG"

# Print worktree_path and branch/name on separate lines so a payload that
# genuinely carries both (per current docs) doesn't get collapsed into one.
PARSED="$(node -e '
let d = "";
process.stdin.on("data", c => d += c);
process.stdin.on("end", () => {
  try {
    const j = JSON.parse(d);
    process.stdout.write((j.worktree_path || "") + "\n" + (j.branch || j.name || ""));
  } catch (e) {
    process.stdout.write("\n");
  }
});
' <<<"$INPUT")"
WORKTREE_PATH="$(echo "$PARSED" | sed -n 1p)"
NAME_OR_BRANCH="$(echo "$PARSED" | sed -n 2p)"

if [ -z "$WORKTREE_PATH" ] && [ -z "$NAME_OR_BRANCH" ]; then
  echo "worktree-create-hook: could not parse name/branch/worktree_path from stdin (see $LOG)" >&2
  exit 1
fi

# TARGET: prefer the explicit worktree_path Claude asked for; else derive one
# under WORKTREES_DIR the same way new-worktree.sh does.
if [ -n "$WORKTREE_PATH" ]; then
  TARGET="$WORKTREE_PATH"
else
  SLUG="${NAME_OR_BRANCH//\//-}"
  TARGET="$WORKTREES_DIR/$SLUG"
fi

# BRANCH: use the real branch/name field, never derived from the path — a
# native worktree's directory is a random-suffixed slug, not the branch name.
if [ -n "$NAME_OR_BRANCH" ]; then
  BRANCH="$NAME_OR_BRANCH"
else
  BRANCH="$(basename "$TARGET")"
fi

{
  source "$ROOT/scripts/lib/worktree-setup.sh"
  setup_worktree "$BRANCH" "$TARGET"
} >>"$LOG" 2>&1

# THE ONLY THING ON STDOUT.
echo "$TARGET"
