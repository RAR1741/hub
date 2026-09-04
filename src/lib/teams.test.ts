import { describe, expect, test } from "vitest";
import { buildTeamTree, createTeam, joinAction, parseTeamInput, updateTeam } from "./teams";
import { teamFromRow } from "./types";
import type { Team } from "./types";

const team = (id: string, name: string, parentTeamId: string | null): Team => ({
  id, name, parentTeamId, description: null, joinMode: "admin_only", googleGroupEmail: null, githubTeamSlug: null,
});

// Generic chained-query stub in the style of github-team-sync.test.ts.
function fakeDb(opts: {
  insertResult?: { data: unknown; error: unknown };
  updateResult?: { data: unknown; error: unknown };
  channelDeleteError?: unknown;
  channelInsertError?: unknown;
  deletes: unknown[];
  inserts: unknown[];
}) {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      chain.eq = (col: string, val: unknown) => {
        if (table === "team_slack_channel") {
          opts.deletes.push({ table, col, val });
          return Promise.resolve({ data: null, error: opts.channelDeleteError ?? null });
        }
        return chain;
      };
      chain.delete = () => chain;
      chain.select = () => chain;
      chain.single = async () => opts.insertResult ?? { data: null, error: null };
      chain.maybeSingle = async () => opts.updateResult ?? { data: null, error: null };
      chain.insert = (payload: unknown) => {
        if (table === "team_slack_channel") {
          opts.inserts.push({ table, payload });
          return Promise.resolve({ data: null, error: opts.channelInsertError ?? null });
        }
        return chain;
      };
      chain.update = () => chain;
      return chain;
    },
  } as never;
}

describe("buildTeamTree", () => {
  test("nests children under parents, sorted by name", () => {
    const tree = buildTeamTree([
      team("root", "Red Alert", null),
      team("m", "Mechanical", "root"),
      team("p", "Programming", "root"),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0].children.map((c) => c.name)).toEqual(["Mechanical", "Programming"]);
  });

  test("orphaned parent ids surface as roots", () => {
    const tree = buildTeamTree([team("a", "A", "missing")]);
    expect(tree.map((t) => t.id)).toEqual(["a"]);
  });

  test("multiple roots sorted by name", () => {
    const tree = buildTeamTree([team("b", "Bravo", null), team("a", "Alpha", null)]);
    expect(tree.map((t) => t.name)).toEqual(["Alpha", "Bravo"]);
  });
});

