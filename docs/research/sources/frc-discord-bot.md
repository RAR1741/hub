# FRC-Discord-Bot — Source Survey

**Repo:** suhaank077/FRC-Discord-Bot — https://github.com/suhaank077/FRC-Discord-Bot
**Surveyed-at:** a2163b3c423d6f0e7c51bbe9b789c24d3f3e4e4f
**Permalink form:** https://github.com/suhaank077/FRC-Discord-Bot/blob/a2163b3c423d6f0e7c51bbe9b789c24d3f3e4e4f/<path>
**Stack:** Python, discord.py, PyMongo (MongoDB)
**License:** none — no LICENSE file present (`license` field is `null` via the GitHub API). Ideas only.
**Last activity:** 2024-04-22 (single push, `pushed_at` 2024-04-22T21:00:40Z; only one commit in history)
**FRC team:** 5190 (per repo description: "Inventory Discord Bot for FRC 5190")
**Areas:** communication (Discord bot), part design/manufacturing tracking (inventory lookups — tangential)

## Purpose
A minimal Discord bot that lets team members query a MongoDB-backed part-inventory collection by chatting with the bot ("FuryBot, run an inventory check on the item, 'Shaft Collar'"), returning quantity-on-hand and a reorder link.

## Auth & Roles
None. No role model, no permission checks — any Discord user in a channel the bot is in can query inventory. DMs are supported for private replies (message prefixed with `?`), but this is just a reply-routing convenience, not access control.

## Data Model
Single MongoDB collection, `inventory.records`, queried by exact-match filter `{'item': <name>}`. Each record appears to hold at minimum `item`, `quantity`, and `link` fields (`responses.py`). No schema is defined/enforced in code (no ODM, no validation) — it's a raw PyMongo find().

## Features
- **Communication (Discord bot core):** `main.py` — connects to Discord via `discord.Client`, listens for `on_message`, logs channel/username/message to stdout, and routes replies either to the channel or, if the message starts with `?`, as a DM to the author.
- **Communication (keyword-triggered command parsing):** `responses.py::get_response` — very simple substring-based intent matching; the bot only responds if `"furybot"` appears in the message, then checks for `hello`/`how are you`/`help`/`inventory` substrings. No real NLP, no slash commands, no argument parsing beyond `find('"')` to pull a quoted item name out of the message text.
- **Part design/manufacturing tracking (inventory lookup):** `responses.py` — looks up a part by exact name in MongoDB and returns quantity remaining plus a purchase/reorder link. This is read-only: there is no code path to add, decrement, or update inventory records — restocking/consumption must happen out-of-band (e.g., directly in MongoDB or some other unseen tool).
- **Help text:** a hardcoded help string describing the one supported command.

## Integrations
- **Discord:** via `discord.py` (`Client`/`Intents`), token from `DISCORD_TOKEN` env var.
- **MongoDB:** via `pymongo.MongoClient`, connection string from `MONGODB_URI` env var. No other integrations (no TBA, Slack, email, Onshape, etc.).

## Notable Implementation Details
- Extremely small surface area: 2 Python files, ~75 lines total, one commit ever pushed. No tests, no CI, no requirements.txt/pyproject in the tree (only `.gitattributes`, `README.md`, `main.py`, `responses.py` — dependencies are implied by imports only).
- Item-name extraction is fragile: it slices between the first two `"` characters in the raw message rather than using Discord slash-command options, so malformed quoting silently breaks the query.
- `quantity` and `link` fields are read with `.strip('"')`, implying values are sometimes stored as quoted strings in Mongo — a data-hygiene smell worth avoiding in a re-implementation (store typed values, not quoted strings).
- Inventory is read-only from the bot's perspective; there's no write/update flow, so this only covers the "check stock" half of a parts-tracking workflow, not receiving/consuming parts.
- No license file — the repo is "all rights reserved" by default; treat as ideas-only reference, not code to copy.

## Verdict
Thin: a single-evening student project (~75 lines, one commit, no tests/deps file, no license) that demonstrates the *idea* of a chat-based inventory lookup bot but has no auth, no write path, and fragile parsing — worth noting only as a minimal pattern (Discord bot + Mongo lookup + reorder link), not as an implementation to emulate closely.
