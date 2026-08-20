#!/usr/bin/env bash
# End-to-end check of the worktree lifecycle, run against a throwaway repo in
# $TMPDIR — never against your real checkout, and never touching Docker.
#
#   scripts/test-worktree-lifecycle.sh
#
# Covers what previous attempts at this got wrong:
#   - a plain `git worktree add` (no agent involved) gets an isolated stack
#   - worktrees get distinct port offsets, including ones outside the repo tree
#   - the main checkout's .env secrets are inherited, its ports are not
#   - setup is idempotent and does not re-enter itself through its own hook
#   - the LAST worktree in `git worktree list` is reaped (the read-drops-the-
#     final-line bug that made cleanup miss the worktree you just finished)
#   - a SQUASH-merged branch is reaped (invisible to the ancestor test)
#   - a brand-new branch with no commits is NEVER reaped, even though it is
#     technically an ancestor of master
#   - unmerged and dirty worktrees are left alone
#   - the deferred-removal queue drains instead of growing forever
set -uo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/hub-wt-test-XXXXXX")"
export REAP_SKIP_DOCKER=1 WORKTREE_SKIP_UP=1
PASS=0
FAIL=0

ok()   { PASS=$((PASS + 1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "  FAIL - $1"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (want '$3', got '$2')"; fi; }
yes_()  { if [ "$1" = 0 ]; then ok "$2"; else bad "$2"; fi; }
no_()   { if [ "$1" = 0 ]; then bad "$2"; else ok "$2"; fi; }
reap() { ( cd "$REPO" && env "$@" bash scripts/reap-worktrees.sh 2>&1 | sed 's/^/    /' ); }
cleanup() { rm -rf "$TMP" 2>/dev/null || true; }
trap cleanup EXIT

echo "workspace: $TMP"

# --- a repo that looks enough like hub for the lifecycle to run --------------
REPO="$TMP/main"
mkdir -p "$REPO/scripts/lib" "$REPO/supabase"
cp "$SRC/scripts/lib/worktree-setup.sh" "$REPO/scripts/lib/"
for s in worktree-init.sh reap-worktrees.sh install-git-hooks.sh new-worktree.sh; do
  cp "$SRC/scripts/$s" "$REPO/scripts/"
done
cat >"$REPO/supabase/config.toml" <<'TOML'
project_id = "hub"
[api]
port = 54321
[db]
port = 54322
shadow_port = 54320
[db.pooler]
port = 54329
[studio]
port = 54323
[inbucket]
port = 54324
[analytics]
port = 54327
[auth]
site_url = "http://localhost:3000"
additional_redirect_urls = ["http://localhost:3000/auth/callback"]
[auth.external.google]
redirect_uri = "http://127.0.0.1:54321/auth/v1/callback"
[edge_runtime]
inspector_port = 8083
TOML
# Same as the real repo: env files are never committed, so a fresh worktree has
# none until setup writes them.
printf '.env*\n' >"$REPO/.gitignore"

git -C "$REPO" init -q -b master
git -C "$REPO" config user.email test@example.com
git -C "$REPO" config user.name test
git -C "$REPO" add -A
git -C "$REPO" commit -qm init

cat >"$REPO/.env" <<'ENV'
GOOGLE_OAUTH_CLIENT_SECRET=super-secret-from-main
APP_PORT=3000
ENV
cat >"$REPO/.env.local" <<'ENV'
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_INTERNAL_URL=http://host.docker.internal:54321
STUDENT_SESSION_SECRET=main-checkout-secret
ENV

# A gh that reports feature-a as merged in PR #1 and everything else as not
# merged, so the primary (GitHub) oracle can be exercised offline.
mkdir -p "$TMP/bin"
cat >"$TMP/bin/gh" <<'STUB'
#!/bin/sh
case "$*" in
  *"--head feature-a"*) echo 1 ;;
esac
exit 0
STUB
chmod +x "$TMP/bin/gh"

# Commit a real change on a branch, from inside its worktree. Each branch gets
# its own file so merging several of them into master never conflicts.
work() {
  local dir="$1" name="$2"
  echo "$name work" >"$dir/$name.txt"
  git -C "$dir" add "$name.txt"
  git -C "$dir" commit -qm "$name work"
}

echo
echo "install-git-hooks"
( cd "$REPO" && bash scripts/install-git-hooks.sh >/dev/null )
grep -q 'hub-worktree-hooks-start' "$REPO/.git/hooks/post-checkout"; yes_ $? "post-checkout block installed"
grep -q 'reap-worktrees.sh' "$REPO/.git/hooks/post-merge"; yes_ $? "post-merge block installed"
( cd "$REPO" && bash scripts/install-git-hooks.sh >/dev/null )
check "install is idempotent" "$(grep -c 'hub-worktree-hooks-start' "$REPO/.git/hooks/post-checkout")" "1"
printf '\necho other-tool\n' >>"$REPO/.git/hooks/post-checkout"
( cd "$REPO" && bash scripts/install-git-hooks.sh >/dev/null )
grep -q 'other-tool' "$REPO/.git/hooks/post-checkout"; yes_ $? "hooks from other tools preserved"

echo
echo "plain 'git worktree add' — no agent, no helper script"
git -C "$REPO" worktree add -q "$TMP/wt-a" -b feature-a 2>/dev/null
[ -f "$TMP/wt-a/.env" ]; yes_ $? "post-checkout hook wrote .env"
check "first worktree takes offset 1" "$(sed -n 's/^WORKTREE_OFFSET=//p' "$TMP/wt-a/.env")" "1"
check "app port offset applied" "$(sed -n 's/^APP_PORT=//p' "$TMP/wt-a/.env" | tail -1)" "3001"
check "compose project name" "$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' "$TMP/wt-a/.env")" "hub-wt-a"
grep -q '^GOOGLE_OAUTH_CLIENT_SECRET=super-secret-from-main$' "$TMP/wt-a/.env"
yes_ $? "main .env secrets inherited"
check "main APP_PORT not inherited" "$(grep -c '^APP_PORT=3000$' "$TMP/wt-a/.env")" "0"
check "config.toml api port rewritten" "$(sed -n 's/^port = //p' "$TMP/wt-a/supabase/config.toml" | head -1)" "54331"
grep -q '^site_url = "http://localhost:3001"$' "$TMP/wt-a/supabase/config.toml"
yes_ $? "config.toml site_url rewritten"
grep -q '127.0.0.1:54331' "$TMP/wt-a/.env.local"; yes_ $? ".env.local repointed at this worktree"
grep -q 'STUDENT_SESSION_SECRET=main-checkout-secret' "$TMP/wt-a/.env.local"
no_ $? "session secret regenerated, not shared"

echo
echo "second worktree, created outside the repo tree"
git -C "$REPO" worktree add -q "$TMP/elsewhere/wt-b" -b feature-b 2>/dev/null
check "second worktree takes offset 2" "$(sed -n 's/^WORKTREE_OFFSET=//p' "$TMP/elsewhere/wt-b/.env")" "2"
check "no port collision" "$(sed -n 's/^APP_PORT=//p' "$TMP/elsewhere/wt-b/.env" | tail -1)" "3002"

echo
echo "idempotence"
BEFORE="$(cat "$TMP/wt-a/.env")"
( cd "$TMP/wt-a" && bash scripts/worktree-init.sh >/dev/null 2>&1 )
check "re-init leaves .env untouched" "$(cat "$TMP/wt-a/.env")" "$BEFORE"
check "re-init created no extra worktree" "$(git -C "$REPO" worktree list | wc -l | tr -d ' ')" "3"

echo
echo "reap: unmerged worktrees survive"
work "$TMP/wt-a" "feature-a"
work "$TMP/elsewhere/wt-b" "feature-b"
reap
[ -d "$TMP/wt-a" ]; yes_ $? "unmerged feature-a kept"
[ -d "$TMP/elsewhere/wt-b" ]; yes_ $? "unmerged feature-b kept"

echo
echo "reap: squash-merged branch, via the GitHub oracle"
git -C "$REPO" merge -q --squash feature-a
git -C "$REPO" commit -qm "feat: squashed feature-a (#1)"
git -C "$REPO" merge-base --is-ancestor feature-a master 2>/dev/null
no_ $? "fixture: squashed branch is NOT an ancestor of master"
reap PATH="$TMP/bin:$PATH"
[ -d "$TMP/wt-a" ]; no_ $? "squash-merged worktree removed"
git -C "$REPO" rev-parse --verify feature-a >/dev/null 2>&1
no_ $? "squash-merged local branch deleted"

echo
echo "reap: merge-committed branch, last in the worktree list, offline oracle"
git -C "$REPO" merge -q --no-ff -m "Merge branch feature-b" feature-b
LAST="$(git -C "$REPO" worktree list --porcelain | sed -n 's/^worktree //p' | tail -1)"
check "wt-b is last in the worktree list" "$(basename "$LAST")" "wt-b"
reap
[ -d "$TMP/elsewhere/wt-b" ]; no_ $? "merged worktree removed"
git -C "$REPO" rev-parse --verify feature-b >/dev/null 2>&1
no_ $? "merged local branch deleted"

echo
echo "reap: uncommitted work is never force-removed"
git -C "$REPO" worktree add -q "$TMP/wt-c" -b feature-c 2>/dev/null
work "$TMP/wt-c" "feature-c"
git -C "$REPO" merge -q --no-ff -m "Merge branch feature-c" feature-c
echo "unstaged edit" >>"$TMP/wt-c/feature-c.txt"
reap
[ -d "$TMP/wt-c" ]; yes_ $? "dirty worktree left in place"

echo
echo "reap: brand-new worktree is never reaped (no commits yet)"
git -C "$REPO" worktree add -q "$TMP/wt-fresh" -b feature-fresh 2>/dev/null
echo "master moves on" >"$REPO/master.txt"
git -C "$REPO" add master.txt && git -C "$REPO" commit -qm "master advances"
git -C "$REPO" merge-base --is-ancestor feature-fresh master 2>/dev/null
yes_ $? "fixture: fresh branch IS an ancestor of master"
reap
[ -d "$TMP/wt-fresh" ]; yes_ $? "fresh worktree survived the sweep"

echo
echo "queue: drains instead of growing"
QUEUE="$REPO/.git/worktree-cleanup-queue"
printf '%s\t%s\n' "$TMP/gone-1" "dead-branch-1" >"$QUEUE"
printf '%s\t%s\n' "$TMP/gone-1" "dead-branch-1" >>"$QUEUE"
printf '%s\t%s' "$TMP/gone-2" "dead-branch-2" >>"$QUEUE"   # no trailing newline
reap >/dev/null
[ -f "$QUEUE" ]; no_ $? "queue drained, stale entries dropped"

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
