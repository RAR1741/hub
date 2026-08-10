/**
 * Server-side Supabase base URL.
 *
 * In the dev container the Supabase stack runs as sibling containers on the host
 * daemon, so server code must reach it at host.docker.internal — `localhost`
 * would resolve to the app container itself. In production SUPABASE_INTERNAL_URL
 * is unset and the public URL is correct.
 */
export function resolveServerSupabaseUrl(env: {
  SUPABASE_INTERNAL_URL?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
}): string {
  const url = env.SUPABASE_INTERNAL_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error(
      "Set SUPABASE_INTERNAL_URL (dev container) or NEXT_PUBLIC_SUPABASE_URL",
    );
  }
  return url;
}

export function serverSupabaseUrl(): string {
  return resolveServerSupabaseUrl({
    SUPABASE_INTERNAL_URL: process.env.SUPABASE_INTERNAL_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });
}
