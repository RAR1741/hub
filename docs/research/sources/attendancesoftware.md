# AttendanceSoftware (BoxerBots) — Source Survey

**Repo:** RyanAlterman/AttendanceSoftware — https://github.com/RyanAlterman/AttendanceSoftware
**Surveyed-at:** 4c1dd445b2c9759401bb969090f999aca3c2b4a8
**Permalink form:** https://github.com/RyanAlterman/AttendanceSoftware/blob/4c1dd445b2c9759401bb969090f999aca3c2b4a8/<path>
**Stack:** C++23, Qt Widgets, SQLite, CMake (CMakePresets), GoogleTest scaffolding, GitHub Actions CI
**License:** MIT — permissive, safe to reference ideas (though there is effectively no implementation to reference)
**Last activity:** 2026-08-04 (single burst of commits, repo created 2026-08-03)
**FRC team:** 1828 "BoxerBots" (per README)
**Areas:** (1) time/attendance (intended scope only — not yet built)

## Purpose
Declared intent (per README/docs) is cross-platform (Windows + Raspberry Pi) attendance tracking software for an FRC team's students and volunteers, using Qt Widgets for UI and SQLite for storage. No attendance functionality exists yet — this is a project skeleton only.

## Auth & Roles
None implemented. No code paths for login, roles, or permissions exist anywhere in the tree.

## Data Model
None implemented. `docs/database.md` is a placeholder (title only, no content). No SQLite schema, migration, or ORM/model code exists.

## Features
None. The entire `src/` tree is a CMake module skeleton:
- `src/app/main.cpp` — boots `QApplication` and shows an empty `MainWindow` (`src/ui/MainWindow/MainWindow.cpp/.hpp/.ui`), no widgets or logic beyond the default Qt Designer stub.
- `src/core/temp.cpp`, `src/database/temp.cpp`, `src/services/temp.cpp` — all empty placeholder files, present only so CMake has a source to compile per module.
- `tests/*/test_example.cpp` — GoogleTest scaffolding with example/placeholder tests, not testing any real feature.
- `docs/roadmap.md` and `docs/database.md` are empty (title line only); `docs/architecture.md` describes planned module boundaries (Application/Core/Database/UI/Services as separate DLLs) but no behavior.

## Integrations
None.

## Notable Implementation Details
The one thing worth noting for a re-implementer is the **module boundary layout**: separate CMake targets for `app` (exe), `core`, `database`, `ui`, `services` (DLLs), matching a fairly clean separation of concerns for a desktop C++/Qt attendance app, plus `.clang-format`/`.clang-tidy`/CI pipeline already wired up. That structural idea (not any code) is the only transferable artifact here.

## Verdict
Too thin — this is an empty project scaffold (CMake + Qt + SQLite skeleton, all business-logic files are literally empty `temp.cpp` placeholders) with zero attendance features implemented. Nothing concrete to steal beyond the module-separation convention. Revisit only if the repo sees substantial future activity.
