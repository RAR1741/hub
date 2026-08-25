#!/bin/bash
# SessionStart hook for Claude Code on the web.
#
# Goal: bring up the SAME stack the local `docker compose up` flow does
# (see compose.yaml / scripts/dev-up.sh), but running directly on the remote
# host instead of inside a dev container:
#   1. npm dependencies
#   2. Docker daemon (local Supabase runs as containers on it)
#   3. local Supabase stack (Postgres + Auth + REST + Studio, migrations + seed)
#   4. .env.local wired to the local stack
# After the hook completes, start the app with `npm run dev` (http://localhost:3000).
#
# NETWORK POLICY REQUIREMENT: local Supabase pulls container images from Docker
# Hub. The environment must use a network policy that allows Docker Hub — the
# registry (registry-1.docker.io / auth.docker.io) AND its image CDN
# (production.cloudfront.docker.com). A policy that blocks the CDN makes
# `supabase start` fail with "403 Forbidden" on blob downloads. Set this when
# creating the environment; see docs at
# https://code.claude.com/docs/en/claude-code-on-the-web
set -euo pipefail

log() { echo "[session-start] $*"; }

# --- Local mode: per-worktree isolated stacks --------------------------------
# See scripts/new-worktree.sh. Two cases:
#   1. This session is in one of those worktrees (.env has COMPOSE_PROJECT_NAME)
#      → make sure its stack is up so it's ready before anyone asks.
#   2. This session is in the main checkout → nudge Claude to create one for
#      any new feature work, so the user never has to ask for it.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || exit 0

  if [ -f .env ] && grep -q '^COMPOSE_PROJECT_NAME=' .env; then
    set -a; source .env; set +a
    if [ -z "$(docker compose -p "$COMPOSE_PROJECT_NAME" ps -q app 2>/dev/null)" ]; then
      log "Bringing up isolated stack '$COMPOSE_PROJECT_NAME'…"
      ( docker compose up -d >"/tmp/compose-up-$COMPOSE_PROJECT_NAME.log" 2>&1 & ) || true
    fi
    log "Isolated worktree stack: app http://localhost:${APP_PORT:-3000}, Supabase Studio http://localhost:${SUPABASE_STUDIO_PORT:-54323}"
  elif [ -d .git ] && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    # MAIN checkout only (.git is a real directory here; a linked worktree's
    # .git is a gitdir-pointer file). Two jobs, both delegated to the
    # harness-agnostic scripts so this hook stays optional:
    #   1. keep git's own post-checkout/post-merge hooks installed, so the
    #      lifecycle survives a fresh clone and works without any agent
    #   2. reap worktrees whose PR has merged, tear down their stacks, and
    #      drain removals deferred from inside a worktree
    bash scripts/install-git-hooks.sh >/dev/null 2>&1 || true
    bash scripts/reap-worktrees.sh 2>&1 | sed 's/^\[reap\] /[session-start] /' || true

    cat <<'EOF'
You are in the hub repo's MAIN checkout (not an isolated worktree). Per
standing user preference: before starting any new feature/bugfix work that
involves writing code, create an isolated worktree with its own Docker/
Supabase stack and do the work there instead of in this checkout:

    scripts/new-worktree.sh <branch-name>
    cd .worktrees/<branch-name> && ./dev

Do this automatically, without asking — the stack starts itself in the
background. Only skip it if already inside a worktree, or the user
explicitly says not to bother for a trivial change.
EOF
  fi
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# --- 1. npm dependencies (idempotent, cache-friendly) ------------------------
if [ ! -x node_modules/.bin/next ]; then
  log "Installing npm dependencies…"
  npm install
else
  log "Dependencies present — skipping npm install."
fi

# --- 2. Docker daemon --------------------------------------------------------
# The Supabase CLI orchestrates sibling containers on a Docker daemon. In the
# remote host there's no daemon running by default, so start one. Route it
# through the agent proxy so image pulls succeed under the network policy.
if ! docker info >/dev/null 2>&1; then
  log "Starting Docker daemon…"
  if [ -n "${HTTPS_PROXY:-}" ]; then
    mkdir -p /etc/docker
    cat > /etc/docker/daemon.json <<JSON
{ "proxies": { "http-proxy": "${HTTPS_PROXY}", "https-proxy": "${HTTPS_PROXY}", "no-proxy": "127.0.0.1,localhost,host.docker.internal,172.16.0.0/12" } }
JSON
  fi
  dockerd >/tmp/dockerd.log 2>&1 &
  for _ in $(seq 1 30); do
    docker info >/dev/null 2>&1 && break
    sleep 1
  done
fi

if ! docker info >/dev/null 2>&1; then
  log "WARNING: Docker daemon did not start — skipping local Supabase."
  log "         Static checks (lint/typecheck/test) still work. See /tmp/dockerd.log."
  exit 0
fi

# --- 3. Local Supabase -------------------------------------------------------
# `supabase start` is idempotent: no-ops if already up, applies migrations + seed
# on a fresh stack, and never wipes existing data. Images are cached on disk after
# the first successful run, so subsequent sessions start fast.
log "Starting local Supabase…"
if ! npx supabase start; then
  log "WARNING: 'supabase start' failed (often a blocked Docker Hub pull — see the"
  log "         NETWORK POLICY note at the top of this file). The session will still"
  log "         start; static checks work, but the app server won't have a database."
  exit 0
fi

# --- 4. .env.local -----------------------------------------------------------
# Wire the app to the local stack. Written once and preserved across sessions.
# Unlike the dev-container setup, server code runs directly on this host (not in a
# container), so SUPABASE_INTERNAL_URL points at 127.0.0.1, not host.docker.internal.
if [ ! -f .env.local ]; then
  log "Writing .env.local…"
  # `supabase status -o env` exposes ANON_KEY / SERVICE_ROLE_KEY for the running stack.
  eval "$(npx supabase status -o env)"
  # Generate a fresh signing secret; safe because this is a local-only stack.
  SESSION_SECRET="$(openssl rand -hex 32)"
  cat > .env.local <<ENV
# --- Supabase (auto-wired to the local stack) ---
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON_KEY}
SUPABASE_INTERNAL_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}

# --- Session signing (auto-generated for this environment) ---
STUDENT_SESSION_SECRET=${SESSION_SECRET}

# --- Onshape integration (mock mode for local/remote dev) ---
# These point at the built-in dev mock so Onshape-related routes work without
# real OAuth credentials. To use real Onshape, replace with actual values from
# your Onshape OAuth app and remove ALLOW_ONSHAPE_MOCK.
ONSHAPE_CLIENT_ID=dev-mock-client
ONSHAPE_CLIENT_SECRET=dev-mock-secret
ONSHAPE_REDIRECT_URI=http://localhost:3000/api/onshape/oauth/callback
ONSHAPE_AUTHORIZATION_URL=http://localhost:3000/api/dev/onshape-mock/oauth/authorize
ONSHAPE_TOKEN_URL=http://localhost:3000/api/dev/onshape-mock/oauth/token
ONSHAPE_API_BASE_URL=http://localhost:3000/api/dev/onshape-mock
ONSHAPE_SCOPES=OAuth2Read
ALLOW_ONSHAPE_MOCK=1

# --- Outbound email (leave blank — sending is disabled in dev) ---
# Set to a real delegated Workspace mailbox to test email sending locally.
HUB_MAIL_SENDER=
ENV
  log ".env.local written."
else
  log ".env.local present — leaving it untouched."
fi

log "Stack ready. Run 'npm run dev' → http://localhost:3000 (Supabase Studio → :54323)."
