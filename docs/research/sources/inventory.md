# Student Robotics Inventory — Source Survey

**Repo:** srobo/inventory — https://github.com/srobo/inventory
**Surveyed-at:** dcaf9e0c54696b1b8c8fde618b36ab076c274baf
**Permalink form:** https://github.com/srobo/inventory/blob/dcaf9e0c54696b1b8c8fde618b36ab076c274baf/<path>
**Stack:** No application code at all — the repo *is* the database: a git tree of ~4,850 YAML files/dirs, validated in CI by an external Python CLI (`sr inv-validate` from `srobo/tools`, pinned in the workflow to a specific commit).
**License:** none found (no LICENSE file at root or elsewhere in the tree) — ideas only, no reuse of file contents/structure verbatim.
**Last activity:** 2026-03-20 (pushed_at; latest commit dcaf9e0c)
**FRC team:** N/A — this is Student Robotics (UK schools robotics competition), not FRC. Comparable youth-robotics org; treated as reference for ideas only per scope note.
**Areas:** (5) parts ordering/POs (partial — purchase-ticket references, valuation) and (6) part design/manufacturing tracking / asset & inventory tracking (primary fit). No time/attendance, rosters, integrations, or communication features present.

## Purpose
Tracks the physical location and lifecycle of every durable asset SR owns (competition kit, tools, batteries, furniture, spares) by encoding "where is this thing" as the *path* of a file in a git repository, and "what is this thing" as a small YAML front-matter block inside that file. It answers "who has this item," "what's its condition/value," and "what team/kit does it belong to" purely through directory structure + `git log`/`git blame`, with no database or UI in this repo.

## Auth & Roles
None. There is no app — write access is git push access to the GitHub repo (presumably gated by org membership/branch protection configured on GitHub, not visible in-tree). `.mailmap` normalizes committer identities for `git shortlog`/blame-style attribution but confers no permissions. `.meta/users/<name>` files (e.g. `.meta/users/Robert Spanton`) map every known git-identity string a person has ever committed under to a numeric person-ID, presumably so external tooling can dedupe "who owns what" reports across email/name changes.

## Data Model
- **Location = directory path.** Top-level directories are either a person's username (`abusse/`, `alynn/`, `ckirkham/`...), a physical site (`horsham/`, `munich/`, `southampton/`), a team (`teams/<year>/<team-slug>/`), or a lifecycle bucket (`disposed-of/`, `unknown-location/`, `untracked/`, `storage/`). Nesting further scopes location, e.g. `alynn/maximum-break/power-board-sr11.f-assy-sr2TD8/` — a specific kit ("maximum-break") owned by a person, containing an assembly.
- **Item = a file** named `<slug>-sr<ASSETCODE>` (e.g. `battery-lipo-11.1v2.2-sr1YK1B`), containing YAML:
  - `assetcode` (matches the suffix in the filename — the canonical asset tag, presumably printed on a physical label)
  - `labelled` (bool — whether the physical asset has been marked with its code yet)
  - `revision` (int — hardware/part revision)
  - `description` (free text)
  - `purchasing_ticket` (int — a Trac ticket ID from SR's now-presumably-retired Trac instance; the only PO/purchasing linkage in this repo)
  - `value` (decimal — rough valuation, e.g. for insurance/depreciation)
  - `condition` / `physical_condition` (enum: `unknown` | `working` | `broken`)
- **Assembly = a directory** with the same `<slug>-sr<ASSETCODE>` naming, containing an `info` file (same YAML shape as a leaf item, plus an `elements:` list naming its child part slugs) and one subdirectory/file per child component — i.e. assemblies are recursive: `acottrell/servo-board-sr11.f-assy-sr3T5N/` holds `info`, `servo-board-sr11.f-case-sr2JV1U` (a leaf part) and `servo-board-sr11.f-sr3U5M` (another leaf/assembly).
- **Disposal/unknown states** are modeled as top-level pseudo-locations (`disposed-of/`, `untracked/`, `unknown-location/`) rather than a status field — moving an item there is a `git mv`.
- **History = git log.** There is no `updated_at`/audit table; provenance of a condition change, a move between owners, or a disposal is entirely the commit history + `.mailmap`-normalized author identity.

## Features
Part design/manufacturing & asset tracking (area 6):
- Per-item metadata schema (asset code, revision, condition, physical condition, description, labelled flag) — every leaf part/asset file, e.g. `alynn/storage-key-sr9U1H`
- Assemblies-of-assemblies via `elements:` lists in an assembly's `info` file, letting a board (e.g. `servo-board-sr11.f`) plus its case be tracked as one asset while still being individually addressable — `acottrell/servo-board-sr11.f-assy-sr3T5N/info`
- Location tracking purely via directory placement (owner/site/team/storage/disposal), with `git mv` as the "transfer" operation — no separate move/audit log needed because git history already is one
- Lifecycle buckets as first-class locations: `disposed-of/`, `untracked/` (exists but not it its expected place), `unknown-location/` (location genuinely not known) — `disposed-of/failed-kit/`, `untracked/`
- CI-enforced schema validation on every push via GitHub Actions calling an external `sr inv-validate` CLI — `.github/workflows/validate-inventory.yml`
- Author/committer identity normalization across email/name changes for reporting — `.mailmap`, `.meta/users/<Full Name>`
- Team-scoped kit tracking by competition year — `teams/<year>/<team-slug>/`

Parts ordering/POs (area 5, thin):
- `purchasing_ticket` field linking an asset back to the (external, Trac-based) purchase request that bought it — no PO records, line items, vendors, or costs beyond a single rough `value` field live in this repo at all

## Integrations
None in-repo. The CI workflow depends on `srobo/tools` (a separate, unsurveyed repo) for the actual validation logic (`sr inv-validate`) and presumably for any query/report tooling. `purchasing_ticket` implies an external Trac deployment for purchase requests, not integrated here.

## Notable Implementation Details
- **The whole "database" is human-editable YAML files positioned by directory path** — an extremely low-tech but auditable approach: `git blame`/`git log --follow` gives free provenance, PRs give free review, and a filesystem/git checkout is a workable "browse the inventory" UI with zero infrastructure. Worth stealing as a *pattern* for a lightweight, low-write-volume asset register (e.g. tracking robot spares, loaner tools, or competition kit) where a full DB+UI is overkill and where "who changed this and when" matters more than query performance.
- **Ceiling:** this scales to thousands of items only because assets are mostly static and updates are infrequent/asynchronous (a mentor edits a YAML file and commits). It has no concurrency story, no validation beyond CI-on-push (so a bad edit merges before it's caught unless CI blocks the PR), and no query interface — "what's the total value of team 2020's kit" requires cloning the repo and scripting a directory walk. Not suitable for anything with frequent read/write from many simultaneous users or that needs live reporting.
- Asset codes (`sr<CODE>`) are short alphanumeric human-writable tags meant to be physically printed/labelled on hardware (`labelled: true/false` tracks whether that's been done yet) — a decent idea if hub ever needs physical asset tagging for loaner equipment.
- No LICENSE means even this data-modeling *pattern* should be treated as inspiration only, not a template to copy structurally verbatim.

## Verdict
Marginal for hub's actual feature areas: it has no time/attendance, roster, comms, or integration code at all, and its parts-ordering surface is a single `purchasing_ticket` int. The one thing worth taking is the underlying idea — a git-tracked, YAML-per-item, directory-as-location asset register with CI-validated schema — as a cheap pattern for a lightweight physical-asset/condition tracker, not as source to copy (no license, and it's data, not code, anyway).
