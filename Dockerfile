FROM mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm

# postgresql-client: inspect the local Supabase database from inside the container.
# docker.io: CLI only — it talks to the host daemon via the mounted socket.
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client docker.io \
    && rm -rf /var/lib/apt/lists/*
