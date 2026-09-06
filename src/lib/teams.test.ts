import { describe, expect, test } from "vitest";
import { buildTeamTree, createTeam, joinAction, parseTeamInput, updateTeam } from "./teams";
import { teamFromRow } from "./types";
import type { Team } from "./types";

const team = (id: string, name: string, parentTeamId: string | null): Team => ({
  id, name, parentTeamId, description: null, joinMode: "admin_only", googleGroupEmail: null, githubTeamSlug: null,
  githubSyncAllowInactive: false,
});

// Generic chained-query stub in the style of github-team-sync.test.ts.
function fakeDb(opts: {
  insertResult?: { data: unknown; error: unknown };
  updateResult?: { data: unknown; error: unknown };
  channelPruneError?: unknown;
  channelUpsertError?: unknown;
  prunes: unknown[];
  upserts: unknown[];
  teamTree?: { id: string; parent_team_id: string | null }[];
  teamTreeError?: unknown;
}) {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      chain.eq = (col: string, val: unknown) => {
        if (table === "team_slack_channel") {
          const prune: Record<string, unknown> = { table, col, val };
          const result = { data: null, error: opts.channelPruneError ?? null };
          const thenable = {
            not: (notCol: string, op: string, notVal: unknown) => {
              prune.not = { col: notCol, op, val: notVal };
              opts.prunes.push(prune);
              return Promise.resolve(result);
            },
            then: (resolve: (r: unknown) => unknown) => {
              opts.prunes.push(prune);
              return resolve(result);
            },
          };
          return thenable;
        }
        return chain;
      };
      chain.delete = () => chain;
      chain.select = () => chain;
      chain.single = async () => opts.insertResult ?? { data: null, error: null };
      chain.maybeSingle = async () => opts.updateResult ?? { data: null, error: null };
      chain.upsert = (payload: unknown, options: unknown) => {
        if (table === "team_slack_channel") {
          opts.upserts.push({ table, payload, options });
          return Promise.resolve({ data: null, error: opts.channelUpsertError ?? null });
        }
        return chain;
      };
      chain.insert = () => chain;
      chain.update = () => chain;
      // Direct-await path for `.from("team").select("id, parent_team_id")` — no
      // further chaining, so `select` above just returns `chain` and this
      // resolves it when it's awaited on its own.
      chain.then = (resolve: (r: unknown) => unknown) => {
        if (table === "team") {
          return resolve({ data: opts.teamTree ?? [], error: opts.teamTreeError ?? null });
        }
        return resolve({ data: null, error: null });
      };
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
      googleGroupEmail: null, githubTeamSlug: null, githubSyncAllowInactive: false, slackChannels: [],
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

  test("githubSyncAllowInactive true is parsed", () => {
    const result = parseTeamInput({ name: "X", joinMode: "open", githubSyncAllowInactive: true });
    expect(result?.githubSyncAllowInactive).toBe(true);
  });

  test("githubSyncAllowInactive absent defaults to false", () => {
    const result = parseTeamInput({ name: "X", joinMode: "open" });
    expect(result?.githubSyncAllowInactive).toBe(false);
  });

  test("githubSyncAllowInactive non-boolean coerces to false", () => {
    const result = parseTeamInput({ name: "X", joinMode: "open", githubSyncAllowInactive: "yes" });
    expect(result?.githubSyncAllowInactive).toBe(false);
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
    googleGroupEmail: null, githubTeamSlug: null, githubSyncAllowInactive: false,
    slackChannels: [{ channelId: "C12345", label: "General" }],
  };
  const noChannelsInput = { ...input, slackChannels: [] };

  test("createTeam upserts then prunes team_slack_channel rows on the happy path", async () => {
    const prunes: unknown[] = [];
    const upserts: unknown[] = [];
    const db = fakeDb({ insertResult: { data: { id: "t1" }, error: null }, prunes, upserts });

    const result = await createTeam(input, db);

    expect(result).toEqual({ ok: true, id: "t1" });
    expect(upserts).toEqual([{
      table: "team_slack_channel",
      payload: [{ team_id: "t1", slack_channel_id: "C12345", label: "General" }],
      options: { onConflict: "team_id,slack_channel_id" },
    }]);
    expect(prunes).toEqual([{
      table: "team_slack_channel", col: "team_id", val: "t1",
      not: { col: "slack_channel_id", op: "in", val: "(C12345)" },
    }]);
  });

  test("updateTeam upserts then prunes team_slack_channel rows on the happy path", async () => {
    const prunes: unknown[] = [];
    const upserts: unknown[] = [];
    const db = fakeDb({ updateResult: { data: { id: "t1" }, error: null }, prunes, upserts });

    const result = await updateTeam("t1", input, db);

    expect(result).toEqual({ ok: true, status: 200 });
    expect(upserts).toEqual([{
      table: "team_slack_channel",
      payload: [{ team_id: "t1", slack_channel_id: "C12345", label: "General" }],
      options: { onConflict: "team_id,slack_channel_id" },
    }]);
    expect(prunes).toEqual([{
      table: "team_slack_channel", col: "team_id", val: "t1",
      not: { col: "slack_channel_id", op: "in", val: "(C12345)" },
    }]);
  });

  test("updateTeam does not touch team_slack_channel on 404", async () => {
    const prunes: unknown[] = [];
    const upserts: unknown[] = [];
    const db = fakeDb({ updateResult: { data: null, error: null }, prunes, upserts });

    const result = await updateTeam("missing", input, db);

    expect(result).toEqual({ ok: false, status: 404 });
    expect(prunes).toEqual([]);
    expect(upserts).toEqual([]);
  });

  test("createTeam with no channels skips the upsert and prunes all rows for the team", async () => {
    const prunes: unknown[] = [];
    const upserts: unknown[] = [];
    const db = fakeDb({ insertResult: { data: { id: "t1" }, error: null }, prunes, upserts });

    const result = await createTeam(noChannelsInput, db);

    expect(result).toEqual({ ok: true, id: "t1" });
    expect(upserts).toEqual([]);
    expect(prunes).toEqual([{ table: "team_slack_channel", col: "team_id", val: "t1" }]);
  });

  test("createTeam returns 500 when the team_slack_channel upsert fails, and never prunes existing links", async () => {
    const prunes: unknown[] = [];
    const upserts: unknown[] = [];
    const db = fakeDb({
      insertResult: { data: { id: "t1" }, error: null },
      channelUpsertError: { message: "boom" },
      prunes,
      upserts,
    });

    const result = await createTeam(input, db);

    expect(result).toEqual({ ok: false, status: 500 });
    expect(prunes).toEqual([]); // prune never attempted after upsert failure — old links survive
  });

  test("createTeam returns 500 when the team_slack_channel prune fails", async () => {
    const prunes: unknown[] = [];
    const upserts: unknown[] = [];
    const db = fakeDb({
      insertResult: { data: { id: "t1" }, error: null },
      channelPruneError: { message: "boom" },
      prunes,
      upserts,
    });

    const result = await createTeam(input, db);

    expect(result).toEqual({ ok: false, status: 500 });
  });

  test("updateTeam returns 500 when the team_slack_channel upsert fails", async () => {
    const prunes: unknown[] = [];
    const upserts: unknown[] = [];
    const db = fakeDb({
      updateResult: { data: { id: "t1" }, error: null },
      channelUpsertError: { message: "boom" },
      prunes,
      upserts,
    });

    const result = await updateTeam("t1", input, db);

    expect(result).toEqual({ ok: false, status: 500 });
  });
});