describe("parseTeamInput", () => {
  test("accepts valid input", () => {
    expect(
      parseTeamInput({ name: " Pit Crew ", joinMode: "open" }),
    ).toEqual({
      name: "Pit Crew", parentTeamId: null, description: null, joinMode: "open",
      googleGroupEmail: null, githubTeamSlug: null, slackChannels: [],
    });
  });
  test.each([
    [{ name: "", joinMode: "open" }],
    [{ name: "X", joinMode: "sneaky" }],
    [{ name: "X", joinMode: "open", parentTeamId: 42 }],
    [null],
  ])("rejects %j", (body) => {
    expect(parseTeamInput(body)).toBeNull();
  });

  test("googleGroupEmail absent is fine (not synced)", () => {
    const result = parseTeamInput({ name: "X", joinMode: "open" });
    expect(result).not.toBeNull();
    expect(result?.googleGroupEmail).toBeNull();
  });

  test("googleGroupEmail blank string becomes null", () => {
    const result = parseTeamInput({ name: "X", joinMode: "open", googleGroupEmail: "  " });
    expect(result?.googleGroupEmail).toBeNull();
  });

  test("googleGroupEmail value is trimmed and kept", () => {
    const result = parseTeamInput({
      name: "X", joinMode: "open", googleGroupEmail: " pit-crew@redalert1741.org ",
    });
    expect(result?.googleGroupEmail).toBe("pit-crew@redalert1741.org");
  });

  test("googleGroupEmail rejects non-string values", () => {
    expect(parseTeamInput({ name: "X", joinMode: "open", googleGroupEmail: 42 })).toBeNull();
  });

  test("githubTeamSlug absent is fine", () => {
    const result = parseTeamInput({ name: "X", joinMode: "open" });
    expect(result?.githubTeamSlug).toBeNull();
  });

  test("githubTeamSlug blank string becomes null", () => {
    const result = parseTeamInput({ name: "X", joinMode: "open", githubTeamSlug: "  " });
    expect(result?.githubTeamSlug).toBeNull();
  });

  test("githubTeamSlug is lowercased", () => {
    const result = parseTeamInput({ name: "X", joinMode: "open", githubTeamSlug: "Software" });
    expect(result?.githubTeamSlug).toBe("software");
  });

  test.each([
    ["Bad Slug!"],
    ["-leading-hyphen"],
  ])("rejects invalid githubTeamSlug %j", (slug) => {
    expect(parseTeamInput({ name: "X", joinMode: "open", githubTeamSlug: slug })).toBeNull();
  });

  test("slackChannels absent defaults to []", () => {
    const result = parseTeamInput({ name: "X", joinMode: "open" });
    expect(result?.slackChannels).toEqual([]);
  });

  test("slackChannels accepts a valid array", () => {
    const result = parseTeamInput({
      name: "X", joinMode: "open",
      slackChannels: [{ channelId: "C12345", label: " General " }, { channelId: "G6789A", label: null }],
    });
    expect(result?.slackChannels).toEqual([
      { channelId: "C12345", label: "General" },
      { channelId: "G6789A", label: null },
    ]);
  });

  test("slackChannels rejects a non-array", () => {
    expect(parseTeamInput({ name: "X", joinMode: "open", slackChannels: "nope" })).toBeNull();
  });

  test.each([
    ["nope"],
    ["#frc"],
    ["C" + "A".repeat(25)], // over the 20-char cap
  ])("slackChannels rejects a bad channelId %j", (channelId) => {
    expect(parseTeamInput({ name: "X", joinMode: "open", slackChannels: [{ channelId, label: null }] })).toBeNull();
  });

  test("slackChannels accepts a normal-length channelId", () => {
    const result = parseTeamInput({
      name: "X", joinMode: "open", slackChannels: [{ channelId: "C0123ABC", label: null }],
    });
    expect(result?.slackChannels).toEqual([{ channelId: "C0123ABC", label: null }]);
  });

  test("slackChannels dedupes by channelId, keeping the first occurrence", () => {
    const result = parseTeamInput({
      name: "X", joinMode: "open",
      slackChannels: [
        { channelId: "C12345", label: "First" },
        { channelId: "C12345", label: "Second" },
      ],
    });
    expect(result?.slackChannels).toEqual([{ channelId: "C12345", label: "First" }]);
  });
});

