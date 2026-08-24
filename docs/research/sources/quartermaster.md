# Quartermaster — Source Survey

**Repo:** AmrinS49/quartermaster — https://github.com/AmrinS49/quartermaster
**Surveyed-at:** b442788a63ce60b72d4ba461c8458eb5d360363b
**Permalink form:** https://github.com/AmrinS49/quartermaster/blob/b442788a63ce60b72d4ba461c8458eb5d360363b/<path>
**Stack:** .NET Core 7 + Entity Framework Core (C#) backend, PostgreSQL (prod) / SQLite (dev) via Npgsql, React + Vite + TypeScript frontend (Bootstrap for styling; README also names Redux Toolkit and Axios as planned but neither appears in the code yet)
**License:** GPL-3.0 (LICENSE file present) — copyleft, ideas only, do not copy code
**Last activity:** 2023-12-18 (last push); repo inactive since
**FRC team:** unknown — author is an individual GitHub user (AmrinS49), no team number found in README or code
**Areas:** purchasing (parts/inventory ordering), design-manufacturing (part cataloging)

## Purpose

Quartermaster aims to be a general-purpose, reusable (not single-team) open-source inventory
management system for FRC teams, explicitly targeting the common pain point of teams using ad-hoc
spreadsheets for parts tracking. The stated goals (per README) are: scale from simple to detailed
use, be usable by both novices and power users, ship built-in configurations for common FRC parts
(bearings, gears, etc.), track non-uniform stock (aluminum/polycarbonate), surface low-stock and
frequently-used-item insights, and be easy to self-host. As surveyed, the project is a very early
MVP: only a read-only items API and a static, non-interactive category-browsing UI exist.

## Auth & Roles

None. No authentication middleware, user model, login, or authorization checks anywhere in the
codebase. `API/Program.cs` calls `app.UseAuthorization()` but no `UseAuthentication()` and no
scheme/policies are registered, so this is a no-op placeholder. There is no user/role table in
the EF model.

## Data Model

Single-table-inheritance-style item hierarchy via EF Core:

- **`Item`** (abstract base, `Domain/Item.cs`) — `Sku` (string, primary key), `SkuAlias` (string,
  optional — for a vendor's differently-SKU'd equivalent part), `Name`, `Quantity` (int), `Type`
  (string discriminator-like field, e.g. "Bearing"/"Gear"), `Vendor`, `Link` (vendor product URL),
  `Material`.
- **`Bearing`** (`Domain/Bearing.cs`) extends `Item` — adds `Flange` (bool), `Metric` (bool),
  `OuterDiameter`/`InnerDiameter`/`Width` (double), `BoreType` (string, e.g. "Hex"/"Round"). Mapped
  to its own `Bearings` table (`[Table("Bearings")]`).
- **`CustomItem`** (`Domain/CustomItem.cs`) extends `Item` — adds only `Custom` (bool); intended
  for team-fabricated/one-off parts (e.g. a custom-cut gear) distinct from catalog COTS parts.
  Mapped to `CustomItems` table.

`DataContext` (`Persistence/DataContext.cs`) exposes `DbSet<Item> Items`,
`DbSet<Bearing> Bearings`, `DbSet<CustomItem> CustomItems` — EF's TPH/TPT inheritance mapping
(concrete subclasses get their own tables per the `[Table]` attributes, i.e. table-per-type). One
EF Core migration exists (`Persistence/Migrations/20231218033904_InitialCreate.cs`), and
`Persistence/Seed.cs` seeds 4 bearings + 1 custom gear as demo data (auto-run on startup if the
`Items` table is empty).

## Features

**Purchasing / parts inventory (area: purchasing, design-manufacturing):**
- Typed part catalog schema distinguishing COTS parts (with vendor, purchase link, SKU/SKU-alias
  for cross-vendor equivalents) from custom/fabricated parts — `Domain/Item.cs`,
  `Domain/CustomItem.cs`, `Domain/Bearing.cs`.
- Per-part-type schema extension pattern demonstrated via `Bearing` (dimensional attributes:
  bore type, flange, metric/imperial, OD/ID/width) — intended to be repeated for other FRC
  component categories (the README lists bolts, rivets, motors, sensors as planned categories,
  matching the frontend's hardcoded `CategoryList`).
- Quantity-on-hand tracking per SKU (`Item.Quantity`) — the seed data includes a zero-quantity
  item (`WCP-0780`, Quantity: 0), suggesting low-stock/out-of-stock is meant to be surfaced, though
  no such UI or query exists yet.
- Read-only REST API: `GET /api/items` (list all) and `GET /api/items/{sku}` (lookup by SKU) —
  `API/Controllers/ItemsController.cs`. No create/update/delete endpoints exist yet — the API
  cannot record purchases, adjust stock, or add new catalog items.
- Category browsing UI shell: a static, hardcoded 6-category grid (Bearings, Bolts, Rivets,
  Motors, Control System, Sensors) rendered as clickable-looking cards with no click handlers or
  routing wired up — `client-app/src/features/categories/components/CategoryList.tsx`,
  `CategoryItem.tsx`. Not connected to the backend API at all (no fetch/axios calls anywhere in
  the client).

## Integrations

None. No vendor API integrations (e.g., WCP, AndyMark, McMaster), no Onshape/CAD linkage beyond a
free-text `Link` URL field, no notification/chat integration, no auth provider.

## Notable Implementation Details

- SKU-alias field (`Item.SkuAlias`) is a reasonable idea for reconciling the same physical part
  sold under different vendor SKUs (e.g. WCP repackaging a generic bearing) — worth considering
  for any future catalog schema.
- `API/Program.cs` reads DB connection info from raw environment variables
  (`DB_HOST`/`DB_PORT`/`DB_DATABASE`/`DB_USERNAME`/`DB_PASSWORD`) with an explicit `// TODO: Add
  safety if any of these are null` — no null-checking is actually implemented, so a missing env
  var would produce a malformed connection string rather than a clear startup error.
  `app.UseCors` is hardcoded to `http://localhost:3000` only, meaning the CORS policy would need
  editing per deployment.
- The EF Core inheritance design (abstract `Item` base + concrete subclasses per part category,
  each with its own table) is a workable schema pattern for a "generic item + category-specific
  attributes" catalog, but as implemented here it requires a new C# class + migration for every
  new part type — this doesn't scale well to "hundreds of ad hoc part types" without either a
  more generic attributes-as-JSON/EAV approach or code generation.
- The frontend category list is entirely disconnected from the backend: the categories shown
  (Bearings, Bolts, Rivets, Motors, Control System, Sensors) don't match what the backend actually
  models (only `Bearing` and generic `CustomItem` exist server-side), confirming this is UI
  scaffolding built ahead of the data layer.
- No tests of any kind (no test project in the solution).

## Verdict

Thin — an abandoned very-early MVP (read-only API, non-interactive frontend, no auth, no
create/update/delete, last touched Dec 2023) — but the `Item`/`SkuAlias`/`Type`+category-specific
subclass schema idea (COTS-vs-custom part distinction, cross-vendor SKU aliasing) is a small,
concrete, worth-stealing idea for a purchasing/parts-catalog data model even though GPL-3.0 means
only the idea, not the code, can be reused.
