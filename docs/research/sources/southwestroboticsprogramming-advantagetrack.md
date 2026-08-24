# AdvantageTrack — Source Survey

**Repo:** SouthwestRoboticsProgramming/AdvantageTrack — https://github.com/SouthwestRoboticsProgramming/AdvantageTrack
**Surveyed-at:** 7da2fa31c773b74c97dfed3d8003a8d42166c278
**Permalink form:** https://github.com/SouthwestRoboticsProgramming/AdvantageTrack/blob/7da2fa31c773b74c97dfed3d8003a8d42166c278/<path>
**Stack:** Python 3.6+ backend (CherryPy + ws4py WebSocket server, `gspread`/Google API client, Pillow, `netifaces`), vanilla JS/HTML/CSS frontend (ES modules, no framework/build step); Google Sheets as the sole database, Google Drive as image storage; `fping` + `arp` shell subprocesses for network scanning. No SQL/Postgres/Mongo anywhere — a spreadsheet is the entire data layer.
**License:** MIT (`LICENSE` file present) — free to copy/adapt directly, not just ideas-only.
**Last activity:** 2025-11-19 (per `pushed_at`)
**FRC team:** Southwest Robotics Programming (team org name; specific team number not stated in repo content read)
**Areas:** (1) time/attendance — primary and only area; not people/rosters (roster is config data, not managed here), not integrations/comm/parts/manufacturing.

## Purpose
A single-purpose kiosk attendance system for FRC teams: a touchscreen/tablet sign-in/out board that also auto-detects members' phones on the team WiFi (via MAC address + ARP/fping scanning) to sign them in/out without any tap, falling back to manual sign-in/out and to a Google Sheet as the entire "database" and admin config surface.

## Auth & Roles
None in the app itself — no login, no user accounts, no RBAC. Trust boundary is physical: the kiosk is a shared device on the shop floor, and "auth" for device registration is simply "your phone's current MAC address on this WiFi network" (see Notable Details on MAC randomization). The Google Sheet is protected only by normal Google Drive sharing permissions (service account granted edit access) — no in-app permission model exists at all.

## Data Model
Everything lives in one Google Sheet with five named tabs (`google_interface.py` `SheetType` enum), each polled/pushed via `gspread`, no local DB:
- **Config - General**: key/value settings (welcome message, background Drive folder ID, IP range start/end, ping cycle/timeout/backoff seconds, auto grace/timeout/extension minutes, manual timeout/extension hours).
- **Config - People**: roster rows — id, first_name, last_name, is_student, is_active, graduation_year.
- **Data - Devices**: person → mac address → last_seen timestamp (registered-device table).
- **Data - Records**: person, start_time, end_time, start_manual (bool), end_manual (bool) — the actual attendance visit log, capped to the most recent 500 rows read per cycle.
- **Data - Status**: single-row server uptime heartbeat (start_time/last_alive), used purely as an external health check.

Local disk cache: `data/config_cache.json` (config snapshot for fast restart) and `data/backgrounds/` (downloaded+downscaled background images synced from a Drive folder).

