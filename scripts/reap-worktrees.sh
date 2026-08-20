#!/usr/bin/env bash
# Reclaim finished worktrees: tear down the Docker stack, remove the worktree,
# delete the local branch. Safe to run at any time, from anywhere in the repo,
# as often as you like.
#
#   scripts/reap-worktrees.sh
#
# HARNESS-AGNOSTIC. Triggered by git's own post-merge hook (installed by
# scripts/install-git-hooks.sh) so `git pull` on master reaps whatever that
# merge finished — including PRs merged from the GitHub web UI. Agent hooks may
# also call it; they get no special treatment and add no behavior.
#
# What it will NOT do: touch the main working tree, touch a worktree on
# master, force-remove a worktree with uncommitted work, or delete a remote
# branch.
set -uo pipefail

log() { echo "[reap] $*"; }

MAIN_ROOT="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || {
  log "not a git repository — nothing to do"; exit 0
}
COMMON_DIR="$MAIN_ROOT"
MAIN_ROOT="$(cd "$COMMON_DIR/.." && pwd)"
QUEUE="$COMMON_DIR/worktree-cleanup-queue"
SELF="$(pwd -P)"

# REAP_SKIP_DOCKER=1 leaves containers alone (used by the test suite, which runs
# against a throwaway clone: stack names are global to the docker daemon, so a
# clone must not be allowed to decide that this machine's stacks are orphans).
HAVE_DOCKER=0
[ "${REAP_SKIP_DOCKER:-}" != "1" ] && command -v docker >/dev/null 2>&1 && HAVE_DOCKER=1
HAVE_GH=0
command -v gh >/dev/null 2>&1 && HAVE_GH=1

# Compose project name for a worktree: whatever its .env claims, else the same
# name setup would have generated (so bare worktrees still get cleaned up).
stack_name() {
  local dir="$1" name=""
  [ -f "$dir/.env" ] && name="$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' "$dir/.env" | head -1 | tr -d '[:space:]')"
  [ -n "$name" ] || name="hub-$(basename "$dir" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]/-/g')"
  printf '%s' "$name"
}

stack_down() {
  local name="$1"
  [ "$HAVE_DOCKER" = "1" ] || return 0
  log "tearing down stack '$name'"
  docker compose -p "$name" down -v >"${TMPDIR:-/tmp}/compose-down-$name.log" 2>&1 || true
}

# Queue a worktree we can't delete from here. A process cannot remove the
# directory that is its own cwd — on Windows the removal silently no-ops even
# though `git worktree remove` reports success — so defer to the next run,
# which will be some unrelated process holding no handle on it.
enqueue() {
  printf '%s\t%s\n' "$1" "$2" >>"$QUEUE"
}

# Remove worktree + local branch. Non-force: git refuses when there's
# uncommitted work, and that refusal is the safety net, not a bug to work
# around. Returns non-zero if the worktree survived.
remove_worktree() {
  local dir="$1" branch="$2" dir_real=""
  # Canonicalize before comparing: git prints "C:/Users/…" while pwd prints
  # "/c/Users/…" under Git Bash, so a raw string compare would never match and
  # we'd try to delete our own cwd (silently no-ops on Windows).
  [ -d "$dir" ] && dir_real="$(cd "$dir" && pwd -P)"
  if [ -n "$dir_real" ] && [ "$dir_real" = "$SELF" ]; then
    log "'$branch' is the directory this is running from — queued for next run"
    enqueue "$dir" "$branch"
    return 1
  fi
  if [ ! -e "$dir" ]; then
    git -C "$MAIN_ROOT" worktree prune
  elif ! git -C "$MAIN_ROOT" worktree remove "$dir" 2>/dev/null; then
    log "worktree '$branch' has uncommitted work or is busy — left in place"
    return 1
  fi
  if [ -n "$branch" ] && [ "$branch" != "master" ]; then
    git -C "$MAIN_ROOT" branch -D "$branch" 2>/dev/null || true
  fi
  log "removed worktree '$branch'"
  return 0
}

# --- 1. drain the deferred-removal queue -------------------------------------
# Deduped, and entries whose directory is already gone are dropped instead of
# being rewritten forever (that leak is why the queue used to grow without
# bound). `|| [ -n "$dir" ]` keeps the last line when the file has no trailing
# newline — the same read-drops-final-line trap that used to make the sweep
# below skip the most recently created worktree, every time.
# One-time migration: the queue used to live under .claude/ (agent-specific and
# invisible to a plain-git checkout). Fold any leftovers into the git-dir queue.
LEGACY_QUEUE="$MAIN_ROOT/.claude/worktrees/.pending-cleanup"
if [ -f "$LEGACY_QUEUE" ]; then
  cat "$LEGACY_QUEUE" >>"$QUEUE"
  printf '\n' >>"$QUEUE"
  rm -f "$LEGACY_QUEUE"
fi

