# cheesy-mail — Source Survey

**Repo:** https://github.com/Team254/cheesy-mail (FRC 254)
**Surveyed at commit:** `bbc62a08c675f3b0c4104a15ba506a505ebd74f5`
**File links:** paths below are relative to repo root; permalink form is
`https://github.com/Team254/cheesy-mail/blob/bbc62a08c675f3b0c4104a15ba506a505ebd74f5/<path>`

## Purpose

`cheesy-mail` is a small standalone SMTP daemon that receives incoming e-mail addressed to FRC Team 254's mailing-list addresses and redistributes it to the team's registered parents and students. It is not a web application — there is no browser UI, no routes/controllers, and no local database; it is a long-running mail relay that authenticates senders and resolves recipients by calling the team's separate member-management site (`members.team254.com`), reformats each message into a branded HTML template, and fans it out to individual recipients via Amazon SES. Secondary jobs are cross-posting the message to the team website's blog and to Slack. Its users are team staff/mentors/leads who send announcements (they simply e-mail `parents@` or `students@`), the parents and students who receive them, and a list administrator who is CC'd on failures.

## Stack

- **Language:** Go (module `github.com/Team254/cheesy-mail`, `go 1.20`) — `go.mod`.
- **Framework:** None. The SMTP server, session state machine, and HTTP endpoint are hand-written on Go's standard library (`net`, `net/http`, `net/mail`, `bufio`), inspired by go-guerrilla (noted in the header comments of `smtp_server.go` and `smtp_client_session.go`).
- **Database:** None. There is no persistent store; state is an in-process dedup map (`message_cache.go`) plus attachment files on local disk. All user/permission data lives behind the external members API (`user_api.go`).
- **Key libraries:** `github.com/aws/aws-sdk-go` (SES), `github.com/jhillyerd/go.enmime` (MIME parsing), `github.com/PuerkitoBio/goquery` (HTML rewriting of the message body), `github.com/nu7hatch/gouuid` (attachment directory names) — `go.mod`.
- **Frontend approach:** Go `text/template` files that generate the HTML e-mail bodies and blog post payload: `message.html`, `blog_post.html`, `error_message.html`, `reply.html`. Inline CSS, table-based layout for mail-client compatibility. Attachments and re-hosted images are served as static files from a media host, not by this app.
- **License:** There is **no LICENSE file** in the repo. Every source file carries a `Copyright <year> Team 254. All Rights Reserved.` header (e.g. `main.go`, `mail_message.go`), so the code is published without an open-source grant.
- **Deployment/hosting:** Self-hosted on a Team 254 EC2 box. No Docker, no Heroku. `deploy` is a bash script that SSHes to `ec2.team254.com`, does `git checkout -f && git pull && go get -d && go build`, `pkill`s the old process and relaunches it under `nohup`. `nginx.conf` documents an nginx `mail {}` block that listens on port 25 and proxies to the Go process on port 8025, using the app's own HTTP endpoint on 8026 as its `auth_http` backend. Logs go to `cheesy-mail.log` in the working directory (`main.go`); config is environment-selected via `TEAM254_ENV` and secrets are decrypted with `TEAM254_SECRET` (`config.go`).

## Auth & Roles

There is no login. Authorization is entirely **sender-identity based**: the envelope/header `From` address is looked up against the members API, and permission strings on the returned user record decide what happens.

- `GetUserByEmail` in `user_api.go` resolves the sender; an unknown address is rejected with "Sender %s is not a registered team254.com user."
- Send authorization: `getListsAndCheckPermission` in `mail_message.go` requires `MAILINGLIST_PARENTS_SEND` / `MAILINGLIST_STUDENTS_SEND` for the respective list; otherwise the message is rejected and an error is mailed back.
- Receive membership: `GetUsersByPermission` (`user_api.go`) fetches everyone holding `MAILINGLIST_PARENTS_RECEIVE` / `MAILINGLIST_STUDENTS_RECEIVE`.
- `MAILINGLIST_UNSUBSCRIBE` gates whether a given recipient gets an unsubscribe link in their copy (`User.UnsubscribeLink`, `user_api.go`).
- Effective roles are therefore: *list sender* (per list), *list recipient* (per list), *unsubscribe-eligible recipient*, and an *admin* identified only by the `admin_address` config value, who is CC'd on errors and forwarded replies.
- The nginx auth endpoint performs no authentication — `SmtpServer.ServeHTTP` in `smtp_server.go` unconditionally returns `Auth-Status: OK` plus the backend host/port. SMTP itself is configured `smtp_auth login none` in `nginx.conf`.
- The members API is not called with a token; instead the API's response body is AES-decrypted with the shared `TEAM254_SECRET` (`getApiRequest` in `user_api.go` → `Decrypt` in `config.go`), which doubles as the trust mechanism.

