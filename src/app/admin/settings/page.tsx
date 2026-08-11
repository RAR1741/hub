import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { getSetting } from "@/lib/settings";
import { SettingsForm } from "@/components/SettingsForm";

export default async function AdminSettingsPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) redirect("/");

  const [teamTimezone, gcalCalendarId, autoCloseHours, maxShiftHours] = await Promise.all([
    getSetting<string>("team_timezone", "America/Indiana/Indianapolis"),
    getSetting<string>("gcal_calendar_id", ""),
    getSetting<number>("auto_close_hours", 4),
    getSetting<number>("max_shift_hours", 18),
  ]);

  return (
    <main>
      <h1>Admin — Settings</h1>
      <SettingsForm initial={{ teamTimezone, gcalCalendarId, autoCloseHours, maxShiftHours }} />
      <p><Link href="/admin/kiosk-devices">Manage kiosk devices →</Link></p>
    </main>
  );
}
