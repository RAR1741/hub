"use client";

import { useState } from "react";

export function AccountRequestForm() {
  const [state, setState] = useState<"idle" | "sent" | "error">("idle");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const gradYearRaw = String(form.get("gradYear") ?? "").trim();
    const res = await fetch("/api/account-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: form.get("firstName"),
        lastName: form.get("lastName"),
        gradYear: gradYearRaw ? Number(gradYearRaw) : undefined,
        email: form.get("email") || undefined,
      }),
    });
    setState(res.ok ? "sent" : "error");
  }

  if (state === "sent") {
    return (
      <p className="text-sm text-[var(--color-present)]">
        Request sent! A mentor will set you up at the next meeting.
      </p>
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <input className="input" name="firstName" placeholder="First name" required />
      <input className="input" name="lastName" placeholder="Last name" required />
      <input
        className="input"
        name="gradYear"
        placeholder="Grad year (optional)"
        inputMode="numeric"
      />
      <input className="input" name="email" placeholder="Email (optional)" type="email" />
      <button type="submit" className="btn btn-secondary w-full">
        Request an account
      </button>
      {state === "error" && (
        <p role="alert" className="text-sm text-[var(--color-absent)]">
          Something went wrong — try again.
        </p>
      )}
    </form>
  );
}
