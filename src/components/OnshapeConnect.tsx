"use client";

import { useEffect } from "react";

/**
 * Client half of the Connect popup (spec §2). Hands the panel token to the
 * iframe via `postMessage` (same-origin; the iframe's own origin is the hub
 * origin even though its parent onshape.com page is cross-origin), then
 * either drives the Onshape OAuth step or signals "connected" and closes.
 */
export function OnshapeConnect({
  panelToken,
  onshapeLinked,
  onshapeResult,
}: {
  panelToken: string;
  onshapeLinked: boolean;
  onshapeResult?: "connected" | "error";
}) {
  useEffect(() => {
    const origin = window.location.origin;
    window.opener?.postMessage({ type: "hub-onshape-panel-token", panelToken }, origin);

    if (onshapeResult === "connected") {
      window.opener?.postMessage({ type: "hub-onshape-connected" }, origin);
      window.close();
      return;
    }
    if (onshapeResult === "error") return; // show retry UI below

    if (!onshapeLinked) {
      window.location.href = "/api/onshape/oauth/start";
      return;
    }

    // Already linked, no fresh oauth round-trip needed.
    window.opener?.postMessage({ type: "hub-onshape-connected" }, origin);
    window.close();
  }, [panelToken, onshapeLinked, onshapeResult]);

  if (onshapeResult === "error") {
    return (
      <div className="card flex flex-col gap-3">
        <h1 className="text-lg font-bold">Couldn&apos;t connect Onshape</h1>
        <p className="text-sm text-[var(--red)]">
          Something went wrong linking your Onshape account. Try again.
        </p>
        <button
          type="button"
          className="btn btn-primary self-start"
          onClick={() => {
            window.location.href = "/api/onshape/oauth/start";
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="card flex flex-col gap-3">
      <h1 className="text-lg font-bold">Connecting to Onshape…</h1>
      <p className="text-sm text-[var(--muted)]">This window will close automatically.</p>
    </div>
  );
}
