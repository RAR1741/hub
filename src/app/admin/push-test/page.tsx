import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { pushTestBlocked } from "./gate";
import { PushTestForm } from "./PushTestForm";

export const metadata: Metadata = { title: "Push test" };

export default async function PushTestPage() {
  const viewer = await getViewer();
  if (pushTestBlocked() || !hasRole(viewer.role, "admin")) notFound();

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Push notification tester</h1>
      <p className="card text-[var(--muted)]">
        Dev-only. Fires a real push to YOUR devices on this browser, ignoring your notification
        preferences. Enable notifications on this device first at{" "}
        <a href="/me/notifications">/me/notifications</a>.
      </p>
      <PushTestForm />
    </main>
  );
}
