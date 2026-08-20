#!/usr/bin/env bash
# Give one worktree an isolated dev stack (.env, own ports, containers).
#
#   scripts/worktree-init.sh [worktree-dir]     # defaults to the cwd
#
# This is the single entry point every trigger uses — git's post-checkout hook,
# scripts/new-worktree.sh, and any agent-specific hook. Idempotent: running it
# on a worktree that already has a stack does nothing.
set -uo pipefail

TARGET="${1:-$(pwd)}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=lib/worktree-setup.sh
source "$HERE/lib/worktree-setup.sh"
setup_worktree "$TARGET"
