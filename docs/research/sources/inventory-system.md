# Inventory-System — Source Survey

**Repo:** jholmes802/Inventory-System — https://github.com/jholmes802/Inventory-System
**Surveyed-at:** edb8748d47ff6c138e02a65704ec276847d42857
**Permalink form:** https://github.com/jholmes802/Inventory-System/blob/edb8748d47ff6c138e02a65704ec276847d42857/<path>
**Stack:** Python 3.9, stdlib `http.server` (no web framework), SQLAlchemy Core over SQLite, vanilla JS/CSS frontend (no build step), `python-barcode` + `brother_ql` for label printing, `gspread`/`oauth2client` for Google Sheets backup
**License:** MIT (`LICENSE` file present, root of repo) — permissive, but per project ground rules still treated as ideas-only (recreate, don't copy)
**Last activity:** 2022-03-23 (pushed_at)
**FRC team:** 1073 (README title "1073-Inventory-System"; devdocs BOM filename references team 1073)
**Areas:** (5) parts ordering/POs — partial (vendor catalog only, no PO workflow); (6) part design/manufacturing tracking — partial (physical stock/location tracking, not CAD/manufacturing status)

## Purpose
A self-hosted physical parts-inventory tracker for an FRC team: add parts, check them in/out of stock with barcode scans, track quantities across storage locations, and periodically back up the SQLite database to a Google Sheet.

## Auth & Roles
None. `src/posts.py:newuser` is a stub that returns `"Oops not implemented!"`. The `dat_struc.json` schema defines a `users` table with a `level` and `rfid` field (suggesting a planned permission tier + badge-scan login), but no code path reads or enforces `level` anywhere — the web server has no session/login gate at all.

## Data Model
Defined declaratively in `src/dat_struc.json` and materialized into SQLAlchemy `Table` objects by `src/db_manager.py`. Backing store is SQLite (`data/inv_data.db` / `inv_data2.db` — inconsistent between `dat_struc.json`'s `db_path` and the hardcoded engine URL in `db_manager.py`).

- **items** — `part_number` (PK), `part_uuid`, `part_name`, `qty`, `threshold_qty`, `alt_part_nums`, `tags`, `status` (`INUSE`/`ARCHIVED`)
- **transactions** — `datetime` (PK), `part_number_uuid`, `typ` (`IN`/`OUT`/`VERIFY`), `qty`, `dest`, `source`, `comment`, `transaction_uuid` — an append-only ledger of every stock movement
- **vendor_catalog** — `vendor_part_number` (PK), `vendor_prt_uuid`, `vendor_part_name`, `unit_qty`, `unit`, `vendor_name`, `vendor_part_link`, `man_part_number`, `man_link`, `man_name`, `man_part_name`, `price` — one row per (vendor, part) SKU, no linkage back to `items` in code
- **location_info** — `loc_name`, `loc_uudi` (PK), `loc_location`, `loc_owner`, `loc_desc`
- **loc_items** — `part_number_uuid`, `loc_uuid`, `loc_prt_qty` — join table for per-location stock counts (schema exists; no read/write code found in `dataio.py`)
- **uuids** — global uuid registry (`uuid` PK, `typ`) used to guarantee uniqueness across all uuid-typed fields
- **users** — `username`, `firstname`, `lastname`, `user_uuid` (PK), `level`, `rfid` (unused beyond insert)

## Features

### Parts ordering / vendor catalog (area 5)
- `vendor_catalog` table models vendor SKUs with price, unit qty, vendor/manufacturer links (`src/dat_struc.json`) — schema only, no CRUD/UI code found anywhere in `src/` or `web/` referencing this table (dead/planned feature).

### Stock tracking & check-in/out (area 6, physical parts tracking)
- New item creation with auto-generated UUID and initial `INUSE` status: `src/posts.py:new_item` → `src/dataio.py:items.new`
- Check-out (decrement qty, log transaction): `src/posts.py:checkout_post` → `src/dataio.py:transactions.checkio`; UI at `web/checkout/script.js`
- Check-in (increment qty, log transaction): `src/posts.py:checkin` → same `checkio` with `IN`/`OUT` flag; UI at `web/checkin/script.js`
- Physical inventory verification against expected qty: `src/posts.py:verify` → `src/dataio.py:transactions.verify`; UI at `web/verify/script.js`
- Part edit (arbitrary field update by uuid): `src/posts.py:editpart` → `src/dataio.py:items.edit`
- Archive/restore item status toggle (`INUSE`/`ARCHIVED`), itself logged as a transaction: `src/posts.py:itemstatus` → `src/dataio.py:items.status`
- Per-item transaction history plotted as a qty-over-time PNG chart via matplotlib, base64-embedded: `src/dataio.py:items.transactions_hist`
- Full transaction ledger query with optional type/count filters: `src/dataio.py:transactions.get_transactions`, `transactions.item_transactions`
- Bulk CSV import of parts (part number/name/qty column autodetection): `src/dataio.py:mass_import_items`; UI at `web/admin/import/script.js`
- Barcode generation (Code128, sized to part-number length) and thermal-label printing via a Brother QL printer over USB: `src/barcodes.py:barcode_gen`, `print_barcode`; triggered by `/pst/printBarcode` in `src/posts.py`
- Location schema for multi-location stock (`location_info`, `loc_items` tables) — defined but not wired into any read/write code path (planned/incomplete)
- Automated SQLite + per-table CSV backup with 30-generation rotation/cleanup: `src/db_manager.py:db.backup`
- Google Sheets mirror of the live items table as an off-site backup: `src/g_backup.py:g_backup`, driven by a service-account credential file (`creds.json`, not checked in)

### Web frontend
- Server-rendered pages for home/stock view, new-item form, checkout, checkin, verify, admin, admin/import, admin/users, and item detail — each with its own `script.js`/`styles.css` under `web/`, served directly from disk by `src/main_server.py:do_GET` (hardcoded path-to-handler dict, no routing framework)
- Custom web font (`ufonts.com_bank-gothic-light.woff`) served as a special-cased content type

## Integrations
- **Google Sheets** — one-way push backup of the items table via `gspread` + a Google service-account OAuth2 credential file (`src/g_backup.py`)
- **Brother QL label printer** — direct USB/raster printing of generated barcodes (`src/barcodes.py`, `brother_ql` package)
- No Slack/Discord/email/SMS, no TBA/FRC-event API, no Onshape/CAD integration

## Notable Implementation Details
- Runs on Python's raw `http.server.BaseHTTPRequestHandler` with a hand-rolled path→handler dict for both GET and POST — no Flask/Django/FastAPI; every route, static asset, and content-type is hardcoded in one large dict in `main_server.py`, and `do_GET` `importlib.reload(pages)`s on every single request (a live-reload hack, not something to replicate).
- POST routing does zero auth/validation beyond checking `Content-type: application/json`; any client can call `/pst/editpart` or `/pst/itemstatus` with an arbitrary uuid.
- A new `db_manager.db()` object (which re-parses `dat_struc.json` and re-creates the SQLAlchemy engine/metadata) is instantiated per function call throughout `dataio.py` rather than reused/pooled — fine at FRC-team scale, would not survive real concurrent load.
- `db_manager.py`'s hardcoded SQLAlchemy engine path (`../data/inv_data2.db`) disagrees with the `db_path` value in `dat_struc.json` (`../data/inv_data.db`) — an actual bug/inconsistency in the source, worth noting so it isn't propagated into a rebuild.
- UUID unification: every entity type (item, transaction, user, location) draws from one shared `uuids` table to guarantee global uniqueness and let uuid-typed foreign-key-like columns be validated generically — a reasonable pattern to borrow even without SQL foreign keys.
- Six SQLite database file copies (`inv_data copy 2.db`, `inv_data copy 3.db`, etc.) are committed directly to `data/` in the repo, and `src/logs/` contains ~20 real dated log files — signs of ad hoc backup/debug habits rather than deliberate design; also inflates repo size for no benefit.
- Multi-location stock (`location_info`/`loc_items`) and vendor catalog are both fully specified in the schema but have no corresponding application code — useful as an idea for schema shape, useless as a reference implementation for the feature.

## Verdict
Substantive, single-author FRC team-1073 tool with a genuinely useful check-in/out + transaction-ledger + barcode-label pattern for physical parts tracking (area 6), but its vendor-catalog/parts-ordering piece (area 5) is schema-only with zero implementation, and there's no auth/roles at all. Worth stealing: the append-only transactions ledger (IN/OUT/VERIFY typed rows driving both current qty and full history), the shared global-uuid table pattern, and the Brother QL barcode-label workflow — not the raw `http.server` routing approach or the lack of any access control.
