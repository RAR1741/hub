import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { hasRole } from "@/lib/authz";
import { getEvent } from "@/lib/events";
import { listEventRoster } from "@/lib/event-signups";
import { listEventResponses } from "@/lib/form-responses";
import { getFormWithFields, listForms } from "@/lib/forms";
import { listPeople } from "@/lib/people";
import { displayName } from "@/lib/people";
import { listPeriods } from "@/lib/periods";
import { getViewer } from "@/lib/viewer";
import { EventForm } from "@/components/EventForm";
import { EventRosterActions, ManualAddPerson } from "@/components/EventRosterActions";
import { EventUnlinkBanner } from "@/components/EventUnlinkBanner";

export const metadata: Metadata = { title: "Manage Event" };

export default async function EventRosterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "mentor")) redirect("/");

  const { id } = await params;
  const { edit } = await searchParams;
  const event = await getEvent(id);
  if (!event) notFound();

  const [roster, allPeople, periods, forms] = await Promise.all([listEventRoster(id), listPeople(), listPeriods(), listForms()]);
  const rosterIds = new Set(roster.map((r) => r.personId));
  const addable = allPeople
    .filter((p) => p.is_active && !rosterIds.has(p.id))
    .map((p) => ({ id: p.id, name: displayName(p) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const hasSlackChannel = !!event.slackChannelId && !event.slackArchivedAt;
  const creator = allPeople.find((p) => p.id === event.createdBy);
  const creatorUnlinked = hasSlackChannel && creator && !creator.slack_user_id;

  const formData = event.formId ? await getFormWithFields(event.formId) : null;
  const responses = event.formId ? await listEventResponses(event.id) : [];
  const attendingField = formData?.fields.find((f) => f.semanticKey === "attending") ?? null;
  const attendingRank = new Map(attendingField?.options.map((o) => [o.value, o.position]) ?? []);
  const sortedResponses = attendingField
    ? [...responses].sort((a, b) => {
        const av = a.answers.find((ans) => ans.fieldId === attendingField.id)?.value;
        const bv = b.answers.find((ans) => ans.fieldId === attendingField.id)?.value;
        const ar = av !== undefined ? (attendingRank.get(av) ?? Infinity) : Infinity;
        const br = bv !== undefined ? (attendingRank.get(bv) ?? Infinity) : Infinity;
        return ar - br;
      })
    : responses;
  const answerLabel = (field: NonNullable<typeof formData>["fields"][number], value: string | undefined): string => {
    if (value === undefined) return "";
    if (field.type === "boolean") return value === "true" ? "Yes" : "No";
    const option = field.options.find((o) => o.value === value);
    return option ? option.label : value;
  };

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>{event.name}</h1>
          <div className="sub">
            {new Date(event.startsAt).toLocaleString()} – {new Date(event.endsAt).toLocaleString()}
            {event.location ? ` · ${event.location}` : ""}
          </div>
        </div>
        <Link href={`/admin/events/${id}/print`} className="btn btn-secondary">
          Print roster
        </Link>
      </div>

      {event.gcalMissing && <EventUnlinkBanner eventId={id} />}
      {creatorUnlinked && <p className="pill error">Event creator isn&apos;t linked to Slack.</p>}

      <details className="card" open={edit === "1"}>
        <summary className="cursor-pointer font-semibold">Edit event</summary>
        <div className="mt-4">
          <EventForm periods={periods} forms={forms.map((f) => ({ id: f.id, title: f.title }))} event={event} />
        </div>
      </details>

      <ManualAddPerson eventId={id} people={addable} />

      <div className="tablewrap">
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Role</th><th>Signed up</th><th>Checked in</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {roster.map((r) => (
                <tr key={r.personId}>
                  <td>
                    {r.name}
                    {hasSlackChannel && (!r.slackLinked || !r.slackInvitedAt) && (
                      <span className="pill error" style={{ marginLeft: 6 }}>not in Slack channel</span>
                    )}
                  </td>
                  <td className="mono">{r.role}</td>
                  <td>{r.signedUp ? "Yes" : ""}</td>
                  <td>{r.checkedIn ? "Yes" : ""}</td>
                  <td><EventRosterActions eventId={id} entry={r} /></td>
                </tr>
              ))}
              {roster.length === 0 && (
                <tr><td colSpan={5} className="text-sm text-[var(--muted)]">No sign-ups yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {formData && (
        <div className="card">
          <h2>Responses</h2>
          <div className="tablewrap">
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    {formData.fields.map((f) => <th key={f.id}>{f.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {sortedResponses.map((r) => (
                    <tr key={r.personId}>
                      <td>{r.name}</td>
                      {formData.fields.map((f) => (
                        <td key={f.id}>
                          {r.answers.filter((a) => a.fieldId === f.id).map((a) => answerLabel(f, a.value)).join(", ")}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {sortedResponses.length === 0 && (
                    <tr><td colSpan={formData.fields.length + 1} className="text-sm text-[var(--muted)]">No responses yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