## Data Model

No schema; three in-memory structs and one external record.

- **`MailMessage`** (`mail_message.go`): `from`, `to`, `subject`, parsed MIME `body`, `messageId`, the resolved `lists`, `allRecipients []*User`, and `attachmentDir` / `attachments` / `inlines` filename slices. One per incoming SMTP `DATA` payload.
- **`User`** (`user_api.go`): `Id`, `Email`, `Permissions []string` — deserialized from the members API JSON. Read-only; this app never writes users.
- **`ClientSession`** (`smtp_client_session.go`): per-connection SMTP state (`OPEN_STATE` → `COMMAND_STATE` → `DATA_STATE`), HELO string, buffered reader/writer, `errorCount`, `kill_time`.
- **`MessageCache`** (`message_cache.go`): mutex-guarded `map[string]bool` of dedup keys.
- **Lists** are not entities — they are a hardcoded `map[string]string` (`listMap` in `mail_message.go`) mapping four addresses (`parents@lists.team254.com`, `parents@team254.com`, `students@lists.team254.com`, `students@team254.com`) onto two logical lists (`MAILINGLIST_PARENTS`, `MAILINGLIST_STUDENTS`). Relationships: message → 1..n lists → (via permission strings) n users; message → 1 attachment directory keyed by a fresh UUID.

## Features

