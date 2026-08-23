# Second — Source Survey

**Repo:** mercsmavs-msa/second — https://github.com/Mercs-MSA/Second
**Surveyed-at:** 93ac4b931c4726838d8e56561cfd532e17def6d1
**Permalink form:** https://github.com/Mercs-MSA/Second/blob/93ac4b931c4726838d8e56561cfd532e17def6d1/{path}
**Stack:** Flutter/Dart (Android/iOS/Linux/macOS/Windows/Web targets), Google Sheets as the backend of record (via `googleapis` Sheets v4 API + a service account), `shared_preferences` for local cache/offline queueing
**License:** GNU GPL v3.0 (LICENSE file present) — copyleft, **ideas only**
**Last activity:** 2026-08-18 (pushed_at; default branch `0.2-dev`)
**FRC team:** McKinney STEAM Academy (Android package `org.mckinneysteamacademy.second`; README says "designed for FRC and FTC teams", published under org "Mercs-MSA")
**Areas:** (1) time/attendance — primary focus; (3) third-party integrations — Google Sheets as datastore; (4) communication — in-app message board

## Purpose
A kiosk-mode attendance tracker for FRC/FTC teams: members badge in/out (RFID or PIN) at a shared tablet/PC, and all roster + attendance data lives in a Google Sheet the mentors already control — no separate server or database to host.

## Auth & Roles
- No user login to the app itself — the app runs as a shared kiosk. Two PIN layers:
  - **Global admin PIN** (`security.pin` setting, default `000000`) gates the app's own Settings/config/logs screens.
  - **Per-member PIN**: members flagged with the `require-pin` group (typically admins/mentors) must set/verify a 6-digit PIN (SHA-256 hashed, `lib/passwords.dart`) to clock in/out manually; students clock in/out with no PIN. RFID badge scans bypass PIN entirely for non-required members.
  - Password hash reset is done by mentors deleting the "Password Hash" cell in the sheet (`docs/faq.md`); member is re-prompted to set a new PIN next login.
- No network auth for end users; Google Sheets access is via a single shared service-account credential (JSON) pasted into settings — same credential used by all kiosks unless configured otherwise (`docs/limitations.md` recommends one service account per kiosk to spread API rate limits).

## Data Model
Everything lives in one Google Sheet with three tabs, defined as a schema constant in `lib/backend.dart` (`appMembersSchema`):
- **Members** sheet — one row per person: `ID, BadgeIDs, Name, Nickname, Titles, Groups, Status, Location, PasswordHash, PFP, Events, TotalHours`. `Status` is `Present`/`Out`; `Groups` is a comma-separated tag list (`admin`, `require-pin`, `unlisted`, `skip-messageboard`, arbitrary message-board target tags); `Titles` comma-separated role labels; `PFP` supports an `=IMAGE("url")` cell formula, parsed client-side.
- **INTERNAL.Log** sheet — append-only audit log: memberId, timestamp (written via `=EPOCHTODATE()` sheet formula), location, action (`CHECKIN`/`CHECKOUT`/`CHECKOUT_AUTO`).
- **LogoutTiming** sheet — per-day auto-checkout rules: `day, check (HH:MM), apply (HH:MM), backdate, enable` — one row per weekday.
- **MessageBoard** sheet — columns `title, message, timeout, require-accept, target, read-by` for the announcement board.
- Local device state (SharedPreferences): app settings, a cached copy of the member roster (`cached.members`) for offline display, and **serialized offline queues** (`queues.clockIn`, `queues.clockOut`, `queues.updates`, `queues.log`) so clock events survive app restarts/connectivity loss before being pushed to Sheets.

## Features

