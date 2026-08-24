FROM mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm

# postgresql-client: inspect the local Supabase database from inside the container.
# docker.io: CLI only — it talks to the host daemon via the mounted socket.
# socat: bridge container-loopback → host for `supabase start`'s fresh-init DB
#        connection (see scripts/dev-up.sh, step 2a).
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client docker.io socat \
    && rm -rf /var/lib/apt/lists/*
