#!/usr/bin/env bash
# Spin up an isolated git worktree with its own Docker Compose stack and local
# Supabase instance, so several branches can run side by side (each `./dev up`
# gets its own containers, network, and ports — no collisions).
#
#   scripts/new-worktree.sh <branch-name>
#
# Then, from the new worktree directory:
#   ./dev            # or: docker compose up
#
# The actual setup lives in scripts/lib/worktree-setup.sh, shared with the
# WorktreeCreate hook (scripts/worktree-create-hook.sh) so worktrees made via
# `claude --worktree` / isolation:"worktree" get the same isolation as ones
# made by hand here.
set -euo pipefail

BRANCH="${1:?usage: scripts/new-worktree.sh <branch-name>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKTREES_DIR="$ROOT/.claude/worktrees"
# Branch names often contain "/" (e.g. "feat/foo"); git is fine with that, but
# it would otherwise create nested directories under WORKTREES_DIR, breaking
# the offset scan below. Keep the on-disk dir a flat slug; the branch itself
# still gets the name as given.
SLUG="${BRANCH//\//-}"
TARGET="$WORKTREES_DIR/$SLUG"

if [ -e "$TARGET" ]; then
  echo "error: $TARGET already exists" >&2
  exit 1
fi

# shellcheck source=lib/worktree-setup.sh
source "$ROOT/scripts/lib/worktree-setup.sh"
setup_worktree "$BRANCH" "$TARGET"

echo
echo "cd \"$TARGET\" && ./dev"
