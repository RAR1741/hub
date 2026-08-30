import type { Metadata } from "next";
import Link from "next/link";
import { hasRole } from "@/lib/authz";
import { getConnection } from "@/lib/onshape";
import { createPanelToken } from "@/lib/onshape-panel-token";
import { getViewer } from "@/lib/viewer";
import { OnshapeConnect } from "@/components/OnshapeConnect";

/**
 * Popup target for the panel's Connect button (spec §2). Top-level window,
 * so normal hub cookies work here even though the panel itself (an iframe on
 * onshape.com) never gets them. Mints the panel token server-side and hands
 * it to the client child, which posts it back to the panel via `postMessage`.
 */
export const metadata: Metadata = { title: "Connect Onshape" };

export default async function OnshapeConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ onshape?: string }>;
}) {
  const { onshape } = await searchParams;
  const viewer = await getViewer();

  if (!hasRole(viewer.role, "student")) {
    return (
      <main className="onshape-panel">
        <div className="card flex flex-col gap-3">
          <h1 className="text-lg font-bold">Connect Onshape to the hub</h1>
          <p className="text-sm">Log in to the hub to continue, then reopen this window.</p>
          <Link href="/login" className="btn btn-primary self-start">
            Log in
          </Link>
        </div>
      </main>
    );
  }

  const panelToken = await createPanelToken(
    viewer.person!.id,
    process.env.STUDENT_SESSION_SECRET!,
  );
  const connection = await getConnection(viewer.person!.id);
  const onshapeResult = onshape === "connected" || onshape === "error" ? onshape : undefined;

  return (
    <main className="onshape-panel">
      <OnshapeConnect
        panelToken={panelToken}
        onshapeLinked={!!connection}
        onshapeResult={onshapeResult}
      />
    </main>
  );
}
