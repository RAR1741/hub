"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FieldWithOptions } from "@/lib/forms";
import type { FormFieldType } from "@/lib/types";

const FIELD_TYPES: { value: FormFieldType; label: string }[] = [
  { value: "single_select", label: "Single select" },
  { value: "multi_select", label: "Multi select" },
  { value: "boolean", label: "Yes / No" },
  { value: "short_text", label: "Short text" },
  { value: "long_text", label: "Long text" },
  { value: "scale", label: "Scale" },
];
const CHOICE_TYPES: readonly FormFieldType[] = ["single_select", "multi_select", "scale"];

/** Create-form form for the /admin/forms list page. */
export function CreateFormForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("draft");
  const [notesEnabled, setNotesEnabled] = useState(false);
  const [notesLabel, setNotesLabel] = useState("Anything else we should know?");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: description || null,
          kind: "event_signup",
          status,
          notesEnabled,
          notesLabel: notesEnabled ? notesLabel : null,
        }),
      });
      if (res.ok) {
        const { id } = await res.json();
        router.push(`/admin/forms/${id}`);
      } else {
        setError("Could not create the form — check the title and try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="label">Title<input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required /></label>
      <label className="label">Description (optional)<input className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <label className="label">Status
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="closed">Closed</option>
        </select>
      </label>
      <p className="text-sm text-[var(--muted)]">
        An <strong>attendance question</strong> (Yes / Maybe / No) is added automatically as the first question.
      </p>
      <label className="label flex-row items-center gap-2">
        <input type="checkbox" checked={notesEnabled} onChange={(e) => setNotesEnabled(e.target.checked)} /> Add a notes field
      </label>
      {notesEnabled && (
        <label className="label">Notes label
          <input className="input" value={notesLabel} onChange={(e) => setNotesLabel(e.target.value)} />
        </label>
      )}
      {error && <p className="text-sm text-[var(--red)]">{error}</p>}
      <button type="submit" disabled={busy} className="btn btn-primary self-start">
        {busy ? "Creating…" : "Create form"}
      </button>
    </form>
  );
}

/** Edit-in-place title/description/status for the /admin/forms/[id] page. */
export function FormSettingsForm({ formId, title: initialTitle, description: initialDescription, status: initialStatus }: {
  formId: string; title: string; description: string | null; status: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/forms/${formId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description: description || null, kind: "event_signup", status }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        setError("Could not save changes — check the title and try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="label">Title<input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required /></label>
      <label className="label">Description (optional)<input className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <label className="label">Status
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="closed">Closed</option>
        </select>
      </label>
      {error && <p className="text-sm text-[var(--red)]">{error}</p>}
      <button type="submit" disabled={busy} className="btn btn-primary self-start">
        {busy ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}

type OptionDraft = { value: string; label: string };

/** Add/remove fields on a form. */
export function FormFieldEditor({ formId, fields }: { formId: string; fields: FieldWithOptions[] }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [helpText, setHelpText] = useState("");
  const [type, setType] = useState<FormFieldType>("short_text");
  const [required, setRequired] = useState(false);
  const [options, setOptions] = useState<OptionDraft[]>([{ value: "", label: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isChoice = CHOICE_TYPES.includes(type);

  function updateOption(i: number, patch: Partial<OptionDraft>) {
    setOptions((prev) => prev.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const position = fields.length;
      const body = {
        label,
        helpText: helpText || null,
        type,
        required,
        position,
        options: isChoice ? options.filter((o) => o.value.trim() && o.label.trim()) : [],
      };
      if (isChoice && body.options.length === 0) {
        setError("Choice fields need at least one option.");
        return;
      }
      const res = await fetch(`/api/admin/forms/${formId}/fields`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setLabel("");
        setHelpText("");
        setRequired(false);
        setOptions([{ value: "", label: "" }]);
        router.refresh();
      } else {
        setError("Could not add the field — check the inputs and try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function removeField(fieldId: string) {
    await fetch(`/api/admin/forms/fields/${fieldId}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="tablewrap">
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr><th>Label</th><th>Type</th><th>Required</th><th></th></tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.id}>
                  <td>{f.label}{f.semanticKey === "attending" ? <span className="text-sm text-[var(--muted)]"> (automatic)</span> : null}</td>
                  <td className="mono">{f.type}</td>
                  <td>{f.required ? "Yes" : ""}</td>
                  <td>
                    {f.semanticKey === "attending" ? null : (
                      <button type="button" className="btn btn-secondary px-3 py-1" onClick={() => removeField(f.id)}>Delete</button>
                    )}
                  </td>
                </tr>
              ))}
              {fields.length === 0 && (
                <tr><td colSpan={4} className="text-sm text-[var(--muted)]">No fields yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3 card">
        <h3 className="font-semibold">Add field</h3>
        <label className="label">Label<input className="input" value={label} onChange={(e) => setLabel(e.target.value)} required /></label>
        <label className="label">Help text (optional)<input className="input" value={helpText} onChange={(e) => setHelpText(e.target.value)} /></label>
        <label className="label">Type
          <select className="input" value={type} onChange={(e) => setType(e.target.value as FormFieldType)}>
            {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <label className="label flex-row items-center gap-2">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Required
        </label>

        {isChoice && (
          <div className="flex flex-col gap-2">
            <div className="label">Options</div>
            {options.map((o, i) => (
              <div key={i} className="flex gap-2">
                <input className="input" placeholder="value" value={o.value} onChange={(e) => updateOption(i, { value: e.target.value })} />
                <input className="input" placeholder="label" value={o.label} onChange={(e) => updateOption(i, { label: e.target.value })} />
              </div>
            ))}
            <button type="button" className="btn btn-secondary self-start" onClick={() => setOptions((prev) => [...prev, { value: "", label: "" }])}>
              Add option
            </button>
          </div>
        )}

        {error && <p className="text-sm text-[var(--red)]">{error}</p>}
        <button type="submit" disabled={busy} className="btn btn-primary self-start">
          {busy ? "Adding…" : "Add field"}
        </button>
      </form>
    </div>
  );
}