describe("updateTeam — cycle guard", () => {
  const baseInput = {
    name: "X", description: null, joinMode: "admin_only" as const,
    googleGroupEmail: null, githubTeamSlug: null, githubSyncAllowInactive: false,
    slackChannels: [],
  };

  test("rejects re-parenting a team under itself", async () => {
    const prunes: unknown[] = [];
    const upserts: unknown[] = [];
    const db = fakeDb({
      teamTree: [{ id: "t1", parent_team_id: null }],
      prunes,
      upserts,
    });

    const result = await updateTeam("t1", { ...baseInput, parentTeamId: "t1" }, db);

    expect(result).toEqual({ ok: false, status: 400 });
  });

  test("rejects re-parenting a team under its own descendant", async () => {
    const prunes: unknown[] = [];
    const upserts: unknown[] = [];
    const db = fakeDb({
      teamTree: [
        { id: "t1", parent_team_id: null },
        { id: "t2", parent_team_id: "t1" }, // t2 is a child of t1
      ],
      prunes,
      upserts,
    });

    const result = await updateTeam("t1", { ...baseInput, parentTeamId: "t2" }, db);

    expect(result).toEqual({ ok: false, status: 400 });
  });

  test("accepts a valid non-descendant parent", async () => {
    const prunes: unknown[] = [];
    const upserts: unknown[] = [];
    const db = fakeDb({
      teamTree: [
        { id: "root", parent_team_id: null },
        { id: "t1", parent_team_id: "root" },
        { id: "sibling", parent_team_id: "root" },
      ],
      updateResult: { data: { id: "t1" }, error: null },
      prunes,
      upserts,
    });

    const result = await updateTeam("t1", { ...baseInput, parentTeamId: "sibling" }, db);

    expect(result).toEqual({ ok: true, status: 200 });
  });
});

describe("teamFromRow", () => {
  test("maps google_group_email column", () => {
    const t = teamFromRow({
      id: "t1", name: "Pit Crew", parent_team_id: null, description: null,
      join_mode: "admin_only", google_group_email: "pit-crew@redalert1741.org", github_team_slug: null,
      github_sync_allow_inactive: false,
    });
    expect(t.googleGroupEmail).toBe("pit-crew@redalert1741.org");
  });

  test("maps null google_group_email", () => {
    const t = teamFromRow({
      id: "t1", name: "Pit Crew", parent_team_id: null, description: null,
      join_mode: "admin_only", google_group_email: null, github_team_slug: null,
      github_sync_allow_inactive: false,
    });
    expect(t.googleGroupEmail).toBeNull();
  });
});

describe("joinAction", () => {
  const t = (joinMode: Team["joinMode"]): Team => ({
    id: "t1", name: "T", parentTeamId: null, description: null, joinMode, googleGroupEmail: null, githubTeamSlug: null,
    githubSyncAllowInactive: false,
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
