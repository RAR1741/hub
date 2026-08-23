# Claude4FRC — Source Survey

**Repo:** tech-support03/Claude4FRC — https://github.com/tech-support03/Claude4FRC
**Surveyed-at:** f3dccb0ae2b85894988f0448d6165c25693ad7d5
**Permalink form:** https://github.com/tech-support03/Claude4FRC/blob/f3dccb0ae2b85894988f0448d6165c25693ad7d5/<path>
**Stack:** Python, `mcp[cli]` (Model Context Protocol server, FastMCP), `httpx` (async HTTP), `python-dotenv`; no database — a flat JSON file (`data/mkcad-catalog.json`) is the only persistence
**License:** none (all rights reserved) — ideas only. `license` field is `null` on the GitHub API and no LICENSE file exists in the tree.
**Last activity:** 2026-04-17 (single burst of commits; repo created and pushed same day)
**FRC team:** unknown (author handle "tech-support03"; catalog code references "Milkenknights" as an MKCad-maintainer account name, but that's the third-party parts-library maintainer, not necessarily this repo's own team)
**Areas:** part design/manufacturing tracking (Onshape CAD integration); tangential third-party integration (Onshape API)

## Purpose
An MCP (Model Context Protocol) server that lets Claude (or any MCP client) drive Onshape CAD directly — list/inspect documents, read and edit Part Studio features, run FeatureScript, inspect assemblies, and pull mass properties — so an FRC team can have an LLM assist with CAD modeling and BOM/mass tracking inside their existing Onshape documents. It also indexes the community "MKCad" library of COTS FRC parts (motors, wheels, gearboxes, bearings, electronics) into a local search catalog so parts can be found and inserted into an assembly by name/part-number instead of browsing Onshape manually.

## Auth & Roles
None in the team-ops sense — this is a single-user local MCP server, not a multi-user web app. Authentication is entirely to the *external* Onshape API: HMAC-SHA256 request signing using an `ONSHAPE_ACCESS_KEY`/`ONSHAPE_SECRET_KEY` pair (from `.env`, loaded via `python-dotenv`), implemented in `src/onshape_client.py`. Every request is signed per-call with a fresh nonce + UTC date + lowercased canonical string (method, nonce, date, content-type, path, query). No user accounts, sessions, or role model exist in this codebase.

## Data Model
No relational/SQL data model. Two data shapes matter:
- **Onshape API objects** (external, not owned by this repo): documents → workspaces → elements (Part Studios/Assemblies/Drawings) → parts/features/mass-properties/assembly-instances-and-mates. All tools are thin typed wrappers over these REST endpoints.
- **MKCad catalog** (`data/mkcad-catalog.json`, built by `scripts/index-mkcad.py`): a flat JSON array of part records — `name`, `partNumber`, `category`, `documentId`, `versionId`, `elementId`, `partId`, `isAssembly` — indexed_at timestamp at the top level. This is the only local persistence in the whole project; it's a build artifact, not a live database.

## Features

**Part design/manufacturing tracking (Onshape CAD):**
- Document browsing: list recent Onshape documents with optional name-filter search, get document metadata (owner, default workspace, created date) — `src/tools/documents.py`
- Tab/element enumeration: list all Part Studios/Assemblies/Drawings inside a document+workspace — `src/tools/documents.py` (`get_elements`)
- Feature-tree inspection: list every feature in a Part Studio with name/id/type/suppressed state — `src/tools/parts.py` (`get_features`)
- Part listing with material: list all parts in a Part Studio with resolved material display names and body type — `src/tools/parts.py` (`get_parts`)
- Mass/weight tracking: pull per-part mass properties from Onshape and convert to pounds (kg→lbs at 2.20462), with a name lookup against the parts list and a graceful fallback to the `-all-` aggregate body if per-part IDs are unavailable — `src/tools/parts.py` (`get_mass_properties`); useful directly for FRC's 125 lb weight-limit tracking use case
- CAD authoring via LLM: add a raw Onshape feature (sketch, extrude, etc.) to a Part Studio by JSON feature definition — `src/tools/parts.py` (`add_feature`)
- FeatureScript execution: run arbitrary FeatureScript expressions against a Part Studio for complex geometry queries/operations — `src/tools/parts.py` (`evaluate_featurescript`)
- Assembly structure inspection: read full assembly definition — every instance (name, part id, source document/element, suppressed flag) and every mate feature (name, mate type, suppressed) filtered out of the general feature list by matching `"mate"` in the feature type string — `src/tools/assemblies.py` (`get_assembly_definition`)
- Assembly authoring: insert a part or whole assembly from another (versioned) document into a target assembly, and create new blank assembly tabs — `src/tools/assemblies.py` (`create_instance`, `create_assembly`)
- **COTS parts catalog (MKCad):** an offline-built, case-insensitive scored search (exact name/part-number match scores highest, then prefix match, then substring match) over a pre-indexed library of FRC COTS hardware (motors, wheels, gearboxes, bearings, electronics), plus one-call insert of the top match into a target assembly — `src/tools/mkcad.py`, catalog build script `scripts/index-mkcad.py`, data file `data/mkcad-catalog.json`
- Catalog indexer: paginates Onshape's document search API (20/page) filtered to documents owned by named MKCad-maintainer accounts, walks each into elements/parts, and derives a "category" from the document name by splitting on an em-dash/hyphen/colon — `scripts/index-mkcad.py`

## Integrations
- **Onshape** (CAD platform) — the entire product is an Onshape API client; REST v6 API at `cad.onshape.com`, HMAC-SHA256 request signing, sequential 200ms-throttled calls with one retry on error/network-failure — `src/onshape_client.py`.
- **MCP (Model Context Protocol)** — the server exposes all tools over stdio transport via `mcp.server.fastmcp.FastMCP`, meant to be attached to Claude Desktop/Code or any MCP-compatible client — `src/server.py`.
- No Slack/Discord/email/SMS/TBA/Google integration of any kind.

## Notable Implementation Details
- Client-side rate limiting is a simple monotonic-clock gate (200ms minimum between calls) rather than a queue/semaphore — fine for a single interactive LLM session, would not hold up under concurrent/parallel tool calls.
- Retry logic is a single hardcoded retry (attempt 0 → sleep 1s → attempt 1 → raise) baked into the private `_request` method for both HTTP error and network-exception paths — reasonable but not configurable, and re-signs the request for the retry (correct, since nonce/date are part of the signature).
- Mass properties conversion hardcodes kg→lbs (2.20462) inline; simple but a reminder Onshape returns metric.
- The MKCad catalog is a static snapshot (an `indexed_at` field marks staleness) built by a separate offline script, not refreshed live — a re-implementer wanting current data needs to re-run the indexer or move to on-demand search.
- The "insert top search match" design in `insert_mkcad_part` is a foot-gun: it re-runs the search server-side and silently takes rank 1 rather than requiring the caller to pass back a specific catalog entry id, so a near-tie between two similarly-named parts (e.g. two wheel sizes) could insert the wrong one without any confirmation step.
- `MAINTAINER_NAMES` in the indexer hardcodes specific Onshape account display names to scope the "public MKCad" search — brittle if the maintaining org changes accounts/names.
- No tests, no CI, no linting config in the tree.

## Verdict
Substantive and directly relevant to the part-design/manufacturing area — a clean, small (7 source files) reference for HMAC-signed Onshape API access, an MCP tool surface over Part Studios/Assemblies/mass-properties, and a "COTS parts library search + one-shot insert" pattern worth recreating; license is unrestricted-viewing/no-license (ideas only, no code reuse) so treat everything here as a design reference, not a dependency.
