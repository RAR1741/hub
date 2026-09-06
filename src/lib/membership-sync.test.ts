import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("./drive-group-sync", () => ({ syncMembershipChange: vi.fn() }));
vi.mock("./github-team-sync", () => ({ syncGithubMembershipChange: vi.fn() }));
vi.mock("./slack-channel-sync", () => ({ syncSlackMembershipChange: vi.fn() }));

import { syncMembershipChange as drive } from "./drive-group-sync";
import { syncGithubMembershipChange as github } from "./github-team-sync";
import { syncSlackMembershipChange as slack } from "./slack-channel-sync";
import { syncMembershipChange } from "./membership-sync";

const mockDrive = vi.mocked(drive);
const mockGithub = vi.mocked(github);
const mockSlack = vi.mocked(slack);

// t3 -> t2 -> t1 (t3's parent is t2, t2's parent is t1, t1 is the root)
const TREE_ROWS = [
  { id: "t1", parent_team_id: null },
  { id: "t2", parent_team_id: "t1" },
  { id: "t3", parent_team_id: "t2" },
];

function fakeDb(opts: {
  treeError?: boolean;
  membershipRows?: { team_id: string }[];
  membershipError?: boolean;
}) {
  return {
    from: (table: string) => {
      if (table === "team") {
        return {
          select: async () =>
            opts.treeError ? { data: null, error: { code: "500" } } : { data: TREE_ROWS, error: null },
        };
      }
      if (table === "team_membership") {
        return {
          select: () => ({
            in: () => ({
              eq: async () =>
                opts.membershipError
                  ? { data: null, error: { code: "500" } }
                  : { data: opts.membershipRows ?? [], error: null },
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

beforeEach(() => {
  mockDrive.mockReset();
  mockGithub.mockReset();
  mockSlack.mockReset();
});

describe("syncMembershipChange add", () => {
  test("calls each sub-sync with the team then its ancestors, nearest first", async () => {
    await syncMembershipChange("add", "t3", "p1", fakeDb({}));

    for (const mock of [mockDrive, mockGithub, mockSlack]) {
      expect(mock).toHaveBeenCalledTimes(3);
      expect(mock.mock.calls.map((c) => c[1])).toEqual(["t3", "t2", "t1"]);
    }
  });

  test("falls back to the direct team only when the tree read fails", async () => {
    await syncMembershipChange("add", "t3", "p1", fakeDb({ treeError: true }));

    for (const mock of [mockDrive, mockGithub, mockSlack]) {
      expect(mock).toHaveBeenCalledTimes(1);
      expect(mock).toHaveBeenCalledWith("add", "t3", "p1", expect.anything());
    }
  });
});

describe("syncMembershipChange remove", () => {
  test("fans out to the direct team when no subtree row survives", async () => {
    await syncMembershipChange("remove", "t3", "p1", fakeDb({ membershipRows: [] }));

    for (const mock of [mockDrive, mockGithub, mockSlack]) {
      expect(mock).toHaveBeenCalledTimes(1);
      expect(mock).toHaveBeenCalledWith("remove", "t3", "p1", expect.anything());
    }
  });

  test("skips removal when the person is still effective via a surviving subtree row", async () => {
    // Removing from t1 (the root) while a membership row on descendant t3 survives.
    await syncMembershipChange("remove", "t1", "p1", fakeDb({ membershipRows: [{ team_id: "t3" }] }));

    expect(mockDrive).not.toHaveBeenCalled();
    expect(mockGithub).not.toHaveBeenCalled();
    expect(mockSlack).not.toHaveBeenCalled();
  });

  test("skips removal when the membership read fails", async () => {
    await syncMembershipChange("remove", "t3", "p1", fakeDb({ membershipError: true }));

    expect(mockDrive).not.toHaveBeenCalled();
    expect(mockGithub).not.toHaveBeenCalled();
    expect(mockSlack).not.toHaveBeenCalled();
  });

  test("skips removal when the tree read fails", async () => {
    await syncMembershipChange("remove", "t3", "p1", fakeDb({ treeError: true }));

    expect(mockDrive).not.toHaveBeenCalled();
    expect(mockGithub).not.toHaveBeenCalled();
    expect(mockSlack).not.toHaveBeenCalled();
  });
});
