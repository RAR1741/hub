#!/usr/bin/env bash
# Entry point for the root-level `docker compose up`. Runs *inside* the dev
# container and brings the whole local stack up with one command: npm deps, local
# Supabase (sibling containers on the host daemon), and the Next.js dev server.
# See the README "Development" section. Day-to-day one-off commands still go
# through `./dev`.
set -euo pipefail

cd /workspaces/hub

log() { echo "[dev-up] $*"; }

# 1. Dependencies. node_modules is bind-mounted from the host and may be empty or
#    built for a different platform; (re)install only when the next binary is missing.
if [ ! -x node_modules/.bin/next ]; then
  log "Installing npm dependencies…"
  npm install
else
  log "Dependencies present — skipping npm install."
fi

# 2. Local Supabase. The CLI talks to the host Docker daemon via the mounted
#    socket and starts sibling containers. --ignore-health-check: the CLI's
#    readiness probe hits 127.0.0.1, which inside the container is its own
#    loopback rather than the host's published ports (see supabase/README.md).
#    `supabase start` is idempotent: it no-ops if the stack is already up and
#    applies migrations + seed on a fresh stack. It does NOT wipe existing data —
#    run `./dev npm run db:reset` explicitly if you want a clean slate.
log "Starting local Supabase…"
npm run db:start

# 3. Teardown symmetry. `docker compose down` / `stop` sends SIGTERM here; stop the
#    Supabase sibling containers too so "up" and "down" mirror each other. `supabase
#    stop` preserves data by default (it backs up and restores on the next start),
#    so this is safe. compose.yaml sets stop_grace_period so this has time to finish.
dev_pid=""
shutdown() {
  log "Received shutdown signal — stopping dev server and Supabase…"
  [ -n "$dev_pid" ] && kill "$dev_pid" 2>/dev/null || true
  npm run db:stop || true
  exit 0
}
trap shutdown SIGTERM SIGINT

# 4. Next.js dev server. `npm run dev` binds 0.0.0.0 so the host reaches it on :3000.
#    Run it in the background and wait, so the trap above can fire on shutdown.
log "Starting Next.js dev server → http://localhost:3000"
npm run dev &
dev_pid=$!
wait "$dev_pid"
