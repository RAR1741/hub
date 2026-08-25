FROM mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm

# postgresql-client: inspect the local Supabase database from inside the container.
# docker.io: CLI only — it talks to the host daemon via the mounted socket.
# socat: bridge container-loopback → host for `supabase start`'s fresh-init DB
#        connection (see scripts/dev-up.sh, step 2a).
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client docker.io socat \
    && rm -rf /var/lib/apt/lists/*

# Bake the Playwright browser + OS deps into the image so `./dev npm run e2e`
# works in a fresh container with no manual `playwright install` step. Pin to the
# @playwright/test version in package.json — bump this literal on upgrade.
RUN npx --yes playwright@1.62.1 install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*
