import type { ReactNode } from "react";

type StatProps = {
  label: string;
  value: ReactNode;
  /** Goal-meter fraction, 0..1. Clamped before rendering. */
  bar?: number;
};

export function Stat({ label, value, bar }: StatProps) {
  const pct = bar == null ? null : Math.round(Math.min(1, Math.max(0, bar)) * 100);

  return (
    <div className="stat">
      <p className="eyebrow">{label}</p>
      <div className="num mono">{value}</div>
      {pct != null && (
        <div className="bar">
          <i style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}