### Time/attendance
- RFID badge clock in/out with two reader modes: keyboard-emulating USB HID (parses raw keystroke stream with configurable timeout/EOL/decimal-or-hex format) or a native platform channel reader — `lib/rfid_event.dart`, RFID handling in `lib/main.dart` (`_rfidHidEventListener`, `_processRfid`).
- Manual PIN-based clock in/out flow with location selection (multi-station support: `station.locations`, `station.fixed`) — `lib/user_flow.dart`.
- Offline-first write queue: clock events are queued locally (`CachedQueue<T>` in `lib/backend.dart`) and cached to SharedPreferences so a network blip doesn't lose punches; queues drain to the Sheet on a timer with active/inactive push-pull interval scaling that speeds up sync right after activity and backs off when idle (`_reactivateCooldown`, `backend.interval.*` settings) — `lib/backend.dart`.
- Configurable **auto clock-out**: per-weekday rules (check time, applied checkout time, "backdate to previous calendar day" for overnight checks, enable toggle), evaluated once per minute by a `CheckoutScheduler` and applied by force-clocking out anyone still `present` — `lib/config_table.dart` (`CheckoutConfigurationTable`, `CheckoutScheduler`), UI in `lib/auto_checkout.dart`.
- Live roster list with search-by-name and sort by name or status (present-first/out-first), presence dot indicators, avatar-or-initials fallback — `lib/main.dart`.
- Manual "refresh" button to force an immediate Sheets sync (`instantMemberUpdate`) bypassing the poll interval.
- "System status" tile showing Google connectivity and pending-push count, so mentors can see if the kiosk has fallen offline — `lib/state.dart`, `_getStatus()` in `lib/main.dart`.
- Success/fail popups (Lottie animations + confetti) for good/bad scans — quick kiosk-usable feedback.
- Optional "disable non-RFID clock-in" lockout mode (`list.disable`) forcing badge-only check-in for some/all events.
- Configurable inactivity-triggered kiosk behaviors: Android "lockdown" mode makes the app the device's default launcher and absorbs volume-key presses to prevent staff from leaving kiosk mode (`lib/android_lockdown.dart`), plus immersive/edge-to-edge fullscreen.

### Communication
- **Message board**: mentor-authored announcements targeted by member group/tag (glob-matchable target patterns), with optional "require accept" acknowledgment and per-message timeout, shown to members during their clock-in flow before they can proceed — `lib/message_board_loader.dart`, consumed in `lib/user_flow.dart` (`myMessages`, `filterTarget`).
- In-app log viewer (`lib/log_view.dart`) for on-device diagnostic logs (bounded in-memory ring buffer via `logger` package), useful for a mentor to debug a misbehaving kiosk without a laptop.

### Configuration / ops
- Full settings UI (`lib/settings_page.dart`) covering Google credentials, theme (dark/light, accent color, low-resource/no-animation mode for weak kiosk hardware), sync interval tuning, RFID reader mode/timeout/format, station location list, admin PIN, and a JSON settings export/import for cloning a kiosk's config to another device.
- Virtual on-screen keyboard (`lib/keyboard.dart`, XML-defined layouts under `assets/layouts/`) — the app deliberately ignores the physical keyboard for member-facing search/PIN entry, forcing on-screen input to keep a kiosk locked down (documented gotcha in `docs/faq.md`).
- A companion Python installer (`pi_os_installer/`) for flashing/provisioning a Raspberry Pi kiosk image.

## Integrations
- **Google Sheets** — sole backend; service-account OAuth (`googleapis_auth`), read/write via `googleapis` Sheets v4 batchGet/batchUpdate/append. No other integration (no Slack/Discord/TBA/email).

## Notable Implementation Details
- Documents Google Sheets API's own rate limits as a hard operational ceiling (300 req/min/project, 60/min/user/project) and explicitly recommends **one service account per kiosk station** to avoid hitting the per-user quota when multiple stations share credentials — `docs/limitations.md`. Worth replicating as a warning if we ever back a feature with Sheets-as-DB.
- Distinguishes "active" vs "inactive" sync cadence: pull/push intervals shrink for ~60s after any clock event then decay back to a slower idle poll — a lightweight adaptive-polling pattern to reduce API calls between bursts of kiosk activity, without needing websockets/webhooks.
- Clock events are deliberately **queued and coalesced** rather than written immediately: a member could badge out then back in before the queue drains, so `_update()` sorts all queued events by timestamp and only writes the final resolved status/location per member, while still logging every individual event to the separate log sheet.
- Schema drift protection: on every full Sheets pull the app validates the header row against a hardcoded expected schema (`appMembersSchema`) and refuses to apply the update (logs an error) if a mentor manually reordered/renamed columns — cheap guard against silent data corruption from spreadsheet edits.
- PFP handling parses Sheets' `=IMAGE("url")` cell formula text directly (reading with `valueRenderOption: 'FORMULA'`) rather than requiring a plain URL column — a minor Sheets-specific hack worth knowing if recreating image support.
- GPL-3.0 licensed — ideas only, no code reuse.

## Verdict
Substantive, actively developed, single-purpose kiosk attendance app with a genuinely novel-to-this-catalog backend choice (Google Sheets as the system of record, no server). Worth stealing: the offline write-queue + adaptive sync-interval pattern, the per-weekday auto-checkout scheduler with backdate handling, and the message-board glob-target/require-accept model for reaching specific member subgroups. GPL-3.0 means ideas only, no code lift.
