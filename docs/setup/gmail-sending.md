# Setting up Gmail sending

Outbound email (e.g. OTP codes) goes through the Gmail API, reusing the **same service account**
as calendar/drive sync — no new project or dependency, see `src/lib/gmail.ts`.

## 1. Add the send scope to domain-wide delegation

In the [Google Workspace Admin console](https://admin.google.com/) → **Security → Access and data
control → API controls → Domain-wide delegation**, find the existing entry for the service
account's Client ID (see `docs/setup/google-drive-groups.md` §2) and add this scope alongside the
ones already granted:

```
https://www.googleapis.com/auth/gmail.send
```

## 2. Set the sending mailbox

```bash
# .env.local
HUB_MAIL_SENDER=hub@your-domain.org
```

`HUB_MAIL_SENDER` must be a real Workspace mailbox — the service account impersonates it (via
`subject`) to send. `GOOGLE_SA_CLIENT_EMAIL` / `GOOGLE_SA_PRIVATE_KEY` are the same values already
set up for calendar sync. If any of the three are missing, `gmailCredentialsFromEnv()` returns
`null` and callers should treat mail sending as unconfigured.
