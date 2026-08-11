"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type PersonFormValues = {
  firstName: string; lastName: string; displayName: string; role: string;
  gradYear: string; email: string; phone: string; shirtSize: string;
  dietaryRestrictions: string; bio: string; studentIdNumber: string;
  isActive: boolean;
};

const EMPTY: PersonFormValues = {
  firstName: "", lastName: "", displayName: "", role: "student",
  gradYear: "", email: "", phone: "", shirtSize: "",
  dietaryRestrictions: "", bio: "", studentIdNumber: "", isActive: true,
};

export function PersonForm({
  initial,
  personId,
}: {
  initial?: PersonFormValues;
  personId?: string; // present = edit (PATCH), absent = create (POST)
}) {
  const [values, setValues] = useState<PersonFormValues>(initial ?? EMPTY);
  const [status, setStatus] = useState<string | null>(null);
  const router = useRouter();

  function set<K extends keyof PersonFormValues>(k: K, v: PersonFormValues[K]) {
    setValues((prev) => ({ ...prev, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    const payload = {
      firstName: values.firstName,
      lastName: values.lastName,
      displayName: values.displayName || undefined,
      role: values.role,
      gradYear: values.gradYear ? Number(values.gradYear) : undefined,
      email: values.email || undefined,
      phone: values.phone || undefined,
      shirtSize: values.shirtSize || undefined,
      dietaryRestrictions: values.dietaryRestrictions || undefined,
      bio: values.bio || undefined,
      studentIdNumber: values.studentIdNumber || undefined,
      isActive: values.isActive,
    };
    const res = await fetch(
      personId ? `/api/admin/people/${personId}` : "/api/admin/people",
      {
        method: personId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    if (res.ok) {
      setStatus("Saved.");
      router.refresh();
      if (!personId) setValues(EMPTY);
    } else if (res.status === 409) {
      setStatus("Email or student ID already in use.");
    } else {
      setStatus("Save failed — check the fields.");
    }
  }

  return (
    <form onSubmit={submit}>
      <label>First name <input value={values.firstName} onChange={(e) => set("firstName", e.target.value)} required /></label>
      <label>Last name <input value={values.lastName} onChange={(e) => set("lastName", e.target.value)} required /></label>
      <label>Display name <input value={values.displayName} onChange={(e) => set("displayName", e.target.value)} /></label>
      <label>Role{" "}
        <select value={values.role} onChange={(e) => set("role", e.target.value)}>
          <option value="student">student</option>
          <option value="captain">captain</option>
          <option value="mentor">mentor</option>
          <option value="admin">admin</option>
        </select>
      </label>
      <label>Grad year <input inputMode="numeric" value={values.gradYear} onChange={(e) => set("gradYear", e.target.value)} /></label>
      <label>Email <input type="email" value={values.email} onChange={(e) => set("email", e.target.value)} /></label>
      <label>Phone <input value={values.phone} onChange={(e) => set("phone", e.target.value)} /></label>
      <label>Shirt size <input value={values.shirtSize} onChange={(e) => set("shirtSize", e.target.value)} /></label>
      <label>Dietary restrictions <input value={values.dietaryRestrictions} onChange={(e) => set("dietaryRestrictions", e.target.value)} /></label>
      <label>Bio <textarea value={values.bio} onChange={(e) => set("bio", e.target.value)} /></label>
      <label>Student ID <input value={values.studentIdNumber} onChange={(e) => set("studentIdNumber", e.target.value)} /></label>
      <label>Active <input type="checkbox" checked={values.isActive} onChange={(e) => set("isActive", e.target.checked)} /></label>
      <button type="submit">{personId ? "Save changes" : "Create person"}</button>
      {status && <p role="status">{status}</p>}
    </form>
  );
}
