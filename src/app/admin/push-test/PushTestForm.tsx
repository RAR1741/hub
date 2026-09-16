"use client";

import { useState } from "react";
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_META,
  type NotificationType,
} from "@/lib/notification-types";

type Result = { sent: number; pruned: number; unconfigured?: boolean } | { error: string };

export function PushTestForm() {
  const [type, setType] = useState<NotificationType>(NOTIFICATION_TYPES[0]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function send() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/push-test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, title, body, url }),
      });
      const data = (await res.json()) as Result;
      setResult(res.ok ? data : { error: "error" in data ? data.error : "Request failed" });
    } catch {
      setResult({ error: "Request failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="push-test-type" className="font-medium">
          Type
        </label>
        <select
          id="push-test-type"
          value={type}
          onChange={(e) => setType(e.target.value as NotificationType)}
        >
          {NOTIFICATION_TYPES.map((t) => (
            <option key={t} value={t}>
              {NOTIFICATION_META[t].label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="push-test-title" className="font-medium">
          Title
        </label>
        <input
          id="push-test-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={`Defaults to "${NOTIFICATION_META[type].label}"`}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="push-test-body" className="font-medium">
          Body
        </label>
        <input
          id="push-test-body"
          type="text"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder='Defaults to "Test notification"'
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="push-test-url" className="font-medium">
          URL
        </label>
        <input
          id="push-test-url"
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder='Defaults to "/"'
        />
      </div>

      <button type="button" className="btn btn-primary w-full" onClick={send} disabled={busy}>
        {busy ? "Sending…" : "Send test push"}
      </button>

      {result && (
        <p role="status" className="text-sm" style={{ color: "var(--muted)" }}>
          {"error" in result
            ? result.error
            : result.unconfigured
              ? "VAPID keys not configured in this environment"
              : `Sent to ${result.sent} device(s)${result.pruned > 0 ? `, pruned ${result.pruned}` : ""}`}
        </p>
      )}
    </section>
  );
}
