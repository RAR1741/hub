"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FieldWithOptions } from "@/lib/forms";

type Props = { eventId: string; eventName: string; fields: FieldWithOptions[] };

export function EventSignupForm({ eventId, eventName, fields }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set(fieldId: string, vals: string[]) {
    setValues((v) => ({ ...v, [fieldId]: vals }));
  }

  function close() {
    if (busy) return;
    setOpen(false);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // Native `required` covers text/select inputs; multi_select/boolean have no
    // native enforcement, so verify every required field has a value here too.
    const missing = fields.find((f) => f.required && (values[f.id] ?? []).length === 0);
    if (missing) {
      setError(`Please answer "${missing.label}".`);
      return;
    }
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
      setOpen(false);
      router.refresh();
      return;
    }
    setError(res.status === 409 ? "You've already responded to this event." : "Please check your answers and try again.");
  }

  return (
    <>
      <button type="button" className="btn btn-primary px-3 py-1" onClick={() => setOpen(true)}>
        Sign up
      </button>
      {open && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={`Sign up for ${eventName}`}
          onClick={close}
        >
          <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-base font-semibold">Sign up: {eventName}</h3>
              <button type="button" className="btn" onClick={close} aria-label="Close">
                ✕
              </button>
            </div>

            {fields.map((f) => (
              <div key={f.id} style={{ marginTop: "0.75rem" }}>
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

            <div className="flex justify-end gap-2" style={{ marginTop: "1rem" }}>
              <button type="button" className="btn btn-secondary" onClick={close} disabled={busy}>
                Cancel
              </button>
              <button className="btn btn-primary" type="submit" disabled={busy}>
                {busy ? "Submitting…" : "Submit"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