- **Inbound SMTP mail reception** — A hand-rolled SMTP server accepts connections, walks the HELO/EHLO/MAIL FROM/RCPT TO/DATA/QUIT state machine, and hands parsed messages to the processing loop over a buffered channel. — `smtp_server.go`, `smtp_client_session.go`, `main.go`
- **Mailing-list distribution to parents and students** — A message addressed to a recognized list address is expanded to every member holding that list's `_RECEIVE` permission and delivered as an individual e-mail per recipient. — `mail_message.go` (`Handle`, `getRecipients`, `forwardEmail`), `user_api.go`
- **Multi-list addressing with deduplicated recipients** — Addressing one message to both lists sends a single copy per person; recipients are collected into a set keyed by e-mail and sorted before sending. — `mail_message.go` (`getRecipients`)
- **Sender permission enforcement** — Only senders whose member record carries the list's `_SEND` permission may post; unauthorized or unregistered senders get a rejection e-mail instead of delivery. — `mail_message.go` (`getListsAndCheckPermission`), `user_api.go` (`GetUserByEmail`, `HasPermission`)
- **List-specific subject prefixing** — Outgoing subjects are prefixed `[Team 254 Parents]`, `[Team 254 Students]`, or plain `[Team 254]` when more than one list is addressed. — `mail_message.go` (`getFormattedSubject`)
- **Branded HTML message template** — Each forwarded copy is wrapped in a table-based template with the team swoosh logo, the send date in Pacific time, a confidentiality notice, and the attachment list. — `message.html`, `mail_message.go` (`forwardEmail`)
- **Per-recipient signed unsubscribe link** — Recipients with `MAILINGLIST_UNSUBSCRIBE` get a personalized footer link to `members.team254.com/mail/unsubscribe` carrying their e-mail plus a SHA-256 signature over e-mail + `mail_secret`; others get no link. — `user_api.go` (`UnsubscribeLink`), `message.html`
- **Reply forwarding via encoded return addresses** — Outgoing mail is sent from `r-<base32(sender address)>@lists.team254.com`; replies to that address are decoded back to the original author and forwarded to them (CC'ing the admin) wrapped in a reply template, so recipients can answer the author without exposing the list. — `mail_message.go` (`handleReplyForwarding`, `forwardEmail`), `reply.html`
- **Automatic-reply suppression** — Forwarded replies whose subject contains "automatic reply" (out-of-office bounces) are silently dropped rather than relayed to the author. — `mail_message.go` (`handleReplyForwarding`)
- **File attachment handling and hosting** — MIME attachments are written to a per-message UUID directory under the configured save path and linked from the message body and blog post by public URL rather than re-attached. — `mail_message.go` (`saveAttachments`), `message.html`, `blog_post.html`
- **Inline (CID) image rewriting** — Inline image parts are saved to disk and the `<img src="cid:...">` references in the HTML body are rewritten to the hosted URLs; a missing content ID aborts the message with an error report. — `mail_message.go` (`saveAttachments`)
- **Remote image re-hosting** — Every `<img>` in the body whose `src` is not already on the attachment host is downloaded over HTTP, stored under `<dir>/images/`, and the tag rewritten to the local copy, so images survive after the original host changes. — `mail_message.go` (`saveAttachments`) using goquery
- **HTML body extraction** — After rewriting, only the `<body>` inner HTML is kept, stripping the sending client's document wrapper. — `mail_message.go` (`saveAttachments`)
- **Plain-text message rejection** — Messages with an empty HTML part are refused with an explanatory error telling the sender to re-send as HTML. — `mail_message.go` (`Handle`)
- **DEBUG dry-run mode** — Putting "DEBUG" anywhere in the subject delivers the message only back to the sender, appends the full would-be recipient list to the body, skips blog posting, and routes the Slack notice to a debug webhook. — `mail_message.go` (`isDebug`, `Handle`, `postToSlack`), `message.html`
- **Error reporting back to the sender** — Any failure sends a templated report to the original author (CC admin) stating the error and how many of the total recipients were reached before it stopped. — `mail_message.go` (`handleError`), `error_message.html`
- **Send-rate throttling** — A configurable sleep (`send_interval_ms`, 75 ms in prod) between individual SES sends keeps delivery under the provider's rate limit. — `mail_message.go` (`Handle`), `config.json`
- **Duplicate message suppression** — Each message is keyed by `Message-Id`, or a SHA-256 of from+subject+body when absent, and re-delivery is skipped if the key was already seen — guarding against the upstream mail service delivering the same message twice. — `message_cache.go`, `mail_message.go` (`GetDeduplicationKey`), `main.go`, tests in `message_cache_test.go`
- **Blog cross-posting** — Non-debug list mail is POSTed to the team website's `poof_post.php` endpoint as an HTML blog post, tagged with the author's member ID and flags for whether it went to the students and/or parents lists (used to file it under the right category). — `mail_message.go` (`postToBlog`), `blog_post.html`
- **Slack notification** — Messages that include the students list are posted to a students Slack channel webhook with an `<!channel>` ping, subject, sender name, and plain-text body; debug messages go to a separate debug webhook; parents-only messages are deliberately not posted. — `mail_message.go` (`postToSlack`), `config.json`
- **Spam rejection at RCPT TO** — Recipients not containing the configured host name are refused with `450 Rejected`, logged as probable spam, and the connection is killed. — `smtp_client_session.go`
- **Unknown-command abuse cutoff** — After more than three unrecognized SMTP commands the session is terminated. — `smtp_client_session.go`
- **Message size cap** — The server advertises and enforces a 15 MB (`maxMessageSizeBytes`) limit on `DATA`, with a 60-second socket deadline per read/write. — `smtp_client_session.go`, `smtp_server.go`
- **Feedback-report (abuse/bounce) parsing** — `multipart/report` messages carrying a `message/feedback-report` part have that part's content appended to the text body so it is visible when forwarded. — `smtp_client_session.go` (`parseMessage`)
- **nginx SMTP proxy auth endpoint** — A localhost HTTP listener answers nginx's `auth_http` probes with the headers pointing at the internal SMTP port, letting nginx own port 25. — `smtp_server.go` (`runNginxHttp`, `ServeHTTP`), `nginx.conf`
- **Environment-scoped encrypted configuration** — Config values resolve per `TEAM254_ENV` with fallback to a `global` block, and any value prefixed `Encrypted:` is AES-decrypted at read time. — `config.go`, `config.json`
- **One-command deploy** — `./deploy` rebuilds and restarts the service on the production host over SSH. — `deploy`

## Integrations

- **Amazon SES** — all outbound mail (list distribution, forwarded replies, error notices) via `aws-sdk-go`'s `ses.SendEmail`, with static credentials and region from config. — `main.go`, `mail_message.go` (`forwardEmail`, `handleReplyForwarding`, `handleError`), `config.json` (`aws_region`, `aws_access_key_id`, `aws_secret_access_key`)
- **members.team254.com API** — the sole source of users and permissions; `GET /api/users?permission=…` and `GET /api/users?email=…`, responses AES-encrypted. Also the host of the unsubscribe endpoint. — `user_api.go`, `config.json` (`members_api_url`)
- **team254.com blog ("Poof") API** — `POST` to `poof_post.php` with an MD5 auth digest and `Poof-Title` / `Poof-User` / `Poof-Students` / `Poof-Parents` headers. — `mail_message.go` (`postToBlog`), `config.json` (`blog_post_url`)
- **Slack incoming webhooks** — separate webhook URLs for the students channel and for debug output. — `mail_message.go` (`postToSlack`), `config.json` (`slack_webhook_url_students`, `slack_webhook_url_debug`)
- **media.team254.com** — static host for saved attachments and re-hosted images; the app writes to a local path that this host serves. — `config.json` (`attachment_base_url`, `attachment_save_path`), `mail_message.go` (`saveAttachments`)
- **nginx** — front-end SMTP proxy on port 25 using the app's HTTP auth endpoint. — `nginx.conf`, `smtp_server.go`
- **Arbitrary external HTTP hosts** — `saveAttachments` issues `http.Get` against whatever URLs appear in `<img src>` attributes of incoming mail in order to re-host those images. — `mail_message.go`

## Notable Implementation Details

- **Single-threaded processing loop.** Connections are handled concurrently (one goroutine per SMTP session) but message *processing* is serialized: sessions push onto a `chan *MailMessage` of capacity 10 and `main`'s infinite `for` loop handles one message at a time. There is no worker pool, retry queue, or persistent spool — a crash mid-fan-out loses the remaining sends, and a slow message backpressures the SMTP channel. — `main.go`, `smtp_server.go`
- **No background jobs or scheduled tasks.** Everything is synchronous within the handling of one message. The only "delay" mechanism is the `time.Sleep` throttle between SES sends.
- **Fan-out is one SES call per recipient**, not BCC, which is what makes the per-recipient unsubscribe link and DEBUG recipient listing possible; the cost is N API calls and a partial-send failure mode (`handleError` reports `NumSent` of `NumTotal`).
- **Base32 address round-tripping is the reply mechanism.** The sender's address is base32-encoded (no padding, lowercased) into the `From` local part as `r-<encoded>@lists.team254.com`, and inbound mail matching `^r-([a-z2-7]+)@host$` is decoded back. This requires the SMTP server to accept mail at a wildcard-ish local part and means reply routing is stateless — no database of message threads.
- **Dedup cache is in-memory and unbounded.** `MessageCache.seen` never evicts entries and is not persisted, so the map grows for the lifetime of the process and dedup protection resets on restart/redeploy. — `message_cache.go`
- **One shared secret does three jobs.** `TEAM254_SECRET` (env var) is SHA-256'd into an AES-256 key used to decrypt config values *and* the members API response bodies, and is separately MD5'd with the request body to authenticate blog posts. The AES mode is CBC with an **all-zero IV** and manual PKCS#7 unpadding, with no authentication tag; `Decrypt` indexes `data[len(data)-1]` without validating length or padding. — `config.go`, `user_api.go`, `mail_message.go` (`postToBlog`)
- **Credentials are committed.** The `prod` block of `config.json` contains a plaintext AWS access key ID alongside ciphertext for the secret key, mail secret, and Slack webhooks. A re-implementer should assume these need rotation and should move to a secret manager or IAM instance roles. — `config.json`
- **Fatal-on-missing-config.** `getRawParam` and `GetString` call `log.Fatalf` on a missing key or a decryption failure, so a config typo kills the daemon rather than failing one message. — `config.go`
- **Lists and their prefixes are hardcoded in Go.** Adding or renaming a list requires editing `listMap` and `getFormattedSubject` and recompiling; there is no list CRUD, no moderation queue, no subscribe/confirm flow, and no bounce/complaint processing loop in this app. Membership, unsubscribe processing, and any moderation live in the external members site; the only bounce-adjacent handling here is parsing `message/feedback-report` parts so they read sensibly when forwarded. — `mail_message.go`, `smtp_client_session.go`
- **Inbound HTML is embedded into outbound HTML unescaped** — `{{.Body}}` in `message.html`, `blog_post.html`, and `reply.html` is rendered with `text/template` (not `html/template`), by design so the sender's formatting survives; this also means sender-supplied markup passes through to recipients and to the public blog verbatim.
- **Timezone and date formatting are pinned** to `America/Los_Angeles` for both the message footer date and the blog post `Date` header used in the auth digest, so the deploy host needs tzdata and the digest is time-sensitive. — `mail_message.go`
- **Port split for privileged binding.** The Go process binds unprivileged 8025 (SMTP) and 127.0.0.1:8026 (auth HTTP); nginx owns 25 and authenticates every connection as OK. XCLIENT is accepted as a no-op `250 OK` to accommodate the proxy. — `smtp_server.go`, `smtp_client_session.go`, `nginx.conf`
- **Testing coverage is limited to deduplication** (`message_cache_test.go`); the SMTP state machine, MIME handling, SES sending, and the external integrations have no tests, and there is no CI configuration in the repo.
- **Deploy builds on the production host** (`go get -d && go build` over SSH) and restarts via `pkill` + `nohup`, with no process supervisor, health check, or zero-downtime handoff; in-flight messages are dropped on restart. — `deploy`
