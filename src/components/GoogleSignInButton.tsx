"use client";

import { getSupabaseBrowser } from "@/lib/supabase-browser";

export function GoogleSignInButton({ next }: { next: string }) {
  async function signIn() {
    await getSupabaseBrowser().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback${next === "/" ? "" : `?next=${encodeURIComponent(next)}`}` },
    });
  }
  return (
    <button type="button" onClick={signIn} className="btn btn-secondary w-full">
      Mentor sign in with Google
    </button>
  );
}
