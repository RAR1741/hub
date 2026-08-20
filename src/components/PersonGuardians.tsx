"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Guardian } from "@/lib/types";

type GuardianLink = { guardian: Guardian; relationship: string | null };

type EditValues = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  employer: string;
};

function toEditValues(g: Guardian): EditValues {
  return {
    firstName: g.firstName,
    lastName: g.lastName,
    email: g.email ?? "",
    phone: g.phone ?? "",
    employer: g.employer ?? "",
  };
}

const EMPTY_NEW = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  employer: "",
  relationship: "",
};

export function PersonGuardians({
  personId,
  guardians,
}: {
  personId: string;
  guardians: GuardianLink[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<EditValues | null>(null);

  const [newGuardian, setNewGuardian] = useState(EMPTY_NEW);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Guardian[]>([]);
  const [selected, setSelected] = useState<Guardian | null>(null);
  const [relationship, setRelationship] = useState("");
  const searchTimer = useRef<number | null>(null);

  async function call(input: RequestInfo, init?: RequestInit) {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(input, init);
      if (res.ok) {
        router.refresh();
        return true;
      }
      setError("Couldn't save that. Please try again.");
      return false;
    } catch {
      setError("Couldn't save that. Please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function startEdit(g: Guardian) {
    setEditingId(g.id);
    setEditValues(toEditValues(g));
  }

  function setEditField<K extends keyof EditValues>(k: K, v: EditValues[K]) {
    setEditValues((prev) => (prev ? { ...prev, [k]: v } : prev));
  }

  async function saveEdit(guardianId: string) {
    if (!editValues) return;
    const ok = await call(`/api/admin/guardians/${guardianId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: editValues.firstName,
        lastName: editValues.lastName,
        email: editValues.email || null,
        phone: editValues.phone || null,
        employer: editValues.employer || null,
      }),
    });
    if (ok) {
      setEditingId(null);
      setEditValues(null);
    }
  }

  async function unlink(guardianId: string) {
    await call(`/api/admin/people/${personId}/guardians/${guardianId}`, {
      method: "DELETE",
    });
  }

  async function deleteGuardian(guardianId: string, name: string) {
    if (!confirm(`Delete ${name}? This removes them from every linked student, not just this one.`)) return;
    await call(`/api/admin/guardians/${guardianId}`, { method: "DELETE" });
  }

  async function addGuardian(e: React.FormEvent) {
    e.preventDefault();
    if (!newGuardian.firstName.trim() || !newGuardian.lastName.trim()) return;
    const ok = await call(`/api/admin/people/${personId}/guardians`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: newGuardian.firstName,
        lastName: newGuardian.lastName,
        email: newGuardian.email || null,
        phone: newGuardian.phone || null,
        employer: newGuardian.employer || null,
        relationship: newGuardian.relationship || null,
      }),
    });
    if (ok) setNewGuardian(EMPTY_NEW);
  }

  function onQueryChange(v: string) {
    setQuery(v);
    setSelected(null);
    clearTimeout(searchTimer.current ?? undefined);
    if (v.trim().length < 2) {
      setResults([]);
      return;
    }
    searchTimer.current = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/guardians/search?q=${encodeURIComponent(v.trim())}`);
        if (res.ok) {
          const body = (await res.json()) as { guardians: Guardian[] };
          setResults(body.guardians);
        }
      } catch {
        // Ignore search failures; the user can retry by typing.
      }
    }, 300);
  }

  async function linkSelected() {
    if (!selected) return;
    const ok = await call(`/api/admin/people/${personId}/guardians/link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guardianId: selected.id, relationship: relationship || null }),
    });
    if (ok) {
      setQuery("");
      setResults([]);
      setSelected(null);
      setRelationship("");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {guardians.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No guardians on file.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {guardians.map(({ guardian: g, relationship: rel }) => {
            const isEditing = editingId === g.id;
            const name = `${g.firstName} ${g.lastName}`;
            return (
              <li key={g.id} data-testid={`guardian-${g.id}`} className="flex flex-col gap-2 border-b border-[var(--border)] pb-3 last:border-b-0 last:pb-0">
                {isEditing && editValues ? (
                  <div className="flex flex-col gap-2">
                    <label className="label">First name <input className="input" value={editValues.firstName} onChange={(e) => setEditField("firstName", e.target.value)} /></label>
                    <label className="label">Last name <input className="input" value={editValues.lastName} onChange={(e) => setEditField("lastName", e.target.value)} /></label>
                    <label className="label">Email <input className="input" type="email" value={editValues.email} onChange={(e) => setEditField("email", e.target.value)} /></label>
                    <label className="label">Phone <input className="input" value={editValues.phone} onChange={(e) => setEditField("phone", e.target.value)} /></label>
                    <label className="label">Employer <input className="input" value={editValues.employer} onChange={(e) => setEditField("employer", e.target.value)} /></label>
                    <div className="flex gap-2">
                      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => saveEdit(g.id)}>
                        {busy ? "Saving…" : "Save"}
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        onClick={() => {
                          setEditingId(null);
                          setEditValues(null);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{name}</span>
                      {rel && <span className="pill">{rel}</span>}
                    </div>
                    {(g.email || g.phone || g.employer) && (
                      <ul className="flex flex-wrap gap-x-4 text-sm text-[var(--muted)]">
                        {g.email && <li>{g.email}</li>}
                        {g.phone && <li>{g.phone}</li>}
                        {g.employer && <li>{g.employer}</li>}
                      </ul>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="btn" disabled={busy} onClick={() => startEdit(g)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        title="Unlink from this student"
                        aria-label="Unlink from this student"
                        onClick={() => unlink(g.id)}
                      >
                        Unlink
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger"
                        disabled={busy}
                        onClick={() => deleteGuardian(g.id, name)}
                      >
                        Delete guardian
                      </button>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error && <p className="text-sm text-[var(--red)]">{error}</p>}

      <details className="card">
        <summary className="cursor-pointer text-sm font-semibold">Add new guardian</summary>
        <form className="mt-3 flex flex-col gap-2" onSubmit={addGuardian}>
          <label className="label">First name <input className="input" value={newGuardian.firstName} onChange={(e) => setNewGuardian((p) => ({ ...p, firstName: e.target.value }))} required /></label>
          <label className="label">Last name <input className="input" value={newGuardian.lastName} onChange={(e) => setNewGuardian((p) => ({ ...p, lastName: e.target.value }))} required /></label>
          <label className="label">Email <input className="input" type="email" value={newGuardian.email} onChange={(e) => setNewGuardian((p) => ({ ...p, email: e.target.value }))} /></label>
          <label className="label">Phone <input className="input" value={newGuardian.phone} onChange={(e) => setNewGuardian((p) => ({ ...p, phone: e.target.value }))} /></label>
          <label className="label">Employer <input className="input" value={newGuardian.employer} onChange={(e) => setNewGuardian((p) => ({ ...p, employer: e.target.value }))} /></label>
          <label className="label">Relationship <input className="input" value={newGuardian.relationship} onChange={(e) => setNewGuardian((p) => ({ ...p, relationship: e.target.value }))} placeholder="Mother, Father, Guardian…" /></label>
          <button type="submit" className="btn btn-primary" disabled={busy || !newGuardian.firstName.trim() || !newGuardian.lastName.trim()}>
            {busy ? "Saving…" : "Add guardian"}
          </button>
        </form>
      </details>

      <details className="card">
        <summary className="cursor-pointer text-sm font-semibold">Link existing guardian</summary>
        <div className="mt-3 flex flex-col gap-2">
          <label className="label">
            Search by name
            <input
              className="input"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Start typing a guardian's name…"
            />
          </label>
          {results.length > 0 && !selected && (
            <ul className="flex flex-col gap-1">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setSelected(r);
                      setResults([]);
                    }}
                  >
                    {r.firstName} {r.lastName}
                    {r.email ? ` — ${r.email}` : ""}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {selected && (
            <div className="flex flex-wrap items-end gap-2">
              <span className="text-sm">
                Linking <span className="font-medium">{selected.firstName} {selected.lastName}</span>
              </span>
              <label className="label">Relationship <input className="input" value={relationship} onChange={(e) => setRelationship(e.target.value)} placeholder="Mother, Father, Guardian…" /></label>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={linkSelected}>
                {busy ? "Linking…" : "Link"}
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => {
                  setSelected(null);
                  setRelationship("");
                }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
