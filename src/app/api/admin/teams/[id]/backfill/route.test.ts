import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn(() => ({})) }));
vi.mock("@/lib/teams", () => ({ getTeam: vi.fn() }));
vi.mock("@/lib/team-slack-backfill", () => ({ backfillTeamSlack: vi.fn() }));
vi.mock("@/lib/google-directory", () => ({ directoryCredentialsFromEnv: vi.fn() }));
vi.mock("@/lib/drive-group-sync", () => ({ reconcileDriveGroups: vi.fn() }));
vi.mock("@/lib/github-app", () => ({ githubAppCredentialsFromEnv: vi.fn() }));
vi.mock("@/lib/github-team-sync", () => ({ reconcileGithubTeams: vi.fn() }));
vi.mock("@/lib/slack-alerts", () => ({ reportSyncOutcome: vi.fn() }));

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.resetModules());

const ctx = { params: Promise.resolve({ id: "team-1" }) };

const SLACK_SUMMARY = {
  effectiveActive: 3,
  withSlackCount: 2,
  withoutSlackCount: 1,
  slackConfigured: true,
  channels: [{ channelId: "C1", label: "frc", invited: 1, alreadyIn: 1, skippedNoSlack: 1, failed: 0 }],
};

function post() {
  return new Request("http://test/api/admin/teams/team-1/backfill", { method: "POST" });
}

describe("POST /api/admin/teams/[id]/backfill", () => {
  test("non-admin -> 403, no work done", async () => {
    const { getViewer } = await import("@/lib/viewer");
    const { backfillTeamSlack } = await import("@/lib/team-slack-backfill");
    vi.mocked(getViewer).mockResolvedValue({ person: { id: "s" }, role: "student" } as never);

    const { POST } = await import("./route");
    const res = await POST(post(), ctx);
    expect(res.status).toBe(403);
    expect(backfillTeamSlack).not.toHaveBeenCalled();
  });

  test("masquerading admin -> 403 masquerade_read_only", async () => {
    const { getViewer } = await import("@/lib/viewer");
    vi.mocked(getViewer).mockResolvedValue({
      person: { id: "t" },
      role: "admin",
      masquerade: { adminPersonId: "a", targetPersonId: "t", sessionId: "s1" },
    } as never);

    const { POST } = await import("./route");
    const res = await POST(post(), ctx);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "masquerade_read_only" });
  });

  test("unknown team -> 404", async () => {
    const { getViewer } = await import("@/lib/viewer");
    const { getTeam } = await import("@/lib/teams");
    vi.mocked(getViewer).mockResolvedValue({ person: { id: "a" }, role: "admin" } as never);
    vi.mocked(getTeam).mockResolvedValue(null);

    const { POST } = await import("./route");
    const res = await POST(post(), ctx);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  test("admin, no Drive/GitHub creds -> slack summary + not_configured blocks", async () => {
    const { getViewer } = await import("@/lib/viewer");
    const { getTeam } = await import("@/lib/teams");
    const { backfillTeamSlack } = await import("@/lib/team-slack-backfill");
    const { directoryCredentialsFromEnv } = await import("@/lib/google-directory");
    const { githubAppCredentialsFromEnv } = await import("@/lib/github-app");
    vi.mocked(getViewer).mockResolvedValue({ person: { id: "a" }, role: "admin" } as never);
    vi.mocked(getTeam).mockResolvedValue({ id: "team-1", name: "FRC" } as never);
    vi.mocked(backfillTeamSlack).mockResolvedValue(SLACK_SUMMARY as never);
    vi.mocked(directoryCredentialsFromEnv).mockReturnValue(null);
    vi.mocked(githubAppCredentialsFromEnv).mockReturnValue(null);

    const { POST } = await import("./route");
    const res = await POST(post(), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      slack: SLACK_SUMMARY,
      drive: { status: "not_configured" },
      github: { status: "not_configured" },
    });
    expect(backfillTeamSlack).toHaveBeenCalledWith(expect.objectContaining({ db: expect.anything() }), "team-1");
  });

  test("admin with creds -> reconcile counts summarized", async () => {
    const { getViewer } = await import("@/lib/viewer");
    const { getTeam } = await import("@/lib/teams");
    const { backfillTeamSlack } = await import("@/lib/team-slack-backfill");
    const { directoryCredentialsFromEnv } = await import("@/lib/google-directory");
    const { reconcileDriveGroups } = await import("@/lib/drive-group-sync");
    const { githubAppCredentialsFromEnv } = await import("@/lib/github-app");
    const { reconcileGithubTeams } = await import("@/lib/github-team-sync");
    vi.mocked(getViewer).mockResolvedValue({ person: { id: "a" }, role: "admin" } as never);
    vi.mocked(getTeam).mockResolvedValue({ id: "team-1", name: "FRC" } as never);
    vi.mocked(backfillTeamSlack).mockResolvedValue(SLACK_SUMMARY as never);
    vi.mocked(directoryCredentialsFromEnv).mockReturnValue({} as never);
    vi.mocked(reconcileDriveGroups).mockResolvedValue({
      ranAt: "now",
      groups: [{ added: ["a@x"], errors: [] }, { added: [], errors: ["boom"] }],
    } as never);
    vi.mocked(githubAppCredentialsFromEnv).mockReturnValue({} as never);
    vi.mocked(reconcileGithubTeams).mockResolvedValue({
      ranAt: "now",
      teams: [{ added: ["octocat"], errors: [] }],
    } as never);

    const { POST } = await import("./route");
    const res = await POST(post(), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.drive).toEqual({ status: "ok", scope: 2, added: 1, errors: 1 });
    expect(body.github).toEqual({ status: "ok", scope: 1, added: 1, errors: 0 });
  });

  test("Drive reconcile throws -> its block is error, action still 200", async () => {
    const { getViewer } = await import("@/lib/viewer");
    const { getTeam } = await import("@/lib/teams");
    const { backfillTeamSlack } = await import("@/lib/team-slack-backfill");
    const { directoryCredentialsFromEnv } = await import("@/lib/google-directory");
    const { reconcileDriveGroups } = await import("@/lib/drive-group-sync");
    const { githubAppCredentialsFromEnv } = await import("@/lib/github-app");
    vi.mocked(getViewer).mockResolvedValue({ person: { id: "a" }, role: "admin" } as never);
    vi.mocked(getTeam).mockResolvedValue({ id: "team-1", name: "FRC" } as never);
    vi.mocked(backfillTeamSlack).mockResolvedValue(SLACK_SUMMARY as never);
    vi.mocked(directoryCredentialsFromEnv).mockReturnValue({} as never);
    vi.mocked(reconcileDriveGroups).mockRejectedValue(new Error("token expired"));
    vi.mocked(githubAppCredentialsFromEnv).mockReturnValue(null);

    const { POST } = await import("./route");
    const res = await POST(post(), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.drive).toEqual({ status: "error", message: "sync_failed" });
    expect(body.ok).toBe(true);
  });
});
