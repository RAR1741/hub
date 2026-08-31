import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { listAllMeetings } from "@/lib/meetings";
import { getTeamTimezone } from "@/lib/settings";
import { MeetingForm } from "@/components/MeetingForm";
import { MeetingRow } from "@/components/MeetingRow";

export const metadata: Metadata = { title: "Meetings" };

export default async function AdminMeetingsPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) redirect("/");

  const meetings = await listAllMeetings();
  const teamTz = await getTeamTimezone();

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Meetings</h1>
          <div className="sub">Google Calendar sync + manual meetings · {meetings.length} total</div>
        </div>
      </div>
      <div className="card flex flex-col gap-3">
        <h2 className="text-base font-semibold">Add meeting</h2>
        <MeetingForm teamTz={teamTz} />
      </div>
      <p className="text-[13px] text-[var(--muted)]">
        Editing a <span className="pill role">Google</span>-sourced meeting is temporary — the next
        calendar sync overwrites it. Only <span className="pill on">Manual</span> meetings persist.
      </p>
      {meetings.length === 0 ? (
        <p className="card text-[var(--muted)]">No meetings yet — add one above or connect Google Calendar.</p>
      ) : (
      <div className="tablewrap">
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Starts</th>
                <th>Ends</th>
                <th>Source</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {meetings.map((m) => (
                <MeetingRow
                  key={m.id}
                  id={m.id}
                  title={m.title}
                  startsAt={m.startsAt}
                  endsAt={m.endsAt}
                  isManual={m.gcalEventId === null}
                  teamTz={teamTz}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}
    </main>
  );
}
