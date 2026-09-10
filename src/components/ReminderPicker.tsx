"use client";

import { REMINDER_MINUTES, REMINDER_LABELS } from "@/lib/reminder-minutes";

export function ReminderPicker({
  value,
  onChange,
  legend,
  testIdPrefix = "remind",
  disabled,
}: {
  value: number[];
  onChange: (v: number[]) => void;
  legend?: string;
  testIdPrefix?: string;
  disabled?: boolean;
}) {
  function toggle(m: number, checked: boolean) {
    const next = checked ? [...value, m] : value.filter((v) => v !== m);
    onChange([...new Set(next)].sort((a, b) => a - b));
  }

  return (
    <div>
      <fieldset className="signup-q">
        {legend ? <legend className="q-label">{legend}</legend> : null}
        {REMINDER_MINUTES.map((m) => (
          <label key={m} className="signup-opt">
            <input
              type="checkbox"
              checked={value.includes(m)}
              disabled={disabled}
              data-testid={`${testIdPrefix}-${m}`}
              onChange={(e) => toggle(m, e.target.checked)}
            />
            {REMINDER_LABELS[m]}
          </label>
        ))}
      </fieldset>
      <p className="text-xs" style={{ color: "var(--muted)" }}>
        Sent as a push notification to devices you&apos;ve enabled in{" "}
        <a href="/me/notifications">Notifications</a>.
      </p>
    </div>
  );
}
