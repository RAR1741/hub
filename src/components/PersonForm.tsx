"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type PersonFormValues = {
  firstName: string; lastName: string; displayName: string; role: string;
  gradYear: string; email: string; phone: string; shirtSize: string;
  dietaryRestrictions: string; bio: string; studentIdNumber: string;
  isActive: boolean;
  dateOfBirth: string; streetAddress: string; city: string; zip: string;
  homePhone: string; school: string; ethnicity: string; race: string;
  interests: string;
};

const EMPTY: PersonFormValues = {
  firstName: "", lastName: "", displayName: "", role: "student",
  gradYear: "", email: "", phone: "", shirtSize: "",
  dietaryRestrictions: "", bio: "", studentIdNumber: "", isActive: true,
  dateOfBirth: "", streetAddress: "", city: "", zip: "",
  homePhone: "", school: "", ethnicity: "", race: "", interests: "",
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
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  function set<K extends keyof PersonFormValues>(k: K, v: PersonFormValues[K]) {
    setValues((prev) => ({ ...prev, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    setBusy(true);
    try {
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
        dateOfBirth: values.dateOfBirth || undefined,
        streetAddress: values.streetAddress || undefined,
        city: values.city || undefined,
        zip: values.zip || undefined,
        homePhone: values.homePhone || undefined,
        school: values.school || undefined,
        ethnicity: values.ethnicity || undefined,
        race: values.race || undefined,
        // Comma-separated in the UI; the server splits/normalizes into text[].
        interests: values.interests || undefined,
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
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="label">First name <input className="input" value={values.firstName} onChange={(e) => set("firstName", e.target.value)} required /></label>
      <label className="label">Last name <input className="input" value={values.lastName} onChange={(e) => set("lastName", e.target.value)} required /></label>
      <label className="label">Display name <input className="input" value={values.displayName} onChange={(e) => set("displayName", e.target.value)} /></label>
      <label className="label">Role{" "}
        <select className="input" value={values.role} onChange={(e) => set("role", e.target.value)}>
          <option value="student">student</option>
          <option value="mentor">mentor</option>
          <option value="admin">admin</option>
        </select>
      </label>
      <label className="label">Grad year <input className="input" inputMode="numeric" value={values.gradYear} onChange={(e) => set("gradYear", e.target.value)} /></label>
      <label className="label">Email <input className="input" type="email" value={values.email} onChange={(e) => set("email", e.target.value)} /></label>
      <label className="label">Phone <input className="input" value={values.phone} onChange={(e) => set("phone", e.target.value)} /></label>
      <label className="label">Shirt size <input className="input" value={values.shirtSize} onChange={(e) => set("shirtSize", e.target.value)} /></label>
      <label className="label">Dietary restrictions <input className="input" value={values.dietaryRestrictions} onChange={(e) => set("dietaryRestrictions", e.target.value)} /></label>
      <label className="label">Bio <textarea className="input" value={values.bio} onChange={(e) => set("bio", e.target.value)} /></label>
      <label className="label">Student ID <input className="input" value={values.studentIdNumber} onChange={(e) => set("studentIdNumber", e.target.value)} /></label>
      <label className="label">Date of birth <input className="input" type="date" value={values.dateOfBirth} onChange={(e) => set("dateOfBirth", e.target.value)} /></label>
      <label className="label">Home phone <input className="input" value={values.homePhone} onChange={(e) => set("homePhone", e.target.value)} /></label>
      <label className="label">School <input className="input" value={values.school} onChange={(e) => set("school", e.target.value)} /></label>
      <label className="label">Street address <input className="input" value={values.streetAddress} onChange={(e) => set("streetAddress", e.target.value)} /></label>
      <label className="label">City <input className="input" value={values.city} onChange={(e) => set("city", e.target.value)} /></label>
      <label className="label">Zip <input className="input" value={values.zip} onChange={(e) => set("zip", e.target.value)} /></label>
      <label className="label">Ethnicity <input className="input" value={values.ethnicity} onChange={(e) => set("ethnicity", e.target.value)} /></label>
      <label className="label">Race <input className="input" value={values.race} onChange={(e) => set("race", e.target.value)} /></label>
      <label className="label">Interests <span className="text-xs text-[var(--color-muted-fg)]">(comma-separated)</span> <input className="input" value={values.interests} onChange={(e) => set("interests", e.target.value)} /></label>
      <label className="flex items-center gap-2 text-sm font-medium text-[var(--color-muted-fg)]">Active <input type="checkbox" checked={values.isActive} onChange={(e) => set("isActive", e.target.checked)} /></label>
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : personId ? "Save changes" : "Create person"}</button>
      {status && <p role="status" className="text-sm text-[var(--color-muted-fg)]">{status}</p>}
    </form>
  );
}
