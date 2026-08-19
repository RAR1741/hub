<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Git workflow

- Commit at logical checkpoints during implementation, not just at the end — don't batch an
  entire feature into one commit.
- Push the branch as commits land, not only when finished.
- Branch names: a few words, hyphenated, describing the change at a high level (e.g.
  `dietary-restrictions-report`, `fix-flaky-attendance-test`).
- Every change starts in an isolated worktree — never commit directly on `master`/`main` in the
  main checkout. Any way of making one works: a native worktree tool (`claude --worktree`,
  isolation:"worktree"), `scripts/new-worktree.sh <branch-name>`, or a plain `git worktree add`.
  A git `post-checkout` hook gives every new worktree its own Docker Compose stack and Supabase
  instance on unused ports, whatever created it — see
  [dev-notes](docs/dev-notes.md#worktree-lifecycle).
- Merged worktrees clean themselves up (stack, directory, local branch) on the next `git pull` on
  master or the next session start. Nothing to do by hand; `npm run worktrees:reap` forces it.
- When a plan/implementation is complete, skip the `finishing-a-development-branch` skill's
  "which option?" menu — go straight to **push + create PR** (`gh pr create`), then report the
  URL. Test verification and base-branch confirmation from that skill still apply; the worktree is
  still kept. Only the menu prompt itself is replaced by an automatic default of Option 2.
- Discarding work still requires the user's explicit typed `discard` — that path is unchanged.
