# team4099/Inventory — Source Survey

**Repo:** team4099/Inventory — https://github.com/team4099/Inventory
**Surveyed-at:** 17a6e7b6ebd4feb9bfaf917140239d68fc150b7b
**Permalink form:** https://github.com/team4099/Inventory/blob/17a6e7b6ebd4feb9bfaf917140239d68fc150b7b/<path>
**Stack:** Python 3 / Flask (`flask`, `flask_session`, `flask_bower`), `jellyfish` for fuzzy string matching, flat JSON file as the datastore (no DB), Bootstrap + Bootstrap Material Design + jQuery front end (Bower-managed static assets)
**License:** GNU General Public License v3.0 (`LICENSE` file present) — copyleft, ideas only, no code reuse
**Last activity:** 2018-10-26 (single-shot student project, unmaintained since)
**FRC team:** 4099 (confirmed in `main.py` docstring "Inventory system for FRC Team 4099" and README "FRC Closet Inventory System — Team 4099's CIS for Room 199")
**Areas:** (5) parts ordering/POs — closer to raw stockroom/bin inventory tracking than purchase-order workflow; no PO or vendor-ordering flow exists

## Purpose
A single-page closet/stockroom inventory tracker for an FRC team's parts room: lets members search for a part by name or numeric ID, see its bin location and quantity, and check items in/out of a running "cart," while a hidden admin mode lets a privileged user add, remove, and re-stock items. It solves "where is this part and how many do we have" for a physical shop bin system, not supplier ordering or BOM/PO tracking.

## Auth & Roles
- Single shared "admin" flag, no user accounts. `POST /login` (`main.py`) compares a submitted password against one hardcoded MD5-looking string constant in code (`passwd == "8d56e58b448bcda2cf79b94abb3451d7"`) and sets `session["admin"] = True/False` via Flask's server-side session (`flask_session`, filesystem-backed).
- No differentiated roles beyond admin vs. non-admin; every other visitor is anonymous and can search/view/checkout.
- Enforcement is server-side but coarse: `/add` and `/remove` check `session.get("admin", False)` and otherwise silently `return` (falls through to a 200 with empty body rather than a proper 403).
- `app.secret_key` is a hardcoded byte constant committed to the repo (`main.py`), and the client posts the raw password to `/login` in plaintext over the form body (client-side MD5 hashing library is loaded in `templates/index.html` via `md5.js` but the check itself compares to a static string, not a computed hash tied to a real credential store).

## Data Model
- No database — a single JSON array in `items.json` (also the file the app reads/writes at runtime), pre-sized to `MAX_ITEMS = 10000` slots in `main.py`.
- Each item is a fixed-position array (not an object): `[name, quantity, notes, location, purchase_link, image_link]`. An empty slot is `0`/`null`.
- The item's array index doubles as its permanent "UUID"/part code (zero-padded to 4 digits for display, e.g. `#0007`), so IDs are just array offsets — `add()` in `main.py` finds the first empty slot to reuse.
- A separate flat `log.log` text file (`LOG_FILE` in `main.py`) is appended to (not read structurally) as an audit trail of admin add/remove/quantity-change actions.
- No relations, no history table, no timestamps beyond the log text — quantity changes overwrite in place.

## Features

### Parts inventory (area 5 — closest fit, stockroom-style)
- **Fuzzy/prefix search** — `GET /search` (`main.py`) supports two modes: a `$`-prefixed numeric lookup that matches item codes by prefix (`i.startswith(num)` / zero-padded), or free-text search ranked by Jaro-Winkler string similarity (`jellyfish.jaro_winkler`) against item names, returning best matches first.
- **Item lookup by code** — `GET /get_info?code=` and `GET /get_all` (`main.py`) return single-item or full-inventory JSON dumps for the front end to render.
- **Add item (admin only)** — `POST /add` (`main.py`): name, quantity, notes, bin location, purchase link, and image link fields; assigns the next free slot as the item's code and persists to `items.json`.
- **Remove item (admin only)** — `POST /remove` (`main.py`): nulls out the slot for a given code.
- **Quantity / check-in-out** — `POST /change_quantity` (`main.py`): adjusts an item's quantity up (check-in/restock) or down (checkout) by a delta, with an optional notes update; both directions logged.
- **Checkout "cart" UI** — client-side only (`static/js/main.js`): a running `cart` array lets a user tick checkboxes across multiple search results, set a quantity per row, and submit the batch; renders success/failure alert banners (`SHOW_ID_CONTENTS`, `CHECK_IN_OUT_CONTENTS` templates in `main.js`) confirming what was checked in/out and from which bin location.
- **Bin/location field** — every item carries a free-text "location" string (e.g. `"B4 Black Box"`, `"A3 Green Box 1"` per `items.json` seed data) shown in every table row; this is the closest thing to a storage-location taxonomy, but it's unstructured text, not a normalized bin/shelf model.
- **Purchase link + image link fields** — present in the data model and add form (`main.py`, `main.js`) but the seed data (`items.json`) leaves them empty; there is no vendor/PO object, no price, no reorder threshold, no supplier integration — just a raw URL field a human could paste a supplier link into.
- **Admin audit log** — plain-text append-only log of who (implicitly "Admin") did what to which item and when-adjacent quantity, viewable via `GET /log` (`main.py`).

## Integrations
None. No Onshape/CAD BOM import, no TBA, no Slack/Discord/email/SMS, no supplier API, no barcode/QR scanning (despite bin-based physical layout). The Bower-managed static assets (`bower.json`) are just Bootstrap/jQuery/Material Design UI libraries, not integrations.

## Notable Implementation Details
- **Fixed-size array as a database**: pre-allocating a 10,000-slot list and using the array index as the permanent item ID is a scale/architecture red flag — it caps the catalog at `MAX_ITEMS`, makes IDs meaningless outside insertion order, and means the entire inventory is read/written as one JSON blob on every single mutation (`update_item_file()` in `main.py` rewrites all of `items.json` on every add/remove/quantity-change). Fine for a few hundred parts in one closet, would not scale or survive concurrent writes.
- **Hardcoded secret + single shared admin password**: the Flask `secret_key` and the admin password check are both literal constants committed to source (`main.py`) — anyone who reads the repo (public, GPL) has the "admin" password and the session-signing key. A re-implementation should treat this purely as "there was a single privileged mode gating add/remove" and use real per-user auth instead.
- **No input validation / error handling on numeric fields**: `change_quantity` and `add` do direct `int(request.form[...])` conversions with no try/except, so malformed requests 500 rather than fail gracefully.
- **Jaro-Winkler fuzzy search is a nice, cheap idea**: ranking all non-empty items by string similarity to the query (`main.py`, `jellyfish.jaro_winkler`) gives typo-tolerant search without an external search engine — worth reusing the *idea* (fuzzy name matching) in a modern re-implementation, e.g. via Postgres trigram/`pg_trgm` or a client-side fuzzy-match library instead of scanning all 10,000 slots per request.
- Dev server runs with `debug=True` bound to `0.0.0.0:8080` (`main.py`) — a development convenience left in, not something to carry forward.

## Verdict
Thin but genuine: a real, working single-file Flask CRUD app for closet/bin inventory with a nice fuzzy-search touch, but no ordering/vendor/PO workflow, no real auth, and an unmaintained 2018 prototype architecture (flat-file JSON "database," array-index IDs, hardcoded secrets). Worth stealing only the two ideas: (1) index inventory by physical bin/location as a first-class field, and (2) fuzzy/typo-tolerant name search for a fast "where's this part" lookup — everything else (data model, auth) should not be replicated.
