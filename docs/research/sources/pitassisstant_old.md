# PitAssisstant_Old — Source Survey

**Repo:** Auxiliatrix/PitAssisstant_Old — https://github.com/Auxiliatrix/PitAssisstant_Old
**Surveyed-at:** 6a38731de3d0d23aa51e1260bbfb0046cbab9691 (get via: gh api repos/Auxiliatrix/PitAssisstant_Old/commits --jq '.[0].sha')
**Permalink form:** https://github.com/Auxiliatrix/PitAssisstant_Old/blob/6a38731de3d0d23aa51e1260bbfb0046cbab9691/<path>
**Stack:** Plain Java (Swing GUI), no build tool config beyond Eclipse `.project`/`.classpath`; flat-file persistence (`.txt` files in the working directory); bundles a third-party TTS library (`voce`, Festival-based, in `lib/`) for speech synthesis.
**License:** MIT (`LICENSE` file present) — safe to use as a direct reference, but this survey follows the ground rule of ideas-only / recreate-don't-copy.
**Last activity:** 2016-10-11 (single commit history point surveyed; repo `pushed_at` 2017-03-25; archived on GitHub since)
**FRC team:** Team 604 (inferred from `604logo.bmp`, the "604 logo" window icon, and shop-jargon inventory contents; register roster names are unattributed students, not a team number)
**Areas:** (5) parts ordering/POs — partial (borrow/lend tracking only, no POs) — and (6) part design/manufacturing tracking, specifically **pit inventory location tracking**. Also touches (2) people/rosters in a minimal way via the "register" feature.

## Purpose
A desktop, chatbot-style Java Swing app ("Pit Assistant") that lets a team member type natural-language-ish queries ("where's the wrench?") to find which tote/box/location a shop item lives in, track items borrowed from or lent to other teams, and take freeform notes — aimed at solving the classic FRC pit problem of "where did we put the thing" during build season and at competitions.

## Auth & Roles
None. Single local user, single Swing window, no login. A "register" mode (`register()` in `PitAssistant.java`) captures a person's name/email/grade into `register.txt` as a very lightweight roster/signup sheet — not tied to any permission system, just a flat append-only text log.

## Data Model
Entirely flat-file, no database:
- `inventory.txt` — the master data file. Custom line-based mini-format parsed by `InventoryLoader.java`:
  - `+Location Name` starts a new named storage location (e.g. `+Tool Box`, `+Tote A`)
  - a bare line is an item name under the current location
  - `-alt name` lines attach alternate names/descriptors to the preceding item (used for fuzzy matching)
  - `//` lines are comments
  - Loaded into `masterInventory[location][itemIndex][descriptorIndex]` (a 3D string array) plus parallel arrays for pointers/sizes (`masterInventoryPointers`, `masterInventoryDescriptionsPointer`)
- `borrow.txt` — persisted borrow/lend ledger: pairs of (item name, team number) for both "we borrowed from them" and "we lent to them", loaded into parallel arrays (`borrowedItem`/`borrowedTeam`, `lentItem`/`lentLoc`/`lentTeam`)
- `preferences.txt` — key/value pairs for program name, user name, text colors, language, "sarcasm" level, and a `started` flag that gates the first-run tutorial
- `register.txt` — flat roster: name / email / grade triplets, one per line, per signup
- No relational structure at all — everything is parallel primitive arrays indexed by hand-tracked pointers (e.g. `borrowedPointer`, `lentPointer`), not objects/records.

## Features

### Part / inventory location tracking (area 6)
- Free-text "where is X" search across all locations, matching on item name and any attached alt-name descriptors, via substring containment in both directions (`recursiveSearch`, `PitAssistant.java`)
- Exact-match search using quoted terms (`"the widget"`) via `recursiveExactSearch` / `parseExact`
- Keyword extraction from a full sentence with a stopword exclusion list (`Exclusion[]`) and a minimum keyword length, so "where did we put the hammer" reduces to meaningful search terms (`parse`)
- Per-location listing ("what's in Tote A") and full-inventory dump ("list everything") via `recursiveList`
- Results reported grouped by location name with a de-dup pass (`antiRepeat`) so the same item found via multiple descriptors isn't printed twice (`recursiveOutput`)
- Inventory reloadable at runtime by saying "restart"/"initialize" without restarting the whole program

