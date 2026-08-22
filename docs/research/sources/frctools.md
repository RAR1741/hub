# FRCTools — Source Survey

**Repo:** 4698RaiderRobotics/FRCTools — https://github.com/4698RaiderRobotics/FRCTools
**Surveyed-at:** 7cae5bc0eab8b449e59169f9b3676491cff8f196
**Permalink form:** https://github.com/4698RaiderRobotics/FRCTools/blob/7cae5bc0eab8b449e59169f9b3676491cff8f196/<path>
**Stack:** Python (Autodesk Fusion 360 Add-In API)
**License:** none — no LICENSE file present. All rights reserved; ideas only.
**Last activity:** 2026-01-14
**FRC team:** 4698 (Raider Robotics)
**Areas:** none of the six in-scope areas. This is a CAD design tool (part design/manufacturing *modeling* aid running inside Fusion 360), which the ground rules explicitly exclude ("CAD part libraries").

## Purpose
A Fusion 360 CAD add-in that speeds up common FRC mechanical-design sketch/solid operations: center-to-center distance objects for belts/chains/gears, bolt patterns for common FRC motors, shaft-end features (e-clip/snap-ring grooves, center holes), timing belt/chain solid generation, timing pulley shapes, tube "tubify" conversion, and lightening-pocket operations. It runs entirely inside the Fusion 360 desktop application, not as a web/team-ops tool.

## Auth & Roles
None. It's a local desktop CAD plugin with no accounts, no server, no multi-user concept.

## Data Model
None — no database, no persisted records beyond Fusion 360's own document/feature tree (custom Fusion features/sketch entities created by each command, e.g. `commands/CCDistance`, `commands/BoltPattern`).

## Features
Not applicable to survey scope — no time/attendance, rosters, integrations, communication, ordering/PO, or manufacturing-tracking features exist. For completeness, the CAD tooling itself (out of scope):
- `commands/CCDistance/` — center-to-center distance sketch tool for gears/belts/chains
- `commands/BoltPattern/` — bolt pattern generator for common FRC motors
- `commands/ShaftEndings/` — shaft end features (e-clip grooves, center holes)
- `commands/TimingBelt/`, `commands/TimingPulley/` — belt/pulley solid generation
- `commands/Tubify/` — converts solids into shelled/hole-punched tube stock
- `commands/Lighten/` — lightening pocket tool

## Integrations
None (references OnShape community tools and a sibling project, FRC-COTS, in the README, but does not integrate with them programmatically).

## Notable Implementation Details
Standard Fusion 360 Add-In structure (`FRCTools.py` entry point, `FRCTools.manifest`, per-command folders under `commands/` each with `entry.py` + icon resources). Nothing here transfers to a web/team-ops parts-ordering or tracking tool.

## Verdict
Out of scope / not relevant — this is a Fusion 360 CAD geometry-generation add-in, not a parts-ordering, PO-tracking, or team-ops tool, and the ground rules explicitly exclude CAD part-library tooling. Nothing worth stealing for the Orders/parts-ordering area. tooThin/out-of-scope.
