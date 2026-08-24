#!/usr/bin/env bash
# Install this repo's worktree lifecycle into git's own hooks:
#
#   post-checkout  new linked worktree  -> scripts/worktree-init.sh (isolated stack)
#   post-merge     master moved         -> scripts/reap-worktrees.sh (clean up merged)
#
#   scripts/install-git-hooks.sh              # install / repair
#   scripts/install-git-hooks.sh --uninstall  # remove just our blocks
#
# Why git hooks and not an agent's hooks: git fires these for `git worktree add`
# and `git pull` no matter what created them, so the same lifecycle works under
# plain git, an IDE, Claude Code, t3code, herdr, or whatever comes next. Nothing
# here depends on an agent being installed. Runs automatically via package.json
# "prepare" (npm install), and is idempotent, so a fresh clone is covered.
#
# Our contribution is delimited by markers and appended, so it coexists with
# hooks other tools install in the same file (graphify installs its own blocks).
set -uo pipefail

START='# hub-worktree-hooks-start'
END='# hub-worktree-hooks-end'

COMMON_DIR="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || {
  echo "install-git-hooks: not a git repository — skipping"; exit 0
}
MAIN_ROOT="$(cd "$COMMON_DIR/.." && pwd)"

# Honor core.hooksPath if this repo/user has redirected it.
HOOKS_DIR="$(git config --get core.hooksPath || true)"
if [ -n "$HOOKS_DIR" ]; then
  case "$HOOKS_DIR" in
    /*|[A-Za-z]:*) ;;
    *) HOOKS_DIR="$MAIN_ROOT/$HOOKS_DIR" ;;
  esac
else
  HOOKS_DIR="$COMMON_DIR/hooks"
fi
mkdir -p "$HOOKS_DIR"

strip_block() {
  local file="$1"
  [ -f "$file" ] || return 0
  # Delimiter is "|", not "#": the markers themselves start with "#", which
  # would close a #-delimited address early and silently match nothing.
  sed -i.bak "\|^$START\$|,\|^$END\$|d" "$file"
  rm -f "$file.bak"
}

if [ "${1:-}" = "--uninstall" ]; then
  for hook in post-checkout post-merge; do
    strip_block "$HOOKS_DIR/$hook"
  done
  echo "install-git-hooks: removed hub blocks from $HOOKS_DIR"
  exit 0
fi

install_block() {
  # Separate statements on purpose: bash expands every word of a `local`
  # command before it assigns any of them, so referring to $hook in the same
  # `local` would read an unset variable.
  local hook="$1"
  local body="$2"
  local file="$HOOKS_DIR/$hook"

  if [ ! -f "$file" ]; then
    printf '#!/bin/sh\n' >"$file"
  fi
  # Replace our previous block rather than stacking a second copy.
  grep -qF "$START" "$file" && strip_block "$file"

  {
    printf '%s\n' "$START"
    printf '%s\n' "$body"
    printf '%s\n' "$END"
  } >>"$file"
  chmod +x "$file" 2>/dev/null || true
  echo "install-git-hooks: $hook -> $file"
}

# NOTE for editors of the blocks below:
#  - They run under /bin/sh (dash on Linux), so no bashisms.
#  - Never `exit` from a block: these are appended, and an exit would swallow
#    any hook another tool appends after us.
#  - A linked worktree has a .git FILE; the main working tree has a .git DIR.
#    That test is more reliable inside hooks than comparing --git-dir to
#    --git-common-dir, because git may export GIT_DIR to the hook.
#  - Scripts are invoked via `bash` rather than executed directly: the +x bit
#    does not survive checkout on Windows filesystems.

install_block post-checkout "$(cat <<'HOOK'
# A new linked worktree was just created ($1 all-zeros, branch checkout):
# give it an isolated Docker/Supabase stack on its own ports.
# HUB_WORKTREE_SETUP is set while our own setup calls `git worktree add`,
# which fires this same hook — without it we would re-enter and double-start.
if [ "$1" = "0000000000000000000000000000000000000000" ] && [ "$3" = "1" ] && [ -z "${HUB_WORKTREE_SETUP:-}" ]; then
  _hub_top=$(git rev-parse --show-toplevel 2>/dev/null)
  if [ -n "$_hub_top" ] && [ -f "$_hub_top/.git" ] && [ -f "$_hub_top/scripts/worktree-init.sh" ]; then
    bash "$_hub_top/scripts/worktree-init.sh" "$_hub_top" ||
      echo "hub: worktree stack setup failed — run scripts/worktree-init.sh by hand" >&2
  fi
fi
HOOK
)"

install_block post-merge "$(cat <<'HOOK'
# master just moved (git pull / git merge), so PRs merged anywhere — including
# the GitHub web UI — have landed. Reap worktrees whose branch is merged.
# Backgrounded with output to a log so git never blocks on docker teardown.
_hub_top=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -n "$_hub_top" ] && [ ! -f "$_hub_top/.git" ] && [ -f "$_hub_top/scripts/reap-worktrees.sh" ]; then
  if [ "$(git symbolic-ref --short -q HEAD)" = "master" ]; then
    ( bash "$_hub_top/scripts/reap-worktrees.sh" >"${TMPDIR:-/tmp}/hub-reap.log" 2>&1 & )
  fi
fi
HOOK
)"
