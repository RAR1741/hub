"use client";

import { useEffect, useState } from "react";
import { PART_STATUSES, STATUS_MAP, STATUS_TONE } from "@/lib/types";
import type { PartStatus } from "@/lib/types";

const TOKEN_KEY = "hub:onshape-panel-token";
const CACHE_TTL_MS = 30 * 60 * 1000;

export type PanelContext = {
  documentId?: string;
  workspaceOrVersion?: string;
  workspaceOrVersionId?: string;
  elementId?: string;
  server?: string;
};

type HubPart = { id: string; fullPartNumber: string; status: PartStatus };
type PanelPart = {
  partId: string;
  name: string;
  material: string | null;
  onshapePartNumber: string | null;
  hubPart: HubPart | null;
};
type Assembly = { id: string; name: string; fullPartNumber: string };
type PanelProject = { id: string; name: string; assemblies: Assembly[] };
type ConnectionState = "connected" | "needs_connect" | "needs_reconnect";
type ContextResponse = { connectionState: ConnectionState; parts: PanelPart[]; projects: PanelProject[] };

function hasFullContextOf(context: PanelContext): boolean {
  return !!(
    context.documentId &&
    context.workspaceOrVersion &&
    context.workspaceOrVersionId &&
    context.elementId
  );
}

function cacheKey(context: PanelContext): string {
  return `hub:onshape-panel-context:${JSON.stringify(context)}`;
}

function readCache(context: PanelContext): ContextResponse | null {
  try {
    const raw = sessionStorage.getItem(cacheKey(context));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ts: number; data: ContextResponse };
    if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCache(context: PanelContext, data: ContextResponse): void {
  try {
    sessionStorage.setItem(cacheKey(context), JSON.stringify({ ts: Date.now(), data }));
  } catch {
    // sessionStorage unavailable/full — cache is a paint optimization only.
  }
}

function openConnectPopup(): void {
  window.open("/onshape/connect", "hub-onshape-connect", "width=480,height=720");
}

/** Inline status badge/select for a linked part — same PATCH pattern as PartStatusCell, but with the panel bearer token instead of a session cookie, and an in-memory update instead of router.refresh(). */
function InlineStatus({
  partId,
  status,
  token,
  onChanged,
}: {
  partId: string;
  status: PartStatus;
  token: string;
  onChanged: (next: PartStatus) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function change(next: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/parts/${partId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: next }),
      });
      if (res.ok) onChanged(next as PartStatus);
    } finally {
      setBusy(false);
    }
  }

  return (
    <select
      aria-label="Status"
      className={`status-${STATUS_TONE[status]}`}
      value={status}
      disabled={busy}
      onChange={(e) => change(e.target.value)}
    >
      {PART_STATUSES.map((s) => (
        <option key={s} value={s}>{STATUS_MAP[s]}</option>
      ))}
    </select>
  );
}

