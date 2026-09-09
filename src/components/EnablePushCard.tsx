"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const DISMISSED_KEY = "hub_push_card_dismissed";

export function EnablePushCard() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Deferred a microtask out of the effect's synchronous call frame (matches
    // OnshapePanel.tsx's convention) — the server render always has no
    // storage, so a lazy useState initializer here would mismatch on hydrate.
    void Promise.resolve().then(() => {
      try {
        setShow(localStorage.getItem(DISMISSED_KEY) !== "1");
      } catch {
        setShow(true);
      }
    });
  }, []);

  if (!show) return null;

  return (
    <div className="card flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Turn on notifications to get reminders on your devices.{" "}
        <Link href="/me/notifications" className="font-medium text-[var(--red)]">
          Set up notifications
        </Link>
      </p>
      <button
        type="button"
        className="btn"
        onClick={() => {
          try {
            localStorage.setItem(DISMISSED_KEY, "1");
          } catch {
            // localStorage unavailable — dismiss only lasts this render
          }
          setShow(false);
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
