"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

const CODE_LENGTH = 8;

export function EmailOtpForm() {
  const [phase, setPhase] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(""));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const router = useRouter();
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  async function requestCode(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.status === 429) {
        setError("Too many attempts — try again in a minute.");
      } else if (res.ok) {
        setDigits(Array(CODE_LENGTH).fill(""));
        setPhase("code");
      } else {
        setError("Couldn't send a code. Check the email and try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function verify(code: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      if (res.ok) {
        router.push("/");
        router.refresh();
      } else if (res.status === 429) {
        setError("Too many attempts — try again in a minute.");
      } else {
        setError("That code didn't work. Check it or request a new one.");
        setDigits(Array(CODE_LENGTH).fill(""));
        inputRefs.current[0]?.focus();
      }
    } finally {
      setBusy(false);
    }
  }

  function setDigit(index: number, value: string) {
    const next = [...digits];
    next[index] = value;
    setDigits(next);
    if (next.every((d) => d.length === 1)) {
      verify(next.join(""));
    }
  }

  function handleDigitChange(index: number, raw: string) {
    const value = raw.replace(/\D/g, "").slice(-1);
    setDigit(index, value);
    if (value && index < CODE_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      e.preventDefault();
      setDigit(index - 1, "");
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === "ArrowLeft" && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < CODE_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "");
    if (pasted.length === CODE_LENGTH) {
      e.preventDefault();
      const next = pasted.split("");
      setDigits(next);
      inputRefs.current[CODE_LENGTH - 1]?.focus();
      verify(next.join(""));
    }
  }

  if (phase === "email") {
    return (
      <form onSubmit={requestCode} className="flex flex-col gap-3">
        <label className="label">
          Email
          <input
            className="input mt-1"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            required
          />
        </label>
        <button type="submit" className="btn btn-primary w-full" disabled={busy}>
          Sign in
        </button>
        {error && (
          <p role="alert" className="text-sm" style={{ color: "var(--absent)" }}>
            {error}
          </p>
        )}
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p aria-live="polite" className="text-sm">
        A one-time code has been sent to {email}.
      </p>
      <div className="flex items-center justify-center gap-2">
        {digits.slice(0, 4).map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              inputRefs.current[i] = el;
            }}
            className="input text-center"
            style={{ width: "2.5rem" }}
            inputMode="numeric"
            maxLength={1}
            aria-label={`Code digit ${i + 1}`}
            value={d}
            onChange={(e) => handleDigitChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={handlePaste}
          />
        ))}
        <span aria-hidden="true">-</span>
        {digits.slice(4, 8).map((d, i) => (
          <input
            key={i + 4}
            ref={(el) => {
              inputRefs.current[i + 4] = el;
            }}
            className="input text-center"
            style={{ width: "2.5rem" }}
            inputMode="numeric"
            maxLength={1}
            aria-label={`Code digit ${i + 5}`}
            value={d}
            onChange={(e) => handleDigitChange(i + 4, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i + 4, e)}
            onPaste={handlePaste}
          />
        ))}
      </div>
      <button
        type="button"
        className="btn btn-primary w-full"
        disabled={busy || digits.some((d) => !d)}
        onClick={() => verify(digits.join(""))}
      >
        Verify
      </button>
      <div className="flex items-center justify-between text-sm">
        <button
          type="button"
          className="underline"
          onClick={() => {
            setPhase("email");
            setError(null);
          }}
        >
          Use a different email
        </button>
        <button
          type="button"
          className="underline"
          disabled={resendBusy}
          onClick={async () => {
            setResendBusy(true);
            try {
              await requestCode();
            } finally {
              setResendBusy(false);
            }
          }}
        >
          Resend code
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm" style={{ color: "var(--absent)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