/** Inline create form for an untracked CAD part — collapsed into an Add button until opened. */
function AddPartForm({
  part,
  context,
  projects,
  token,
  onCreated,
  onCancel,
}: {
  part: PanelPart;
  context: PanelContext;
  projects: PanelProject[];
  token: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(part.name);
  const [type, setType] = useState<"part" | "assembly">("part");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const project = projects.find((p) => p.id === projectId);
  const assemblies = project?.assemblies ?? [];
  const [parentPartId, setParentPartId] = useState(assemblies[0]?.id ?? "");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Parent-assembly choices depend on the selected project — reset inline
  // on the project select's onChange rather than an effect (no setState
  // needed on every other render).
  function changeProject(id: string) {
    setProjectId(id);
    const next = projects.find((p) => p.id === id);
    setParentPartId(next?.assemblies[0]?.id ?? "");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (type === "part" && !parentPartId) {
      setError("Choose a parent assembly.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/onshape/panel/parts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          projectId,
          type,
          name,
          parentPartId: parentPartId || undefined,
          onshapeDocumentId: context.documentId,
          onshapeElementId: context.elementId,
          onshapePartId: part.partId,
          sourceMaterial: part.material ?? undefined,
          notes: notes || undefined,
        }),
      });
      if (res.status === 201) {
        onCreated();
      } else if (res.status === 409) {
        setError("Already linked to a hub part.");
      } else {
        setError("Could not create the part — check the fields.");
      }
    } catch {
      setError("Could not create the part — check the fields.");
    } finally {
      setBusy(false);
    }
  }

  if (projects.length === 0) {
    return <p className="text-sm text-[var(--muted)]">Create a project in the hub first.</p>;
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label className="label">Name
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label className="label">Type
        <select className="input" value={type} onChange={(e) => setType(e.target.value as "part" | "assembly")}>
          <option value="part">Part</option>
          <option value="assembly">Assembly</option>
        </select>
      </label>
      <label className="label">Project
        <select className="input" value={projectId} onChange={(e) => changeProject(e.target.value)} required>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      {type === "part" ? (
        <label className="label">Parent assembly
          <select className="input" value={parentPartId} onChange={(e) => setParentPartId(e.target.value)} required>
            {assemblies.length === 0 && <option value="">— create an assembly first —</option>}
            {assemblies.map((a) => <option key={a.id} value={a.id}>{a.fullPartNumber} {a.name}</option>)}
          </select>
        </label>
      ) : (
        <label className="label">Parent assembly (optional)
          <select className="input" value={parentPartId} onChange={(e) => setParentPartId(e.target.value)}>
            <option value="">— Top level —</option>
            {assemblies.map((a) => <option key={a.id} value={a.id}>{a.fullPartNumber} {a.name}</option>)}
          </select>
        </label>
      )}
      <label className="label">Notes (optional)
        <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {error && <p className="text-sm text-[var(--red)]">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="btn btn-primary">
          {busy ? "Adding…" : "Add"}
        </button>
        <button type="button" disabled={busy} className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * The panel itself (spec §4). Runs in an iframe on onshape.com — no hub
 * cookies, so identity comes entirely from a bearer token handed over by the
 * `/onshape/connect` popup via `postMessage` and cached in localStorage
 * (survives the iframe reload Onshape does on every selection change).
 */
export function OnshapePanel({ context }: { context: PanelContext }) {
  // Plain `null` initial state — NOT read from storage here. The server
  // render always has no token, so a lazy initializer that reads localStorage
  // would mismatch the client's first render (hydration error) on every
  // reload after connecting, which is the exact case the warm-paint cache
  // exists for. Both are seeded one microtask after mount instead (below).
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<ContextResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpenId, setAddOpenId] = useState<string | null>(null);

  const hasFullContext = hasFullContextOf(context);

  async function fetchContext(tok: string) {
    if (!hasFullContext) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        documentId: context.documentId!,
        workspaceOrVersion: context.workspaceOrVersion!,
        workspaceOrVersionId: context.workspaceOrVersionId!,
        elementId: context.elementId!,
      });
      if (context.server) params.set("server", context.server);
      const res = await fetch(`/api/onshape/panel/context?${params.toString()}`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (!res.ok) {
        setError("Couldn't load parts.");
        return;
      }
      const json = (await res.json()) as ContextResponse;
      setData(json);
      writeCache(context, json);
    } catch {
      setError("Couldn't load parts.");
    } finally {
      setLoading(false);
    }
  }

  // Seed the warm-cache paint and the stored token one microtask after mount
  // (matches EventForm.tsx's fetch/.then convention for deferring setState
  // out of the effect's synchronous call frame). Not read via lazy useState
  // initializers because the server render always has no token/cache, and a
  // lazy initializer that read storage would mismatch the client's first
  // render (hydration error) on every reload after connecting — exactly the
  // reload this cache exists to paint instantly.
  useEffect(() => {
    void Promise.resolve().then(() => {
      if (hasFullContext) {
        const cached = readCache(context);
        if (cached) setData(cached);
      }
      const stored = localStorage.getItem(TOKEN_KEY);
      if (stored) {
        setToken(stored);
        return fetchContext(stored);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Token handoff + connect signal from the /onshape/connect popup.
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      const msg = e.data as { type?: string; panelToken?: string } | null;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "hub-onshape-panel-token" && typeof msg.panelToken === "string") {
        localStorage.setItem(TOKEN_KEY, msg.panelToken);
        setToken(msg.panelToken);
        void fetchContext(msg.panelToken);
      } else if (msg.type === "hub-onshape-connected") {
        const tok = token ?? localStorage.getItem(TOKEN_KEY);
        if (tok) void fetchContext(tok);
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const errorBanner = error && (
    <p className="text-sm text-[var(--red)]">{error}</p>
  );

  if (!hasFullContext) {
    return (
      <div className="card flex flex-col gap-2">
        <h1 className="text-lg font-bold">Onshape parts</h1>
        <p className="text-sm text-[var(--muted)]">
          Open this panel from a Part Studio in Onshape.
        </p>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="card flex flex-col gap-3">
        <h1 className="text-lg font-bold">Onshape parts</h1>
        <p className="text-sm text-[var(--muted)]">
          Connect your hub account to track parts from this panel.
        </p>
        <button type="button" className="btn btn-primary self-start" onClick={openConnectPopup}>
          Connect
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="card flex flex-col gap-2">
        {errorBanner}
        <p className="text-sm text-[var(--muted)]">{loading ? "Loading parts…" : "No parts loaded yet."}</p>
        {error && (
          <button type="button" className="btn self-start" onClick={() => fetchContext(token)}>
            Retry
          </button>
        )}
      </div>
    );
  }

  if (data.connectionState !== "connected") {
    const reconnect = data.connectionState === "needs_reconnect";
    return (
      <div className="card flex flex-col gap-3">
        {errorBanner}
        <h1 className="text-lg font-bold">{reconnect ? "Reconnect Onshape" : "Connect Onshape"}</h1>
        <p className="text-sm text-[var(--muted)]">
          {reconnect
            ? "Your Onshape connection expired."
            : "Link your Onshape account to see parts in this element."}
        </p>
        <button type="button" className="btn btn-primary self-start" onClick={openConnectPopup}>
          {reconnect ? "Reconnect" : "Connect"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {errorBanner}
      {data.parts.length === 0 && (
        <p className="text-sm text-[var(--muted)]">No parts in this element.</p>
      )}
      {data.parts.map((p) => (
        <div key={p.partId} className="onshape-part-row">
          <div className="onshape-part-name">{p.name}</div>
          <div className="onshape-part-meta">
            {p.material ?? "No material"}
            {p.onshapePartNumber && <> · <span className="font-mono">{p.onshapePartNumber}</span></>}
          </div>
          {p.hubPart ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm">{p.hubPart.fullPartNumber}</span>
              <InlineStatus
                partId={p.hubPart.id}
                status={p.hubPart.status}
                token={token}
                onChanged={(next) =>
                  setData((d) =>
                    d
                      ? {
                          ...d,
                          parts: d.parts.map((row) =>
                            row.partId === p.partId && row.hubPart
                              ? { ...row, hubPart: { ...row.hubPart, status: next } }
                              : row,
                          ),
                        }
                      : d,
                  )
                }
              />
              <a
                href={`/admin/parts/${p.hubPart.id}`}
                target="_blank"
                rel="noreferrer"
                className="btn btn-secondary"
              >
                Open
              </a>
            </div>
          ) : addOpenId === p.partId ? (
            <AddPartForm
              part={p}
              context={context}
              projects={data.projects}
              token={token}
              onCreated={() => {
                setAddOpenId(null);
                void fetchContext(token);
              }}
              onCancel={() => setAddOpenId(null)}
            />
          ) : (
            <button
              type="button"
              className="btn btn-primary self-start"
              onClick={() => setAddOpenId(p.partId)}
            >
              Add
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