### Borrow/lend tracking (area 5, adjacent — informal inter-team loan ledger, not a PO system)
- Natural-language borrow/lend intent detection distinguishing "we borrowed from them" vs "we lent to them" via keyword heuristics (`cmd`, borrow branch in `PitAssistant.java`)
- `borrow("in"|"out"|"null")` prompts for item + other team number and appends to the in-memory + on-disk ledger
- `listBorrow()` prints current outstanding borrowed/lent items
- Search results annotate an item as "lent to team N" when applicable, cross-referencing the borrow ledger against the location search (`recursiveOutput`)
- Full backup/restore and reset of the borrow ledger (`resetBorrow`, `restoreBorrow`, `saveBorrow`/`clearBorrow`) — a single-level undo, not versioned history

### Notes
- Freeform "make a note"/"write"/"record" capture (`takeNote`) and note listing (`printNotes`), stored as plain lines, no per-item association

### People/roster (area 2, minimal)
- `register()` walks a person through name → email (validated for `@`/`.`) → grade, appends to `register.txt`
- `printRegister()` lists all registrants, normalizing grade words ("freshman" → "9", etc.) to numbers on display

### Personalization / chat UX
- Rename the bot and the user, change text colors for each (`nameChange`, `colorChange`), persisted to `preferences.txt`
- Toggle text vs. voice output (`MODE`), backed by the bundled `voce` speech-synthesis library
- Nickname detection so the bot "responds" when addressed by its current name
- Large amount of Easter-egg / personality-flavor text matching (in-jokes, canned responses to specific phrases) mixed directly into the same command dispatcher as real functionality
- `changelog` and `todo` commands print an inline hardcoded version history / TODO list to the console

## Integrations
None. No web services, no Onshape/TBA/Slack/Discord/email/SMS. The only "external" dependency is a bundled local TTS library (`lib/voce.config.xml`, Festival-based) for optional voice output — not a network integration.

## Notable Implementation Details
- Extremely dense, un-abstracted procedural style: nearly all state is `public static` primitive arrays with hand-maintained parallel "pointer" indices (e.g. `borrowedPointer`, `resultPointer`, `keywordPointer`) instead of collections or objects — a clear anti-pattern to avoid when recreating this (use a real `Item`/`Location`/`Loan` model with an actual store/DB instead).
- Fixed-size arrays sized by guesswork (`new String[1000]`, `new String[255][1000][100]`) — a hard scale ceiling; would silently overflow/index-fault well past a real team's inventory size in a straight reimplementation.
- Intent parsing is a long cascade of `String.contains()` keyword checks with no real NLP — brittle but instructive as a "cheapest possible natural-language interface" pattern for a small closed vocabulary domain (worth stealing the *idea* of a quick-search box that accepts loose phrasing, not the implementation).
- Custom mini-format in `inventory.txt` (`+Location`, item, `-descriptor`) is a genuinely reusable *concept* — a flat, human-editable seed file for bootstrapping a location/item hierarchy with searchable aliases, which maps cleanly onto a real "location → item → aliases" schema in a modern app.
- Dead/commented-out code left in place (a whole legacy `output()`/`search()` implementation is `/* ... */`'d out inside `PitAssistant.java` rather than deleted) — historical cruft, not a pattern to emulate.
- Everything is single-machine, single-user, file-based; no concurrency, no networking, no persistence beyond the working directory — this is fundamentally a personal/shop desktop tool, not a team-wide system.

## Verdict
Thin on architecture (procedural single-class Java with no persistence layer or auth) but genuinely useful as legacy inspiration for two narrow, reusable ideas: (1) a lightweight, human-editable text format for seeding a location→item→alias inventory hierarchy, and (2) a loose natural-language "where is X" search box as a UX pattern for pit inventory lookup — both worth recreating in a modern schema-backed app; the borrow/lend ledger and roster features are too minimal to be worth more than a passing nod.
