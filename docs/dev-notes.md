# Dev notes

Environment gotchas and non-obvious wiring worth knowing when working on Team Hub locally. The
day-to-day setup/run commands live in the [README](../README.md#development).

## Why two Supabase URLs

`NEXT_PUBLIC_SUPABASE_URL` (`127.0.0.1:54321`) is what your **browser** reaches.
`SUPABASE_INTERNAL_URL` (`host.docker.internal:54321`) is what **server code inside the container**
reaches, because the Supabase stack runs as sibling containers. Server code must always go through
`serverSupabaseUrl()` in `src/lib/supabase-url.ts`. In production only the public URL is set.
