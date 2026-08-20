#!/usr/bin/env bash
# Create a worktree with its own Docker Compose stack and local Supabase
# instance, so several branches run side by side without port collisions.
#
#   scripts/new-worktree.sh <branch-name>
#   cd .worktrees/<branch-name> && ./dev
#
# You don't strictly need this script: with the git hooks installed
# (scripts/install-git-hooks.sh, run automatically by `npm install`), a plain
# `git worktree add` gets the same isolated stack. This is just the convenient
# front door — it picks the directory and prints where things ended up.
#
# Override the parent directory with WORKTREES_DIR=/some/path.
set -euo pipefail

BRANCH="${1:?usage: scripts/new-worktree.sh <branch-name>}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=lib/worktree-setup.sh
source "$HERE/lib/worktree-setup.sh"

MAIN_ROOT="$(wt_main_root "$HERE")"
# Branch names contain "/" (feat/foo); git is fine with that but it would nest
# directories, so the on-disk name is a flat slug while the branch keeps its "/".
SLUG="${BRANCH//\//-}"
TARGET="${WORKTREES_DIR:-$MAIN_ROOT/.worktrees}/$SLUG"

if [ -e "$TARGET" ]; then
  echo "error: $TARGET already exists" >&2
  exit 1
fi

mkdir -p "$(dirname "$TARGET")"
setup_worktree "$TARGET" "$BRANCH"

echo
echo "cd \"$TARGET\" && ./dev"
