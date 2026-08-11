# Setting up Google OAuth (mentor sign-in)

Mentors sign in with Google; students sign in with an ID number. This guide creates the Google OAuth
client the app needs. The **code and Supabase config are already wired** — you only create the client
in Google and paste two values into a local file.

## How the flow works (so the redirect URI makes sense)

```
Browser ──"Sign in with Google"──▶ Google
Google ──redirects to──▶ Supabase Auth  (http://127.0.0.1:54321/auth/v1/callback)   ← Google must trust THIS
Supabase ──redirects to──▶ the app       (http://localhost:3000/auth/callback)
```

The **Authorized redirect URI you register in Google is the Supabase callback**, not the app's. This is
the #1 thing people get wrong.

## Where the values live

| Variable | File | Read by | Committed? |
|---|---|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | `.env` (repo root) | Supabase CLI (`env()` in `config.toml`) | **No** — gitignored |
| `GOOGLE_OAUTH_CLIENT_SECRET` | `.env` (repo root) | Supabase CLI | **No** — gitignored |

Note the split: Supabase CLI reads **`.env`**; the Next.js app reads **`.env.local`**. The Google
secret is only used by Supabase (the auth server talks to Google), so it goes in `.env` only. A
scaffolded `.env` with these two empty keys already exists at the repo root.

`supabase/config.toml` is already set (no edits needed):

```toml
[auth.external.google]
enabled = true
client_id = "env(GOOGLE_OAUTH_CLIENT_ID)"
secret = "env(GOOGLE_OAUTH_CLIENT_SECRET)"
redirect_uri = "http://127.0.0.1:54321/auth/v1/callback"

# and, in [auth]:
site_url = "http://localhost:3000"
additional_redirect_urls = ["http://localhost:3000/auth/callback"]
```

## Steps (Google Cloud Console — you drive; sign-in is yours)

You need a Google account. Everything is free.

### 1. Create / pick a project
[console.cloud.google.com](https://console.cloud.google.com/) → project dropdown → **New Project** →
name it e.g. `team-hub` → Create, then select it.

### 2. Configure the consent screen
**APIs & Services → OAuth consent screen** (in newer console UI this lives under **Google Auth Platform**).
- **User type / Audience:** choose **External** unless every mentor is on one Google Workspace domain
  (then **Internal** limits it to that org).
- App name `Team Hub`, your email as support + developer contact. Logo/links optional.
- **Scopes:** the defaults (`openid`, `email`, `profile`) are all you need — these are *non-sensitive*,
  so **no Google verification review is required**. Don't add restricted scopes.
- **Test users vs publish:**
  - Keep it in **Testing** and add each mentor's Google email as a *test user* (simplest; ~100-user
    cap, fine for a team), **or**
  - **Publish** the app — allowed without review because the scopes are non-sensitive — so any mentor
    can sign in without being pre-added.
  - Either way, the app has its own allowlist (see "How access is decided" below), so a random Google
    account that completes sign-in still only gets guest access.

### 3. Create the OAuth client
**APIs & Services → Credentials → Create Credentials → OAuth client ID**.
- **Application type:** **Web application**.
- **Name:** `Team Hub — Local` (make a separate client for production later).
- **Authorized redirect URIs → Add URI**, exactly:
  ```
  http://127.0.0.1:54321/auth/v1/callback
  ```
  (Google allows `http` for `127.0.0.1`/`localhost`. Copy it exactly — a trailing slash or `localhost`
  vs `127.0.0.1` mismatch will fail.)
- Authorized JavaScript origins: not required for this flow (you may add `http://localhost:3000`, harmless).
- **Create** → copy the **Client ID** and **Client secret**.

### 4. Paste into `.env` (repo root)
Edit `.env` (already scaffolded, gitignored):
```bash
GOOGLE_OAUTH_CLIENT_ID=<your client id>
GOOGLE_OAUTH_CLIENT_SECRET=<your client secret>
```
Do **not** commit this file (`git status` should not list it).

### 5. Restart the local stack so Supabase reloads the config
```bash
./dev npm run db:stop && ./dev npm run db:start
```

### 6. Try it
```bash
./dev npm run dev
```
Open http://localhost:3000/login in your browser → **Mentor sign in with Google**.

## How access is decided (important for your first sign-in)

After Google returns you, the app runs its allowlist (`decideOAuthLink`):

- **If there are zero admins yet, the first person to sign in with Google becomes admin** (bootstrap).
  So **you should be the first to sign in**, to claim the admin account.
- After that: a Google email is linked only if it matches a `person` row with role admin/mentor/captain.
  Anyone else completing Google sign-in is downgraded to **guest** (read-only). Students never use Google.

So the intended bootstrap sequence: you sign in first (→ admin), then create mentor `person` rows in
**Admin → People** using the Google email each mentor will sign in with, then they can sign in.

## Production (later, for the hosted Supabase project)

When you deploy (Milestone 4), the hosted Supabase project configures Google in its **dashboard**
(Authentication → Providers → Google), not `config.toml`. There:
- Register a **second** OAuth client (or add a redirect URI to the existing one) with
  `https://<your-project-ref>.supabase.co/auth/v1/callback`.
- In the hosted project's URL config, set the site URL and add `https://<your-app-domain>/auth/callback`
  to the redirect allow-list.
- If you published the consent screen, mentors on any Google account can sign in; if not, add them as
  test users.

## Troubleshooting

- **`redirect_uri_mismatch`** — the URI in Google doesn't exactly match `http://127.0.0.1:54321/auth/v1/callback`.
- **You land on `/login?error=oauth`** — the callback couldn't create/link a person (e.g. a DB hiccup, or
  the app couldn't reach Supabase). Check `./dev npm run dev` logs.
- **Signed in but shown as guest** — expected unless you're the bootstrap-admin or your email matches a
  mentor/admin/captain `person` row. Create the row in Admin → People first.
- **Nothing happens / config didn't take** — make sure the values are in `.env` (repo root), not
  `.env.local`, and that you restarted the stack (step 5).
