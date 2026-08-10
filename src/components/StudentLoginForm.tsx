"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function StudentLoginForm() {
  const [studentId, setStudentId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/auth/student", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId }),
    });
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      setError("ID not recognized. Check with a mentor.");
    }
  }

  return (
    <form onSubmit={submit}>
      <label>
        Student ID
        <input
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
          autoFocus
          required
        />
      </label>
      <button type="submit">Sign in</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
