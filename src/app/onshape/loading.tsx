// Skeleton for the panel shell (spec §4) — Onshape reloads this iframe on
// every selection change, so a blank flash would be constant without this.
export default function OnshapePanelLoading() {
  return (
    <main className="onshape-panel">
      <div className="card flex flex-col gap-3" aria-hidden>
        <div className="skeleton-line" style={{ width: "60%", height: "1rem" }} />
        <div className="skeleton-line" style={{ width: "100%", height: "2.5rem" }} />
        <div className="skeleton-line" style={{ width: "100%", height: "2.5rem" }} />
        <div className="skeleton-line" style={{ width: "80%", height: "2.5rem" }} />
      </div>
    </main>
  );
}
