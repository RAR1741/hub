import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { typesForRole } from "@/lib/notification-types";
import { NotificationSettings } from "./NotificationSettings";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const viewer = await getViewer();
  if (!viewer.person) redirect("/login");

  const configured = Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
  const enabled = new Set(
    (viewer.person as { notification_types?: string[] }).notification_types ?? [],
  );
  const types = typesForRole(viewer.role).map((m) => ({ ...m, enabled: enabled.has(m.type) }));

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Notifications</h1>
      {!configured && (
        <p className="card text-[var(--muted)]">Push is not configured on this server.</p>
      )}
      <NotificationSettings
        configured={configured}
        publicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""}
        types={types}
      />
    </main>
  );
}
