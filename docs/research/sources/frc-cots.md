# FRC-COTS — Source Survey

**Repo:** hammerheads5000/FRC-COTS — https://github.com/hammerheads5000/FRC-COTS
**Surveyed-at:** de5a5e41c131e3a8b6db49f9b15ef5cab9228eb2 (get via: gh api repos/hammerheads5000/FRC-COTS/commits --jq '.[0].sha')
**Permalink form:** https://github.com/hammerheads5000/FRC-COTS/blob/de5a5e41c131e3a8b6db49f9b15ef5cab9228eb2/<path>
**Stack:** Python (Fusion 360 API add-in), HTML/JS palette UI (`frc_cots_palette.html`), no database/backend
**License:** MIT — reusable directly, no ideas-only restriction
**Last activity:** 2026-01-09
**FRC team:** Team 5000 — The Hammerheads (Hingham High School)
**Areas:** none of the six in-scope areas — this is a CAD tool

## Purpose
A Fusion 360 add-in that lets a team browse a cloud-hosted library of commercial-off-the-shelf (COTS) `.f3d` CAD parts (motors, bearings, gearboxes, spacers) and insert them into an active design with one click, auto-creating an aligned rigid joint.

## Auth & Roles
None — runs entirely inside a user's local Fusion 360 desktop session, scoped to whatever Autodesk cloud project ("FRC_COTS") that user already has access to.

## Data Model
None — no persistent database. State is Fusion 360 document/API objects (occurrences, joints, joint origins) plus local add-in settings (favorites, theme) presumably stored via Fusion's own preference storage. Part catalog is just a folder tree of `.f3d` files in a cloud project, not a modeled schema.

## Features
Out of scope for this catalog (excluded category: "CAD part libraries" / CAD tooling), so features are not indexed. For reference, the add-in provides: folder navigation/search/favorites over a COTS part library (`commands/insertPart/entry.py`), one-click part insertion with automatic rigid-joint alignment to circular edges/cylindrical faces/planar faces/joint origins, and a "dynamic spacer" system (`commands/makeSpacer/entry.py`, `commands/insertSpacer/entry.py`, `spacers/*.f3d`) for parametrically-lengthed spacers/shafts.

## Integrations
Autodesk Fusion 360 API only (local desktop app + user's Autodesk cloud project storage). No Slack/Discord/Onshape/TBA/email integration.

## Notable Implementation Details
N/A — out of scope, not analyzed further.

## Verdict
Thin/out-of-scope for this catalog: it's a Fusion 360 CAD add-in for inserting COTS part models into assemblies (excluded "CAD part libraries" category), not a part-design/manufacturing *tracking* system (no build-status, ordering, or fabrication-progress data model). Nothing here to steal for the six in-scope areas; recorded only to close out the long-tail entry.
