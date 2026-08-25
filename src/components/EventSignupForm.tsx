"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FieldWithOptions } from "@/lib/forms";

type Props = { eventId: string; fields: FieldWithOptions[] };

export function EventSignupForm({ eventId, fields }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set(fieldId: string, vals: string[]) {
    setValues((v) => ({ ...v, [fieldId]: vals }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const answers = fields.map((f) => ({ fieldId: f.id, values: values[f.id] ?? [] }));
    const res = await fetch(`/api/events/${eventId}/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers }),
    });
    setBusy(false);
    if (res.ok) {
      router.refresh();
      return;
    }
    setError(res.status === 409 ? "You've already responded to this event." : "Please check your answers and try again.");
  }

  return (
    <form className="card" onSubmit={submit}>
      {fields.map((f) => (
        <div key={f.id} style={{ marginBottom: "0.75rem" }}>
          <label>
            <strong>{f.label}</strong>
            {f.required ? " *" : ""}
          </label>
          {f.helpText ? <div className="sub">{f.helpText}</div> : null}
          {(f.type === "single_select" || f.type === "scale") && (
            <select required={f.required} value={values[f.id]?.[0] ?? ""} onChange={(e) => set(f.id, [e.target.value])}>
              <option value="" disabled>
                Choose…
              </option>
              {f.options.map((o) => (
                <option key={o.id} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          {f.type === "multi_select" &&
            f.options.map((o) => (
              <label key={o.id} style={{ display: "block" }}>
                <input
                  type="checkbox"
                  checked={(values[f.id] ?? []).includes(o.value)}
                  onChange={(e) => {
                    const cur = new Set(values[f.id] ?? []);
                    if (e.target.checked) cur.add(o.value);
                    else cur.delete(o.value);
                    set(f.id, [...cur]);
                  }}
                />{" "}
                {o.label}
              </label>
            ))}
          {f.type === "boolean" && (
            <label>
              <input
                type="checkbox"
                checked={values[f.id]?.[0] === "true"}
                onChange={(e) => set(f.id, [e.target.checked ? "true" : "false"])}
              />{" "}
              Yes
            </label>
          )}
          {f.type === "short_text" && (
            <input type="text" required={f.required} value={values[f.id]?.[0] ?? ""} onChange={(e) => set(f.id, [e.target.value])} />
          )}
          {f.type === "long_text" && (
            <textarea required={f.required} value={values[f.id]?.[0] ?? ""} onChange={(e) => set(f.id, [e.target.value])} />
          )}
        </div>
      ))}
      {error ? (
        <p className="sub" style={{ color: "var(--danger, crimson)" }}>
          {error}
        </p>
      ) : null}
      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? "Submitting…" : "Sign up"}
      </button>
    </form>
  );
}
