import { Icon } from "team-hub";

const ALL = [
  "edit", "trash", "plus", "search", "check",
  "x", "calendar", "clock", "users", "eye", "chevron",
] as const;

// Each cell is a self-contained hub surface so it reads as intended in both
// light and dark (the tokens flip automatically with the viewer's theme).
const panel: React.CSSProperties = {
  background: "var(--canvas)",
  color: "var(--ink)",
  padding: 20,
  borderRadius: 12,
};

// The full inline-SVG icon set, labeled — what a designer picks a name from.
export function Gallery() {
  return (
    <div style={{ ...panel, display: "flex", flexWrap: "wrap", gap: 18 }}>
      {ALL.map((name) => (
        <div key={name} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, width: 64 }}>
          <Icon name={name} className="hub-icon-24" />
          <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{name}</span>
        </div>
      ))}
      <style>{`.hub-icon-24{width:24px;height:24px}`}</style>
    </div>
  );
}

// Icons inherit text color and pair with the button classes.
export function InButtons() {
  return (
    <div style={{ ...panel, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <button className="btn btn-primary"><Icon name="plus" /> Add member</button>
      <button className="btn btn-secondary"><Icon name="edit" /> Edit</button>
      <button className="btn danger"><Icon name="trash" /> Remove</button>
      <button className="btn icon" aria-label="Search"><Icon name="search" /></button>
    </div>
  );
}

// currentColor means an icon takes the color of its context.
export function Colors() {
  return (
    <div style={{ ...panel, display: "flex", gap: 20, alignItems: "center" }}>
      <span style={{ color: "var(--red)" }}><Icon name="check" className="hub-icon-28" /></span>
      <span style={{ color: "var(--present)" }}><Icon name="users" className="hub-icon-28" /></span>
      <span style={{ color: "var(--steel)" }}><Icon name="calendar" className="hub-icon-28" /></span>
      <span style={{ color: "var(--muted)" }}><Icon name="clock" className="hub-icon-28" /></span>
      <style>{`.hub-icon-28{width:28px;height:28px}`}</style>
    </div>
  );
}
