# Setting up the Onshape integration

Registers the hub as an Onshape **Element right panel** extension so a designer sees the parts in
the current Onshape tab, with hub tracking state, without leaving CAD. The **code and migration are
already wired** (`docs/superpowers/specs/2026-08-23-onshape-panel-integration-design.md`) — you only
register the app in Onshape and set env vars.

## 1. Create the OAuth application

In [Onshape Developer Portal](https://dev-portal.onshape.com/) → **OAuth Applications** → **Create
application**:

- **Redirect URL**, exactly:
  ```
  https://hub.redalert1741.org/api/onshape/oauth/callback
  ```
- **Scope:** `OAuth2Read` only — the panel never writes to CAD in v1.
- Copy the **Client ID** and **Client Secret** (note: Onshape's client-id quirk — the app's
  `clientId()` helper replaces every literal `0` in the configured id with `O`, so paste the id
  exactly as Onshape shows it; don't "fix" what looks like a typo).

## 2. Add the Element right panel extension

Same application → **Extensions** → **Add extension**:

- **Type:** Element right panel
- **Context:** Inside part studio
- **Action URL**, exactly:
  ```
  https://hub.redalert1741.org/onshape?documentId={$documentId}&workspaceOrVersion={$workspaceOrVersion}&workspaceOrVersionId={$workspaceOrVersionId}&elementId={$elementId}&partNumber={$partNumber}
  ```

**Right panels do not receive `{$partId}`** — Onshape only substitutes it for element-toolbar/context-
menu extensions, not right panels. The panel doesn't need it: it resolves the part list itself via
`GET /v6/parts/d/{did}/{wvm}/{wvmId}` (`listElementParts` in `src/lib/onshape.ts`) and matches hub
links by the stored `(document, element, part)` identity triple, not by a passed-in part id.

## 3. Assign the app to the team

This is a **private team app** — no App Store listing needed. In the Developer Portal, use the
application's **admin assignment** (grant/install to your team) so team members can open the panel
without anyone "installing" anything from a store listing.

## 4. Set the Vercel env vars

**Vercel → Project → Settings → Environment Variables** (Production):

| Variable | Value | Notes |
|---|---|---|
| `ONSHAPE_CLIENT_ID` | from step 1 | |
| `ONSHAPE_CLIENT_SECRET` | from step 1 | |
| `ONSHAPE_REDIRECT_URI` | `https://hub.redalert1741.org/api/onshape/oauth/callback` | Must exactly match the redirect URL registered in step 1. |
| `ONSHAPE_AUTHORIZATION_URL` | leave unset | Defaults to `https://oauth.onshape.com/oauth/authorize`. |
| `ONSHAPE_TOKEN_URL` | leave unset | Defaults to `https://oauth.onshape.com/oauth/token`. |
| `ONSHAPE_API_BASE_URL` | leave unset | Defaults to `https://cad.onshape.com/api`. |
| `ONSHAPE_SCOPES` | leave unset | Defaults to `OAuth2Read`. |

`STUDENT_SESSION_SECRET` (already set for student sign-in, per `docs/setup/deploy.md`) is reused to
sign the panel's bearer token — nothing extra to configure there.

## Local dev / testing without a real Onshape app

You don't need a real Onshape OAuth app to develop or run the e2e suite locally. A dev-gated mock
(`src/app/api/dev/onshape-mock/*`, 404s in production — same guard as `dev-login`) stands in for
both the token endpoint and the parts-list endpoint. Point the two URL env vars at it in
`.env.local`:

```bash
ONSHAPE_TOKEN_URL=http://localhost:3000/api/dev/onshape-mock/oauth/token
ONSHAPE_API_BASE_URL=http://localhost:3000/api/dev/onshape-mock
```

With those set, `getConnection`/`listElementParts` succeed for any person with an
`onshape_connection` row, regardless of the real Onshape API — the whole connect → list → create →
status-change round trip is drivable locally and in Playwright (`e2e/onshape-panel.spec.ts`) with
zero real Onshape dependency. The mock returns a fixed fixture of three parts (`JHD`/`JHK`/`JHV`).

## Manual verification against real Onshape

Once the app + extension + Vercel env vars are in place: open any Part Studio in Onshape, open the
right panel, click **Connect** (this opens `/onshape/connect` in a popup — normal hub login there),
confirm the parts list loads with each part's hub status (or an **Add** button), create a part from
the panel, and change its status inline. See the design doc's §9 for the full verification plan.
