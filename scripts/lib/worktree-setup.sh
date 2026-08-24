# Shared setup for an isolated per-worktree dev stack: the app container plus
# the local Supabase suite, on their own block of ports so several branches run
# side by side without collisions.
#
# HARNESS-AGNOSTIC BY DESIGN. The only trigger this needs is git's own
# post-checkout hook (installed by scripts/install-git-hooks.sh), which fires
# for `git worktree add` no matter who ran it — plain git, an IDE, Claude Code,
# t3code, herdr, whatever comes next. Agent-specific hooks are thin, optional
# wrappers over this file; nothing here reads an agent's env vars.
#
#   source scripts/lib/worktree-setup.sh
#   setup_worktree <target-dir> [branch]
#
# Idempotent: a target that already has a .env with COMPOSE_PROJECT_NAME is
# left untouched, so a double trigger (git hook AND an agent hook) is a no-op
# rather than a second stack.
#
# Env knobs:
#   WORKTREE_SKIP_UP=1   write config but don't start containers
#   HUB_WORKTREE_SETUP   re-entrancy guard, set while we call `git worktree add`

# Keys this script owns in a worktree .env — everything else is inherited from
# the main checkout's .env verbatim (Google OAuth secrets etc., which
# supabase/config.toml reads via env() and the app needs to boot).
_WT_MANAGED_KEYS='^(WORKTREE_OFFSET|COMPOSE_PROJECT_NAME|APP_PORT|SUPABASE_DB_PORT|SUPABASE_API_PORT|SUPABASE_STUDIO_PORT)='

# Absolute path of the MAIN working tree, derived from git alone. Works from the
# main checkout or from any linked worktree, Windows paths included.
wt_main_root() {
  local common
  common="$(git -C "${1:-.}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return 1
  [ -n "$common" ] || return 1
  (cd "$common/.." && pwd)
}

# Lowest unused port offset. Sourced from the .env of every registered worktree
# (git worktree list), NOT from a directory glob — worktrees created by other
# tools live outside this repo's tree (~/.t3, ~/.herdr) and would otherwise be
# invisible to the scan and get handed a duplicate offset.
wt_next_offset() {
  local main_root="$1" max=0 used dir
  while IFS= read -r dir; do
    [ -f "$dir/.env" ] || continue
    used="$(sed -n 's/^WORKTREE_OFFSET=//p' "$dir/.env" | head -1 | tr -d '[:space:]')"
    case "$used" in ''|*[!0-9]*) continue ;; esac
    [ "$used" -gt "$max" ] && max="$used"
  done < <(git -C "$main_root" worktree list --porcelain | sed -n 's/^worktree //p')
  echo $((max + 1))
}

# Compose project names must be lowercase [a-z0-9_-]; branch slugs are not.
wt_project_name() {
  printf 'hub-%s' "$(basename "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]/-/g')"
}

