#!/usr/bin/env bash
# OPTIONAL Claude Code adapter for the WorktreeCreate hook (isolation:"worktree",
# `claude --worktree`, EnterWorktree). It exists only because that hook replaces
# Claude's own `git worktree add` and demands the worktree path on stdout.
#
# The lifecycle itself does NOT depend on this file: git's post-checkout hook
# (scripts/install-git-hooks.sh) already sets up any worktree, including the one
# Claude makes here, so this adapter just prints the path and lets the shared
# scripts do the work. Deleting it degrades nothing.
#
# Contract (code.claude.com/docs/en/hooks#worktreecreate):
#   - stdin: JSON with a worktree path and/or branch name; field names have
#     drifted across versions, so parse them independently.
#   - stdout: ONLY the absolute worktree path.
#   - non-zero exit fails worktree creation, so this must be safe to retry.
set -uo pipefail

LOG="${TMPDIR:-/tmp}/worktree-hook.log"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$HERE/.." && pwd)}"

INPUT="$(cat)"
echo "[$(date)] WorktreeCreate input: $INPUT" >>"$LOG"

# node is fine here (this file is agent-specific glue, not part of the git-hook
# path, which stays dependency-free).
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
  echo "worktree-create-hook: could not parse stdin (see $LOG)" >&2
  exit 1
fi

# Prefer the path Claude asked for; else derive one the way new-worktree.sh does.
if [ -n "$WORKTREE_PATH" ]; then
  TARGET="$WORKTREE_PATH"
else
  TARGET="${WORKTREES_DIR:-$ROOT/.worktrees}/${NAME_OR_BRANCH//\//-}"
fi
# Branch comes from the payload, never from the path: a native worktree's
# directory is a random-suffixed slug, not the branch name.
BRANCH="${NAME_OR_BRANCH:-$(basename "$TARGET")}"

{
  # shellcheck source=lib/worktree-setup.sh
  source "$HERE/lib/worktree-setup.sh"
  setup_worktree "$TARGET" "$BRANCH"
} >>"$LOG" 2>&1

# THE ONLY THING ON STDOUT.
echo "$TARGET"
