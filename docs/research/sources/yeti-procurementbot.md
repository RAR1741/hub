# yeti-procurementbot — Source Survey

**Repo:** https://github.com/yeti-robotics/procurementbot (FRC 3506 YETI Robotics)
**Surveyed at commit:** `561ea01417bcb0f30a55e8fab597a47b9681b54d`
**File links:** paths below are relative to repo root; permalink form is
`https://github.com/yeti-robotics/procurementbot/blob/561ea01417bcb0f30a55e8fab597a47b9681b54d/<path>`

## Purpose

Procurementbot is described as "an all in one procurement manager for opening, updating, and closing orders, alongside ensuring the total weight of selected closed orders is within the limit," with a planned feature to accept an input CAD model and output the required parts not yet closed, checking height and weight limits if applicable (`README.md`). This targets the purchasing area of team operations (order lifecycle + a robot-weight/dimension budget check tied to CAD/BOM data) — a purchasing-tracker angle cheesy-parts and Basecamp don't take (weight-limit enforcement against FRC's per-robot weight rule).

**As surveyed, this repo contains no code whatsoever** — it is a single "Initial commit" holding only a `README.md`. There is no stack, no data model, no auth, and no features to catalog.

## Stack

Not established. The repository has exactly one file (`README.md`) and one commit (`561ea01`, "Initial commit", 2026-07-21). No `package.json`, no language files, no framework config, no `.gitignore`, no license file of any kind exist in the repo at this commit.

- **License:** none present in the repo — no `LICENSE`/`COPYING` file, no license field anywhere (there is no manifest to hold one). Per the survey method, this is flagged as "none (all rights reserved)" by default; treat as reference-only for the feature idea, not for reuse.

## Auth & Roles

Not implemented — no code exists.

## Data Model

Not implemented — no code exists. The README implies an eventual order/weight-budget model (orders with open/updated/closed states, a per-order or per-part weight, and a running total checked against a limit) plus a CAD-derived parts list, but none of this is present as schema, types, or database definitions.

## Features

None implemented. The README describes intended functionality only:

- Open, update, and close procurement orders (planned; no code).
- Track total weight of closed orders against a limit (planned; no code — this maps to FRC's robot weight-limit rule, a purchasing-side check not seen in cheesy-parts or Basecamp).
- Accept an input CAD model and output which required parts are not yet closed/ordered, with height/weight checks where applicable (planned; no code).

## Integrations

None implemented. No Discord bot framework, CAD-parsing library, or API client of any kind is present in the repo. (The name "procurementbot" and its sibling repo `yeti-robotics/basecamp` — surveyed separately — suggest this may be intended as one of the Discord bot's command surfaces that Basecamp's dashboard would eventually front, but nothing in this repo confirms that; it is inference from naming and org context, not from code.)

## Notable Implementation Details

- **Zero-code repository.** The entire working tree at this commit is `README.md`; `git log --all` shows a single commit. This is a placeholder/idea repo, not a tool that can be evaluated for design or implementation patterns.
- **Last activity:** 2026-07-21 (initial commit only) — effectively unstarted. Status: not actively developed as of this survey; revisit later if the org pushes further commits before drawing any implementation lessons from it.
- **Relation to yeti-basecamp:** same GitHub org (yeti-robotics), same creation window as `basecamp` (surveyed separately, also a bare scaffold as of its own commit). The two repos together read as an early-stage, multi-repo plan (dashboard + bot-side procurement service) rather than a single finished tool — worth tracking for the weight-limit-vs-purchasing idea, but there is nothing here yet to model FRC 1741's hub against.