## Features
### Time/attendance
- **Manual kiosk sign-in/out** — big-button touch UI (`www/index.html`, `www/static/modules/popupMenu.mjs`) listing active people not currently checked in; tapping a name signs in and shows a "thanks" screen for 3s (`#thanksTimeoutLengthMs`).
- **"Here Now" live roster board** — sidebar table of everyone currently checked in, distinguishing manual vs. auto check-ins visually (`www/static/modules/hereNow.mjs`); tapping a name manually signs them out.
- **Automated presence detection via network scan** (`monitor.py`) — background thread flood-pings a configured IP range with `fping`, resolves responding IPs to MAC addresses via `arp` (`arp.py`, cross-platform Linux/macOS/Windows parsing), matches MACs against registered devices, and auto-signs-in detected people.
- **Ping backoff / rate limiting** — recently-successful IPs are skipped for `ping_backoff_length_secs` to reduce network load (`monitor.py` `skipped_ips` logic).
- **Auto sign-out on absence timeout** — a person not detected for `auto_timeout_mins` is signed out, with the sign-out timestamp backdated by `auto_extension_mins` to approximate actual departure time (`monitor.py` lines ~381-386).
- **Manual-session timeout safety net** — a manual sign-in left open past `manual_timeout_hours` is force-closed with a backdated `manual_extension_hours` offset, preventing "forgot to sign out" from leaving a visit open forever.
- **Manual sign-out grace period** — a person who manually signs out is exempted from auto re-sign-in via detection for `auto_grace_period_mins`, so leaving early doesn't get immediately overridden by their still-connected phone (`monitor.py` `last_manual_sign_out` check).
- **Device self-registration flow** — a member visits a QR-coded local URL (`/add` route in `web_server.py`) from their own phone; server captures the requester's MAC from the HTTP connection's IP via `arp`, and if an "auto add" mode was armed for a specific person from the kiosk UI, links that MAC to them. Rejects addresses matching randomized-MAC patterns (`arp.py` `random_mac_address_pattern` = locally-administered bit check).
- **Device management UI** — per-person list of registered devices with last-seen date and a remove button, plus live QR code generation for the add-device URL (`popupMenu.mjs`, `www/static/qrcode.js`).
- **Live status/health indicators** — three-state (disconnected/warning/connected) status lights for WebSocket server, network monitor, and Google Sheets connectivity, pushed to all connected browser clients in real time over the WebSocket.
- **Kiosk ambience** — rotating background photos synced from a Google Drive folder (auto-downscaled with Pillow), falling back to bundled defaults when the folder is empty (`google_interface.py` `_update_backgrounds`, `default_backgrounds/`).

## Integrations
- **Google Sheets** (via `gspread`) — the entire attendance/config/roster database.
- **Google Drive** (via `google-api-python-client`) — background image folder sync, using a service-account JSON credential file.
- No Slack/Discord/email/SMS, no TBA, no OAuth login, no calendar integration.

## Notable Implementation Details
- **No real database** — a shared Google Sheet doubles as both the admin config UI (non-technical mentors edit config/people rows directly in Sheets) and the attendance ledger; this is clever for a small volunteer-run team (zero ops, free hosting, familiar editing UI) but caps out hard: full data + records refetched each poll cycle (10-60s), capped at 500 recent records, and every write is a synchronous Sheets API call inside request handlers (fragile to Google API rate limits/outages — hence the WARNING/DISCONNECTED status tri-state everywhere).
- **MAC randomization handling** — explicitly detects and rejects "private"/randomized MAC addresses (`random_mac_address_pattern` matches the locally-administered-bit convention `x2/x6/xa/xe`) since iOS/Android now randomize MACs per-network by default; README documents walking users through disabling private addressing for the specific team WiFi network only.
- **Cross-platform `arp` output parsing** — hand-rolled positional-column parsing of `arp`/`arp -a` output text for Linux, macOS, and Windows separately (`arp.py`); this is brittle (locale/version-dependent column layout) but a real "how do I get MAC from IP without extra deps" pattern worth knowing about.
- **Everything talks through closures/callbacks, not events/queues** — `main.py` wires `GoogleInterface`, `Monitor`, and `WebServer` together via passed-in lambdas (no message bus, no framework); simple but tightly coupled, fine at this scale.
- **Bare `except:` blocks** throughout `google_interface.py` and `monitor.py` swallow all exceptions and downgrade to a WARNING/DISCONNECTED status rather than crashing — reasonable for a kiosk appliance meant to run unattended, but would hide real bugs during development.
- **Single WebSocket broadcast model** — all connected browsers (in practice just the one kiosk) get identical full-state pushes (`config`, `data`, `monitor_status`, etc.) on every change; there's no per-client diffing, fine at N=1-2 clients.
- Runs as a single always-on Python process intended for a dedicated device (e.g., Raspberry Pi) auto-logging in and auto-launching a browser — an appliance deployment model, not a hosted web app.

## Verdict
Substantive and squarely on-topic: a real, MIT-licensed, working automated-attendance kiosk with a genuinely useful pattern set — MAC-based presence detection with backoff/grace/timeout state machine, self-service device registration via QR code, and a spreadsheet-as-database approach that's worth stealing for a zero-infra MVP. Worth mining primarily for the attendance state-machine (auto sign-in/out timeout/grace logic in `monitor.py`) and the device self-registration flow via `/add` + QR, rather than the Sheets-as-DB architecture itself.
