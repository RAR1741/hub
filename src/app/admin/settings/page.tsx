import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { getSetting } from "@/lib/settings";
import { SettingsForm } from "@/components/SettingsForm";

export default async function AdminSettingsPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) redirect("/");

  const [teamTimezone, gcalCalendarId, autoCloseEnabled, autoCloseHours, maxShiftHours, seasonHoursGoal] =
    await Promise.all([
      getSetting<string>("team_timezone", "America/Indiana/Indianapolis"),
      getSetting<string>("gcal_calendar_id", ""),
      getSetting<boolean>("auto_close_enabled", false),
      getSetting<number>("auto_close_hours", 4),
      getSetting<number>("max_shift_hours", 18),
      getSetting<number>("season_hours_goal", 0),
    ]);

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <div className="sub">Timezone, calendar sync, and shift limits</div>
        </div>
      </div>
      <section className="card flex flex-col gap-4">
        <SettingsForm
          initial={{ teamTimezone, gcalCalendarId, autoCloseEnabled, autoCloseHours, maxShiftHours, seasonHoursGoal }}
        />
      </section>
      <p>
        <Link href="/admin/kiosk-devices" className="font-medium text-[var(--red)]">
          Manage kiosk devices →
        </Link>
      </p>
    </main>
  );
}
