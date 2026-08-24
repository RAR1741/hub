# bc3tech/frc-discord-bot — Source Survey

**Repo:** bc3tech/frc-discord-bot — https://github.com/bc3tech/frc-discord-bot
**Surveyed-at:** 385bec40dd7f6ed149ee5ecb9a2daa677dd1f692
**Permalink form:** https://github.com/bc3tech/frc-discord-bot/blob/385bec40dd7f6ed149ee5ecb9a2daa677dd1f692/<path>
**Stack:** C# / .NET 10, Azure Functions (isolated worker) on Azure Container Apps, Azure Table Storage, Azure AI Foundry (Microsoft Agent Framework)
**License:** MIT **with an appended "No LLM Training or Referencing Clause"** in the LICENSE file itself, restated in the README. The clause states the code "is licensed for use by human developers only" and expressly prohibits "training, fine-tuning, or referencing by any machine learning model," naming RAG indexing and "prompt engineering, code synthesis, or automated code generation tools" as covered uses. That squarely covers the activity this catalog performs (an LLM reading the repo to extract and re-describe its feature set for later LLM-assisted rebuilding). Per this project's own ground rules (treat ambiguous/restrictive licenses conservatively — GPL is ideas-only, no-license is ideas-only), this rider is stricter than either: **excluded from the catalog entirely, not even ideas-only.** No source structure, file paths, or implementation details are reproduced below.
**Last activity:** 2026-04-11 (`pushed_at` 2026-05-06T14:20:27Z on repo metadata; latest commit 2026-04-11T21:37:53Z)
**FRC team:** 2046 (Bear Metal) — inferred only from the repo owner's own public README, which sets the default chat-agent identity (`DefaultTeamNumber`) to 2046 and names its Foundry agent `2046-discord-bot`
**Areas:** communication (Discord bot notifications + DM chat agent)

## Purpose
Per the repo's own public README (not the source code): a Discord bot for FRC teams that lets a Guild or user subscribe to a team/event/team-at-event for match, schedule, and award notifications, look up team/event info via slash commands, and optionally chat with an AI agent in DMs.

## Auth & Roles
Not surveyed — see license note above.

## Data Model
Not surveyed — see license note above.

## Features
Withheld per the license's anti-LLM-referencing clause. Only the following is drawn from the project's own public README (self-description, not code analysis), which is the extent of what can responsibly be cited:
- Slash-command subscriptions to a team, event, or team-at-event, delivering match/schedule/award notifications.
- `/teams` and `/events` lookup commands.
- An optional DM-based chatbot backed by Azure AI Foundry / Microsoft Agent Framework.
- Integrates with FRC Events API, The Blue Alliance, Statbotics, and FRC Colors as data sources (per README).

## Integrations
Discord (bot), FIRST/FRC Events API, The Blue Alliance, Statbotics, FRC Colors, Azure AI Foundry — per README only; not verified against source.

## Notable Implementation Details
None recorded — the license explicitly prohibits an LLM from referencing code structure or logic for this purpose.

## Verdict
Substantive, active, on-topic (communication area) repo — but its LICENSE file carries an explicit, unambiguous clause barring LLM training/referencing/RAG-indexing/code-synthesis use of the code, which is precisely what this catalog does. Treated as excluded rather than ideas-only. If the ideas here are wanted, a human should read the repo directly rather than via this pipeline.
