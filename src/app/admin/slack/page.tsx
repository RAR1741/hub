import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { getSetting, getTeamTimezone } from "@/lib/settings";
import { displayName } from "@/lib/people";
import { slackDepsFromEnv, verifyChannels, type ChannelCheck } from "@/lib/slack";
import type { LinkReport } from "@/lib/slack-link";
import { SlackLinkPanel } from "@/components/SlackLinkPanel";
import { SlackLinkPicker } from "@/components/SlackLinkPicker";

type PersonSlackRow = {
  id: string;
  first_name: string;
  last_name: string;
  display_name: string | null;
  role: "admin" | "mentor" | "student";
  is_active: boolean;
  slack_user_id: string | null;
};

export const metadata: Metadata = { title: "Slack" };

/** Plain-English line for a registry check, plus whether it's a problem *here*
 *  — a bot that isn't in a channel this environment never posts to is fine. */
function describeCheck(c: ChannelCheck): { text: string; bad: boolean } {
  switch (c.status) {
    case "ok":
      return { text: "Exists, bot is a member.", bad: false };
    case "not_a_member":
      return { text: `Exists, but the bot isn't a member — /invite it in Slack.`, bad: c.routed };
    case "archived":
      return { text: "Channel is archived — posts will fail.", bad: true };
    case "not_found":
      return { text: "Not found — wrong ID, or a private channel this bot was never invited to.", bad: true };
    case "missing_scope":
      return { text: "Can't check — the bot token needs channels:read and groups:read (see docs/setup/slack.md).", bad: false };
    default:
      return { text: `Check failed: ${c.detail ?? "unknown error"}.`, bad: false };
  }
}

export default async function AdminSlackPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) redirect("/");

  const db = getDb();
  const [{ data, error }, report, teamTz, channelChecks] = await Promise.all([
    db
      .from("person")
      .select("id, first_name, last_name, display_name, role, is_active, slack_user_id")
      .order("last_name"),
    getSetting<LinkReport | null>("slack_last_sync_report", null, db),
    getTeamTimezone(db),
    verifyChannels(slackDepsFromEnv()),
  ]);
  if (error) console.error("admin/slack: person select failed:", error.message);
  const people = (data ?? []) as PersonSlackRow[];

  const linked = people.filter((p) => p.slack_user_id);
  const unlinkedPeople = people.filter((p) => p.is_active && !p.slack_user_id);

  const pickerPeople = people
    .filter((p) => p.is_active && !p.slack_user_id)
    .map((p) => ({ id: p.id, name: displayName(p) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // The report is a point-in-time snapshot; filter out anyone who's since been
  // linked (e.g. via the picker below) so the section doesn't show stale entries.
  const linkedSlackIds = new Set(people.map((p) => p.slack_user_id).filter(Boolean));
  const unmatchedMembers = (report?.unmatchedSlack ?? []).filter((m) => !linkedSlackIds.has(m.id));

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Slack linking</h1>
          <div className="sub">
            Last synced {report ? new Date(report.ranAt).toLocaleString(undefined, { timeZone: teamTz }) : "never"} · {linked.length} linked
          </div>
        </div>
      </div>

      <section className="card flex flex-col gap-4">
        <SlackLinkPanel />
      </section>

      <section className="card flex flex-col gap-3">
        <h2 className="text-base font-semibold">Channel registry</h2>
        {channelChecks === null ? (
          <p className="text-sm text-[var(--muted)]">Slack bot token not set — the hardcoded channel IDs can&rsquo;t be checked.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {channelChecks.map((c) => {
              const { text, bad } = describeCheck(c);
              return (
                <div key={c.channel} className="border-t border-[var(--hair)] pt-2 first:border-t-0 first:pt-0">
                  <div className="font-medium">
                    #{c.channel === "bot_test" ? "bot-test" : c.channel}{" "}
                    <span className="font-normal text-[var(--muted)]">{c.id}</span>
                  </div>
                  <div className={`text-sm ${bad ? "text-[var(--red)]" : "text-[var(--muted)]"}`}>
                    {text}
                    {c.routed ? "" : " Not routed from this environment."}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {error ? (
        <section className="card flex flex-col gap-3">
          <p className="text-sm text-[var(--red)]">Couldn&rsquo;t load the roster — try again.</p>
        </section>
      ) : (
        <>
          <section className="card flex flex-col gap-3">
            <h2 className="text-base font-semibold">Unmatched roster entries</h2>
            {!report || unmatchedMembers.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">
                {!report ? "Run a sync to see unmatched Slack members." : "Everything from Slack is linked."}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {unmatchedMembers.map((m) => (
                  <div
                    key={m.id}
                    className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--hair)] pt-3 first:border-t-0 first:pt-0"
                  >
                    <div>
                      <div className="font-medium">{m.name || m.id}</div>
                      <div className="text-sm text-[var(--muted)]">{m.email}</div>
                    </div>
                    <SlackLinkPicker slackUserId={m.id} people={pickerPeople} />
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="card flex flex-col gap-3">
            <h2 className="text-base font-semibold">Unlinked people</h2>
            {unlinkedPeople.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">Every active person is linked.</p>
            ) : (
              <div className="tablewrap">
                <div style={{ overflowX: "auto" }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Person</th>
                        <th>Role</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unlinkedPeople.map((p) => (
                        <tr key={p.id}>
                          <td>{displayName(p)}</td>
                          <td>{p.role}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          <section className="card flex flex-col gap-3">
            <h2 className="text-base font-semibold">Linked people</h2>
            {linked.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No one is linked to Slack yet.</p>
            ) : (
              <div className="tablewrap">
                <div style={{ overflowX: "auto" }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Person</th>
                        <th>Role</th>
                        <th>Slack user ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {linked.map((p) => (
                        <tr key={p.id}>
                          <td>{displayName(p)}</td>
                          <td>{p.role}</td>
                          <td className="mono">{p.slack_user_id}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
