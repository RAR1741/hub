/**
 * Fixed name for the Supabase auth cookie (and its derived PKCE verifier /
 * chunk cookies), shared by EVERY Supabase auth client — browser, OAuth
 * callback, proxy middleware, and getViewer().
 *
 * Why this must be explicit: supabase-js derives the default storage key from
 * the Supabase URL hostname (`sb-${hostname.split(".")[0]}-auth-token`). Our
 * two-URL container seam gives the browser client `127.0.0.1` and the server
 * clients `host.docker.internal`, which would derive DIFFERENT cookie names
 * (`sb-127-…` vs `sb-host-…`). The PKCE code-verifier written by the browser
 * would then be unreadable by the server callback, breaking Google sign-in.
 * Pinning one name decouples the cookie from the URL so every client agrees.
 */
export const AUTH_COOKIE_NAME = "sb-teamhub-auth-token";
