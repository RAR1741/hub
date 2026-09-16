"use client";

import { useState } from "react";
import { ReminderPicker } from "@/components/ReminderPicker";

type TypeRow = { type: string; label: string; description: string; enabled: boolean };

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

const PUSH_SUPPORTED =
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;

export function NotificationSettings({
  configured,
  publicKey,
  types,
  meetingReminderMinutes,
}: {
  configured: boolean;
  publicKey: string;
  types: TypeRow[];
  meetingReminderMinutes: number[];
}) {
  const [rows, setRows] = useState(types);
  const [deviceOn, setDeviceOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [leadMinutes, setLeadMinutes] = useState(meetingReminderMinutes);

  async function enableDevice() {
    setBusy(true);
    setMsg(null);
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setMsg(
          "This browser doesn't support push notifications. On iOS, add this app to your home screen first (Share → Add to Home Screen), then try again from there.",
        );
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMsg("Notification permission denied.");
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      setDeviceOn(res.ok);
      setMsg(res.ok ? "This device is enabled." : "Failed to register this device.");
    } catch {
      setMsg("Could not enable push on this device.");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(type: string, enabled: boolean) {
    setRows((rs) => rs.map((r) => (r.type === type ? { ...r, enabled } : r)));
    try {
      const res = await fetch("/api/notifications/prefs", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, enabled }),
      });
      if (!res.ok) {
        setRows((rs) => rs.map((r) => (r.type === type ? { ...r, enabled: !enabled } : r)));
      }
    } catch {
      setRows((rs) => rs.map((r) => (r.type === type ? { ...r, enabled: !enabled } : r)));
    }
  }

  async function updateLeadMinutes(next: number[]) {
    const prev = leadMinutes;
    setLeadMinutes(next);
    try {
      const res = await fetch("/api/notifications/prefs", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ meetingReminderMinutes: next }),
      });
      if (!res.ok) setLeadMinutes(prev);
    } catch {
      setLeadMinutes(prev);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="card flex flex-col gap-3">
        <h2 className="text-lg font-semibold">This device</h2>
        <button
          type="button"
          className="btn btn-primary w-full"
          onClick={enableDevice}
          disabled={!configured || busy || deviceOn}
        >
          {deviceOn ? "Device enabled" : busy ? "Enabling…" : "Enable on this device"}
        </button>
        {!PUSH_SUPPORTED && (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            iOS: add this app to your home screen (Share → Add to Home Screen) to enable push.
          </p>
        )}
        {msg && (
          <p role="status" className="text-sm" style={{ color: "var(--muted)" }}>
            {msg}
          </p>
        )}
      </section>

      <section className="card flex flex-col gap-3">
        <h2 className="text-lg font-semibold">What you get notified about</h2>
        <ul className="flex flex-col gap-3">
          {rows.map((r) => (
            <li key={r.type}>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={r.enabled}
                  onChange={(e) => toggle(r.type, e.target.checked)}
                  data-testid={`toggle-${r.type}`}
                />
                <span>
                  <span className="font-medium">{r.label}</span>
                  <br />
                  <span className="text-sm" style={{ color: "var(--muted)" }}>
                    {r.description}
                  </span>
                </span>
              </label>
              {r.type === "meeting_reminder" && r.enabled && (
                <ReminderPicker
                  legend="How far ahead"
                  testIdPrefix="lead"
                  value={leadMinutes}
                  onChange={updateLeadMinutes}
                />
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