describe("createTeam / updateTeam — slack channel sync", () => {
  const input = {
    name: "X", parentTeamId: null, description: null, joinMode: "admin_only" as const,
    googleGroupEmail: null, githubTeamSlug: null,
    slackChannels: [{ channelId: "C12345", label: "General" }],
  };

  test("createTeam replaces team_slack_channel rows on the happy path", async () => {
    const deletes: unknown[] = [];
    const inserts: unknown[] = [];
    const db = fakeDb({ insertResult: { data: { id: "t1" }, error: null }, deletes, inserts });

    const result = await createTeam(input, db);

    expect(result).toEqual({ ok: true, id: "t1" });
    expect(deletes).toEqual([{ table: "team_slack_channel", col: "team_id", val: "t1" }]);
    expect(inserts).toEqual([{
      table: "team_slack_channel",
      payload: [{ team_id: "t1", slack_channel_id: "C12345", label: "General" }],
    }]);
  });

  test("updateTeam replaces team_slack_channel rows on the happy path", async () => {
    const deletes: unknown[] = [];
    const inserts: unknown[] = [];
    const db = fakeDb({ updateResult: { data: { id: "t1" }, error: null }, deletes, inserts });

    const result = await updateTeam("t1", input, db);

    expect(result).toEqual({ ok: true, status: 200 });
    expect(deletes).toEqual([{ table: "team_slack_channel", col: "team_id", val: "t1" }]);
    expect(inserts).toEqual([{
      table: "team_slack_channel",
      payload: [{ team_id: "t1", slack_channel_id: "C12345", label: "General" }],
    }]);
  });

  test("updateTeam does not touch team_slack_channel on 404", async () => {
    const deletes: unknown[] = [];
    const inserts: unknown[] = [];
    const db = fakeDb({ updateResult: { data: null, error: null }, deletes, inserts });

    const result = await updateTeam("missing", input, db);

    expect(result).toEqual({ ok: false, status: 404 });
    expect(deletes).toEqual([]);
    expect(inserts).toEqual([]);
  });

  test("createTeam returns 500 when the team_slack_channel insert fails (team row already committed)", async () => {
    const deletes: unknown[] = [];
    const inserts: unknown[] = [];
    const db = fakeDb({
      insertResult: { data: { id: "t1" }, error: null },
      channelInsertError: { message: "boom" },
      deletes,
      inserts,
    });

    const result = await createTeam(input, db);

    expect(result).toEqual({ ok: false, status: 500 });
  });

  test("createTeam returns 500 when the team_slack_channel delete fails", async () => {
    const deletes: unknown[] = [];
    const inserts: unknown[] = [];
    const db = fakeDb({
      insertResult: { data: { id: "t1" }, error: null },
      channelDeleteError: { message: "boom" },
      deletes,
      inserts,
    });

    const result = await createTeam(input, db);

    expect(result).toEqual({ ok: false, status: 500 });
    expect(inserts).toEqual([]); // insert never attempted after delete failure
  });

  test("updateTeam returns 500 when the team_slack_channel insert fails", async () => {
    const deletes: unknown[] = [];
    const inserts: unknown[] = [];
    const db = fakeDb({
      updateResult: { data: { id: "t1" }, error: null },
      channelInsertError: { message: "boom" },
      deletes,
      inserts,
    });

    const result = await updateTeam("t1", input, db);

    expect(result).toEqual({ ok: false, status: 500 });
  });
});

describe("teamFromRow", () => {
  test("maps google_group_email column", () => {
    const t = teamFromRow({
      id: "t1", name: "Pit Crew", parent_team_id: null, description: null,
      join_mode: "admin_only", google_group_email: "pit-crew@redalert1741.org", github_team_slug: null,
    });
    expect(t.googleGroupEmail).toBe("pit-crew@redalert1741.org");
  });

  test("maps null google_group_email", () => {
    const t = teamFromRow({
      id: "t1", name: "Pit Crew", parent_team_id: null, description: null,
      join_mode: "admin_only", google_group_email: null, github_team_slug: null,
    });
    expect(t.googleGroupEmail).toBeNull();
  });
});

describe("joinAction", () => {
  const t = (joinMode: Team["joinMode"]): Team => ({
    id: "t1", name: "T", parentTeamId: null, description: null, joinMode, googleGroupEmail: null, githubTeamSlug: null,
  });

  test("existing member", () => {
    expect(joinAction(t("open"), true, false)).toBe("member");
  });
  test("open team is joinable", () => {
    expect(joinAction(t("open"), false, false)).toBe("join");
  });
  test("approval team without pending app is applyable", () => {
    expect(joinAction(t("requires_approval"), false, false)).toBe("apply");
  });
  test("approval team with pending app shows pending", () => {
    expect(joinAction(t("requires_approval"), false, true)).toBe("pending");
  });
  test("admin_only offers nothing", () => {
    expect(joinAction(t("admin_only"), false, false)).toBe("none");
  });
});