if [ -s "$QUEUE" ]; then
  REMAINING="$(mktemp)"
  sort -u "$QUEUE" | while IFS=$'\t' read -r dir branch || [ -n "$dir" ]; do
    [ -n "$dir" ] || continue
    remove_worktree "$dir" "$branch" || {
      [ -e "$dir" ] && printf '%s\t%s\n' "$dir" "$branch" >>"$REMAINING"
    }
  done
  if [ -s "$REMAINING" ]; then mv "$REMAINING" "$QUEUE"; else rm -f "$REMAINING" "$QUEUE"; fi
fi

git -C "$MAIN_ROOT" worktree prune

# --- 2. list the live worktrees ----------------------------------------------
# awk (not a JS/JSON round-trip) so a git hook needs nothing but git + coreutils.
# Skips the first entry: that's the main working tree, which is never reaped.
WORKTREES="$(git -C "$MAIN_ROOT" worktree list --porcelain | awk '
  /^worktree /  { if (n++) { path = substr($0, 10); branch = "" } else { path = ""; next } }
  /^branch /    { if (path != "") { sub(/^branch refs\/heads\//, ""); print path "\t" $0 } }
')"

# --- 3. orphaned stacks ------------------------------------------------------
# A stack whose worktree is already gone (agent killed mid-flight, directory
# deleted by hand) keeps its containers and ports forever. Reconcile running
# hub-* projects against the live worktrees and down the strays.
if [ "$HAVE_DOCKER" = "1" ]; then
  LIVE_STACKS="$(printf '%s\n' "$WORKTREES" | cut -f1 | while IFS= read -r d; do
    [ -n "$d" ] && stack_name "$d" && echo
  done)"
  docker compose ls -q -a 2>/dev/null | while IFS= read -r project || [ -n "$project" ]; do
    case "$project" in hub-*) ;; *) continue ;; esac
    printf '%s\n' "$LIVE_STACKS" | grep -qxF "$project" && continue
    log "stack '$project' has no worktree"
    stack_down "$project"
  done
fi

# --- 4. reap merged worktrees ------------------------------------------------
# Merge oracle: ask GitHub first. `gh pr list --state merged` is the only check
# that sees a SQUASH merge — a squashed branch is not an ancestor of master, so
# the local-only test below silently misses it (that's why squash-merged
# branches used to pile up). Fall back to the ancestor test when gh is missing
# or offline.
# ponytail: no `git fetch` here — gh already reflects the remote, and the
#   fallback stays honest by only reaping what's provably merged locally.
MASTER_REF=""
for ref in origin/master master; do
  git -C "$MAIN_ROOT" rev-parse --verify "$ref" >/dev/null 2>&1 && { MASTER_REF="$ref"; break; }
done

is_merged() {
  local branch="$1" pr="" gh_answered=0
  if [ "$HAVE_GH" = "1" ]; then
    # Branch on gh's EXIT STATUS, not just its output: gh also fails when it
    # can't resolve a GitHub repo (no remote, offline, not logged in). Treating
    # that as "not merged" would quietly disable cleanup everywhere; treating
    # only a successful "no merged PR" as authoritative keeps both honest.
    if pr="$(cd "$MAIN_ROOT" && gh pr list --head "$branch" --state merged --limit 1 \
               --json number --jq '.[0].number // empty' 2>/dev/null)"; then
      gh_answered=1
      [ -n "$pr" ] && { log "'$branch' merged in PR #$pr"; return 0; }
    fi
  fi
  [ "$gh_answered" = "1" ] && return 1
  [ -n "$MASTER_REF" ] || return 1

  # A branch nobody has committed to yet is an ancestor of master BY
  # DEFINITION, so the ancestor test alone would delete the worktree of an
  # agent that had merely started working — the moment anyone pulled master.
  # Require evidence of real work: more than the single "branch: Created
  # from …" reflog entry.
  # ponytail: a branch checked out from an already-fetched remote branch also
  #   has one entry, so the offline oracle skips it. Conservative on purpose —
  #   gh is the primary oracle and handles that case.
  local history
  history="$(git -C "$MAIN_ROOT" reflog show "$branch" 2>/dev/null | wc -l | tr -d ' ')"
  if [ "${history:-0}" -le 1 ]; then
    return 1
  fi

  if git -C "$MAIN_ROOT" merge-base --is-ancestor "$branch" "$MASTER_REF" 2>/dev/null; then
    log "'$branch' is an ancestor of $MASTER_REF"
    return 0
  fi
  return 1
}

printf '%s\n' "$WORKTREES" | while IFS=$'\t' read -r dir branch || [ -n "$dir" ]; do
  [ -n "$dir" ] && [ -n "$branch" ] || continue
  [ "$branch" = "master" ] && continue
  is_merged "$branch" || continue
  stack_down "$(stack_name "$dir")"
  remove_worktree "$dir" "$branch"
done

exit 0