setup_worktree() {
  local TARGET="$1"
  local BRANCH="${2:-}"

  local MAIN_ROOT
  MAIN_ROOT="$(wt_main_root "$(dirname "$TARGET")" || wt_main_root .)" || {
    echo "worktree-setup: not a git repository" >&2
    return 1
  }

  # Already set up (re-entrant call, or the other trigger got here first).
  if [ -f "$TARGET/.env" ] && grep -q '^COMPOSE_PROJECT_NAME=' "$TARGET/.env"; then
    return 0
  fi

  # Serialize scan-and-claim: several agents can create worktrees at once, and
  # two concurrent scans would claim the same offset. mkdir is atomic on POSIX
  # and on NTFS via Git Bash. The lock lives in the shared git dir, not in any
  # one worktrees directory, since worktrees can be created anywhere.
  local COMMON_DIR LOCK tries=0
  COMMON_DIR="$(git -C "$MAIN_ROOT" rev-parse --path-format=absolute --git-common-dir)"
  LOCK="$COMMON_DIR/worktree-offset.lock"
  until mkdir "$LOCK" 2>/dev/null; do
    tries=$((tries + 1))
    if [ "$tries" -gt 100 ]; then
      # A crashed run can leave the lock behind; 10s is far longer than the
      # scan takes, so break in rather than wedging worktree creation forever.
      echo "worktree-setup: stale offset lock, breaking in" >&2
      break
    fi
    sleep 0.1
  done
  # shellcheck disable=SC2064
  trap "rmdir '$LOCK' 2>/dev/null || true" RETURN

  local OFFSET
  OFFSET="$(wt_next_offset "$MAIN_ROOT")"

  local APP_PORT=$((3000 + OFFSET))
  local API_PORT=$((54321 + OFFSET * 10))
  local DB_PORT=$((54322 + OFFSET * 10))
  local SHADOW_PORT=$((54320 + OFFSET * 10))
  local STUDIO_PORT=$((54323 + OFFSET * 10))
  local SMTP_PORT=$((54324 + OFFSET * 10))
  local ANALYTICS_PORT=$((54327 + OFFSET * 10))
  local POOLER_PORT=$((54329 + OFFSET * 10))
  local INSPECTOR_PORT=$((8083 + OFFSET))
  local PROJECT_NAME
  PROJECT_NAME="$(wt_project_name "$TARGET")"

  # Create the worktree if the caller hasn't already (the git post-checkout
  # path calls us AFTER git made it; new-worktree.sh calls us before).
  # HUB_WORKTREE_SETUP stops our own post-checkout hook re-entering here.
  if [ ! -e "$TARGET" ]; then
    [ -n "$BRANCH" ] || { echo "worktree-setup: need a branch to create $TARGET" >&2; return 1; }
    if git -C "$MAIN_ROOT" rev-parse --verify "$BRANCH" >/dev/null 2>&1; then
      HUB_WORKTREE_SETUP=1 git -C "$MAIN_ROOT" worktree add "$TARGET" "$BRANCH"
    else
      HUB_WORKTREE_SETUP=1 git -C "$MAIN_ROOT" worktree add "$TARGET" -b "$BRANCH"
    fi
  fi

  # Seed the graphify knowledge graph from the main checkout. graphify-out/ is
  # gitignored (never committed), so a fresh worktree starts without one — copy
  # the whole folder from main so the branch opens with the current graph instead
  # of an expensive rebuild from scratch. Skip the path-specific sidecars
  # (.graphify_root/.graphify_python) so this worktree's tooling targets itself,
  # not main. graphify's own post-checkout hook refreshes graph.json from this
  # worktree's code afterward.
  if [ -d "$MAIN_ROOT/graphify-out" ] && ! [ "$TARGET/graphify-out" -ef "$MAIN_ROOT/graphify-out" ]; then
    mkdir -p "$TARGET/graphify-out"
    cp -R "$MAIN_ROOT/graphify-out/." "$TARGET/graphify-out/" 2>/dev/null || true
    rm -f "$TARGET/graphify-out/.graphify_root" "$TARGET/graphify-out/.graphify_python" 2>/dev/null || true
  fi

  # .env: inherit the main checkout's (OAuth secrets, service accounts — both
  # the app and `supabase start` need them) and override only our own keys.
  {
    if [ -f "$MAIN_ROOT/.env" ]; then
      grep -Ev "$_WT_MANAGED_KEYS" "$MAIN_ROOT/.env" || true
    fi
    cat <<ENVEOF

# --- isolated worktree stack (generated; see scripts/lib/worktree-setup.sh) ---
WORKTREE_OFFSET=$OFFSET
COMPOSE_PROJECT_NAME=$PROJECT_NAME
APP_PORT=$APP_PORT
SUPABASE_DB_PORT=$DB_PORT
SUPABASE_API_PORT=$API_PORT
SUPABASE_STUDIO_PORT=$STUDIO_PORT
ENVEOF
  } >"$TARGET/.env"

  # The offset is claimed (it's in the .env now) — release the lock before the
  # slow part so parallel creations don't queue behind our sed/docker work.
  rmdir "$LOCK" 2>/dev/null || true
  trap - RETURN

  # supabase/config.toml has no env-var indirection for ports, so rewrite this
  # worktree's copy in place. skip-worktree hides the diff from `git status`
  # here so it can never be committed by accident.
  local CFG="$TARGET/supabase/config.toml"
  if [ -f "$CFG" ]; then
    sed -i.bak \
      -e "s/^project_id = \".*\"/project_id = \"$PROJECT_NAME\"/" \
      -e "0,/^port = 54321\$/s//port = $API_PORT/" \
      -e "0,/^port = 54322\$/s//port = $DB_PORT/" \
      -e "0,/^shadow_port = 54320\$/s//shadow_port = $SHADOW_PORT/" \
      -e "0,/^port = 54329\$/s//port = $POOLER_PORT/" \
      -e "0,/^port = 54323\$/s//port = $STUDIO_PORT/" \
      -e "0,/^port = 54324\$/s//port = $SMTP_PORT/" \
      -e "0,/^port = 54327\$/s//port = $ANALYTICS_PORT/" \
      -e "0,/^inspector_port = 8083\$/s//inspector_port = $INSPECTOR_PORT/" \
      -e "s#^site_url = \"http://localhost:3000\"#site_url = \"http://localhost:$APP_PORT\"#" \
      -e "s#^additional_redirect_urls = \[\"http://localhost:3000/auth/callback\"\]#additional_redirect_urls = [\"http://localhost:$APP_PORT/auth/callback\"]#" \
      -e "s#^redirect_uri = \"http://127.0.0.1:54321/auth/v1/callback\"#redirect_uri = \"http://127.0.0.1:$API_PORT/auth/v1/callback\"#" \
      "$CFG"
    rm -f "$CFG.bak"
    git -C "$TARGET" update-index --skip-worktree supabase/config.toml 2>/dev/null || true
  fi

  # .env.local is gitignored but next dev needs it to boot at all (without it
  # the server 500s on every request). Derive it from the main checkout's,
  # swapping in this worktree's API port — the anon/service-role keys are the
  # stable demo JWTs every local Supabase instance ships, so only ports differ.
  if [ -f "$MAIN_ROOT/.env.local" ]; then
    sed \
      -e "s#://127\.0\.0\.1:54321#://127.0.0.1:$API_PORT#g" \
      -e "s#://host\.docker\.internal:54321#://host.docker.internal:$API_PORT#g" \
      -e "s#://localhost:54321#://localhost:$API_PORT#g" \
      "$MAIN_ROOT/.env.local" >"$TARGET/.env.local"
    # Own session-signing secret rather than sharing the main checkout's.
    if grep -q '^STUDENT_SESSION_SECRET=' "$TARGET/.env.local"; then
      sed -i.bak "s#^STUDENT_SESSION_SECRET=.*#STUDENT_SESSION_SECRET=$(openssl rand -hex 32)#" "$TARGET/.env.local"
      rm -f "$TARGET/.env.local.bak"
    fi
  else
    echo "worktree-setup: WARNING no .env.local in $MAIN_ROOT — copy .env.example to $TARGET/.env.local or the app won't boot" >&2
  fi

  echo "Worktree ready: $TARGET"
  echo "  App:              http://localhost:$APP_PORT"
  echo "  Supabase Studio:  http://localhost:$STUDIO_PORT"
  echo "  Supabase API:     http://localhost:$API_PORT"

  # NEW_WORKTREE_SKIP_UP is the old name of this knob, still honored.
  if [ "${WORKTREE_SKIP_UP:-${NEW_WORKTREE_SKIP_UP:-}}" = "1" ]; then
    echo "  (stack not started: WORKTREE_SKIP_UP=1 — run ./dev when you want it)"
    return 0
  fi

  echo "Starting stack '$PROJECT_NAME' in the background…"
  ( cd "$TARGET" && docker compose up -d >"${TMPDIR:-/tmp}/compose-up-$PROJECT_NAME.log" 2>&1 & ) || true
}
