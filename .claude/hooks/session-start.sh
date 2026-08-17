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

# Only run in the remote (web) environment; local dev uses `docker compose up`.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

log() { echo "[session-start] $*"; }

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
  cat > .env.local <<ENV
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON_KEY}
SUPABASE_INTERNAL_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}
STUDENT_SESSION_SECRET=$(openssl rand -hex 32)
ENV
else
  log ".env.local present — leaving it untouched."
fi

log "Stack ready. Run 'npm run dev' → http://localhost:3000 (Supabase Studio → :54323)."
