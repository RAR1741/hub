# CadSense — Source Survey

**Repo:** AadiJo/cadsense — https://github.com/AadiJo/cadsense
**Surveyed-at:** e65516921a5843c3c5413f71fd585fa846c45bd7
**Permalink form:** https://github.com/AadiJo/cadsense/blob/e65516921a5843c3c5413f71fd585fa846c45bd7/<path>
**Stack:** TypeScript monorepo (Turborepo/pnpm workspaces), Effect (effect/Effect, effect Schema contracts) for the server, Node WebSocket server + SQLite persistence, React/Vite web client (shadcn/ui components), Electron desktop shell, Astro marketing site. CI via GitHub Actions, oxlint/oxfmt for lint/format.
**License:** MIT (LICENSE file present, "Copyright (c) 2026 CadSense Tools Inc.") — safe to recreate ideas and even close-paraphrase small snippets with attribution norms; still treat as "ideas, not copy" per project convention.
**Last activity:** 2026-08-10 (pushed_at; latest commit same date)
**FRC team:** unknown (author "AadiJo" — a JOhari-dev.com branded product, not an obviously specific team's internal tool; reads as a general product aimed at FRC teams broadly, with a hosted "mechbase" API at api-frcrag-v2.johari-dev.com)
**Areas:** (3) third-party integrations (Onshape, GitHub/GitLab/Bitbucket/Azure DevOps), (6) part design/manufacturing tracking (AI-assisted CAD design review against Onshape models)

## Purpose

CadSense is primarily a general-purpose local-first desktop/web GUI for driving coding agents (Codex, Claude Code, Cursor, OpenCode) against a project — threads, diffs, terminals, source control. Bolted onto that core is an explicitly-labeled "CAD-aware experiment": an Onshape-connected CAD viewer plus a multi-persona AI design-review pipeline that critiques a synced CAD assembly against FRC-specific concerns (integration, schedule/ROI, mechanical robustness) and a hosted "Mechbase" search API (`api-frcrag-v2.johari-dev.com`) that appears to be a retrieval index over historical FRC team designs/documentation, exposed to the agent as an MCP tool. For this survey's scope, only the CAD-review + Onshape + Mechbase slice is relevant; the coding-agent-workbench core (provider adapters, chat, terminals) is out of scope.

## Auth & Roles

- No end-user role model (single local/desktop user per project). Auth layer (`apps/server/src/auth/`) is about pairing a web/mobile client to the local server (pairing links, sessions, bootstrap credentials) and about secret storage for API keys, not multi-user permissions.
- Secrets (Onshape API keys, Mechbase API key) are stored via `ServerSecretStore` (`apps/server/src/auth/Layers/ServerSecretStore.ts`) rather than plaintext config.
- Mechbase API key validation is cached for 5 minutes (`MECHBASE_API_KEY_VALIDATION_CACHE_TTL_MS` in `apps/server/src/mechbase/MechbaseConnection.ts`) to avoid re-hitting the remote validation endpoint on every tool call.

## Data Model

Server persistence is SQLite with a hand-rolled, numbered migration chain (`apps/server/src/persistence/Migrations/001…035_*.ts`) — no ORM. Relevant tables/migrations for this survey's scope:
- `031_OnshapeWorkspaceIndex.ts` — an index of synced Onshape documents/parts per project (`apps/server/src/persistence/Layers/OnshapeIndex.ts` / `Services/OnshapeIndex.ts`).
- `033_ProjectionThreadReviews.ts` and `034_CadReviewRunClaims.ts` — persisted CAD review runs tied to a chat "thread," with claim rows so only one worker processes a given review request (`ProjectionThreadReviews.ts`, `CadReviewRunClaims`).
- `035_ProjectionThreadRelationships.ts` — thread graph relationships (e.g. a review thread linked back to its source thread).
- General orchestration event-sourcing store (`OrchestrationEventStore`) + projections (threads, messages, activities, proposed plans) that the CAD review pipeline rides on top of as just another kind of thread event (`thread.review-requested`, `thread.review-stop-requested`).

## Features

### Part design / manufacturing tracking (area 6)
- **Onshape model sync into the workspace** — `OnshapeSyncControl` (`apps/web/src/components/OnshapeSyncControl.tsx`) triggers a download of the current Onshape document into the local project folder, shows "Synced Xm ago" / "Sync failed" / "Never synced" status and the saved relative path.
- **Onshape → OBJ/glTF translation** for in-app 3D viewing — `apps/server/src/onshape/onshapeObjBundle.ts`, probed by `apps/server/scripts/onshape-gltf-translation-probe.ts`.
- **In-browser CAD viewer** with camera/view control protocol — `apps/web/src/lib/cadView.ts`, `cadViewerCameraTransition.ts`, `cadViewerFrameProtocol.ts`, `cadViewerWebGl.ts`, and a fast custom 3MF parser run in a web worker (`cadThreeMfFastParser.worker.ts`, `cadThreeMfOutline.worker.ts`) with explicit resource limits (`cadThreeMfResourceLimits.ts`) to keep large assemblies from hanging the tab.
- **Agent-driven CAD camera/hierarchy control** — the AI agent can issue view commands (set camera, explode view, browse assembly hierarchy) that are relayed server→browser over a pub/sub channel with request leasing so only one in-flight command per browser session wins (`apps/server/src/cad/CadViewCommands.ts`, `CadRequestLease.ts`).
- **Agent-requested screenshot capture of the live CAD viewport** — the agent asks for a screenshot, server publishes a request to the browser, browser renders and returns image bytes (25MB cap) with a 120s timeout (`apps/server/src/cad/CadScreenshotCapture.ts`, `CadScreenshotClient.ts`).
- **Multi-persona AI CAD design review** — three independent reviewer "personas" run over the model/screenshots: `systems_integration` (packaging/manufacturability/serviceability), `program_readiness` (schedule/ROI/scope realism), `mechanical_robustness` (load paths, flex, jamming, fatigue), each with a long structured prompt (`apps/server/src/orchestration/Layers/CadReviewPrompts.ts`), then a `synthesis` pass merges overlapping findings into prioritized action items while preserving disagreement between personas.
- **Review lifecycle as first-class orchestration events** — `thread.review-requested` / `thread.review-stop-requested`, with interrupted-review recovery on server restart (`CadReviewService.recoverInterruptedReviews`, `apps/server/src/orchestration/Services/CadReviewService.ts`, `Layers/CadReviewReactor.ts`).
- **Review findings/evidence data model** — typed `CadReviewFinding`, `CadReviewEvidenceArtifact`, `CadReviewMechanismPlan`, `CadReviewPersonaReport` contracts (`packages/contracts`, referenced from `CadReviewPrompts.ts`) tying each finding to supporting screenshots/artifacts.
- **Review UI surfaces** — `apps/web/src/components/CadPanel.tsx` / `CadPanel.logic.ts` (main CAD panel), `CadReviewAgentControlHost.tsx` (agent control surface during a review run), thread visibility rules for review threads (`apps/web/src/cadReviewThreadVisibility.ts`), and review status derivation (`apps/web/src/lib/cadReviewStatus.ts`).

### Third-party integrations (area 3)
- **Onshape** — connection setup/listing, document import by URL, index refresh, and full-text search over the synced index (`OnshapeWorkspaceShape`: `listConnections`, `setupConnection`, `removeConnection`, `importUrl`, `refreshIndex`, `searchIndex`, `syncProject` — `apps/server/src/onshape/Services/OnshapeWorkspace.ts`).
- **Mechbase (hosted FRC design-reference search API)** — `search_mechbase` and `fetch_mechbase_artifact` exposed as MCP tools to the coding agent (`apps/server/src/mechbase/MechbaseMcp.ts`), backed by a hosted REST API at `api-frcrag-v2.johari-dev.com` (`apps/server/src/mechbase/MechbaseApi.ts`) supporting query + top_k + team/year/source filters and modality filter (`text` | `page_image` | `extracted_image`), plus JPEG2000 image decoding (`jpeg2000` package + `sharp`) for archival page scans.
- **Source control providers** — GitHub, GitLab, Bitbucket, and Azure DevOps, each with a CLI-backed driver + REST API client + PR/MR listing (`apps/server/src/sourceControl/{GitHub,GitLab,Bitbucket,AzureDevOps}*.ts`), auto-discovered per project (`SourceControlDiscovery.ts`, `SourceControlProviderRegistry.ts`).
- **Multiple AI coding-agent providers** wired in as pluggable adapters: Claude (Code), Codex, Cursor (via ACP), OpenCode (`apps/server/src/provider/Drivers/*`, `Layers/*Adapter.ts`) — out of scope for the six team-ops areas but explains the app's core value proposition.
- **Tailscale / SSH** helper packages (`packages/tailscale`, `packages/ssh`) for remote dev-box access — general dev tooling, not team-ops.

## Integrations

Onshape (CAD sync/search), a proprietary hosted "Mechbase" FRC-design-reference search API, GitHub/GitLab/Bitbucket/Azure DevOps (source control), Claude/Codex/Cursor/OpenCode (AI coding agents). No Slack/Discord/email/SMS/calendar integration found.

## Notable Implementation Details

- The whole server is built on `effect` (Effect-TS) with a strict Layers/Services split per module (e.g. `onshape/Layers/OnshapeWorkspace.ts` implements, `onshape/Services/OnshapeWorkspace.ts` declares the `Context.Service` interface) — a heavier architecture than most surveyed repos; a re-implementer targeting a simpler stack would just want the *shape* of the OnshapeWorkspace interface (list/setup/remove connection, import by URL, refresh index, search index, sync project) rather than the Effect plumbing.
- CAD review is modeled as ordinary orchestration events on a thread (not a bespoke review subsystem), meaning review runs get the same persistence, resumability-on-crash, and event-sourced audit trail as chat threads — a reusable pattern: "treat a long AI job as thread activity" rather than inventing a separate job table.
- The persona-prompt design (three adversarial-but-complementary review lenses + a synthesis pass that explicitly "preserves disagreement") is a genuinely reusable idea for any AI design-review feature — avoids a single-model review flattening real trade-offs into one voice.
- Screenshot/view-command requests use a lease mechanism (`CadRequestLease.ts`) so concurrent agent requests to the browser's live 3D view don't race each other — worth mirroring if building a similar "agent controls a live viewport" feature.
- The custom 3MF parser deliberately caps resource usage (`cadThreeMfResourceLimits.ts`) — a concrete scale gotcha: full/CAD-derived 3MF assemblies can be large enough to need worker-thread parsing with hard byte/geometry limits, not naive main-thread parsing.
- Mechbase is a paid/hosted third-party dependency (own API key, own domain) — not something to integrate as-is, but its query shape (semantic search with team/year/source filters and page-image vs. text vs. extracted-image modality) is a good reference schema for a "historical designs & pit-notebook search" feature.

## Verdict

Substantive for its CAD-review slice: a working, well-structured AI-multi-persona-review pipeline over Onshape-synced CAD with agent-driven viewport control and screenshot capture is a strong reference design for area 6. The rest of the repo (coding-agent workbench, provider adapters, terminals) is out of scope and should be ignored. MIT-licensed — safe to draw on for architecture/prompt ideas, recreate rather than copy.
