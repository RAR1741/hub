"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import type { Person } from "@/lib/types";

/** Only the fields the roster renders — keeps the server→client payload small. */
export type PeopleRow = Pick<
  Person,
  "id" | "firstName" | "lastName" | "email" | "role" | "isActive" | "studentIdNumber"
>;

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function matches(p: PeopleRow, term: string): boolean {
  if (term === "") return true;
  const t = term.toLowerCase();
  return (
    `${p.firstName} ${p.lastName}`.toLowerCase().includes(t) ||
    (p.email?.toLowerCase().includes(t) ?? false) ||
    (p.studentIdNumber?.toLowerCase().includes(t) ?? false)
  );
}

function PeopleColumn({
  title,
  rows,
  canEdit,
  emptyHint,
}: {
  title: string;
  rows: PeopleRow[];
  canEdit: boolean;
  emptyHint: string;
}) {
  return (
    <section className="card flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
          {title}
        </h2>
        <span className="count">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-[var(--muted)]">{emptyHint}</p>
      ) : (
        <div className="tablewrap">
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>ID</th>
                  <th>Status</th>
                  {canEdit && <th aria-label="Edit" />}
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const name = `${p.firstName} ${p.lastName}`;
                  return (
                    <tr key={p.id}>
                      <td>
                        <Link href={`/people/${p.id}`} className="name-cell hover:no-underline">
                          <span className="avatar" aria-hidden="true">
                            {initials(name)}
                          </span>
                          <span>
                            <div className="nm" style={{ color: "var(--ink)" }}>
                              {name}
                            </div>
                            {p.email && <div className="em">{p.email}</div>}
                          </span>
                        </Link>
                      </td>
                      <td>
                        <span className="sid">{p.studentIdNumber ?? "—"}</span>
                      </td>
                      <td>
                        <span className={`pill ${p.isActive ? "on" : "off"}`}>
                          {p.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      {canEdit && (
                        <td>
                          <Link
                            href={`/admin/people/${p.id}`}
                            className="btn icon"
                            aria-label={`Edit ${name}`}
                          >
                            <Icon name="edit" />
                          </Link>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

export function PeopleBrowser({
  people,
  canEdit,
}: {
  people: PeopleRow[];
  canEdit: boolean;
}) {
  const [search, setSearch] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);

  const { students, mentors } = useMemo(() => {
    const visible = people.filter(
      (p) => (includeInactive || p.isActive) && matches(p, search),
    );
    return {
      students: visible.filter((p) => p.role === "student"),
      // Mentors column holds mentors and admins, mirroring the leaderboard split.
      mentors: visible.filter((p) => p.role !== "student"),
    };
  }, [people, search, includeInactive]);

  const searching = search.trim() !== "";

  return (
    <div className="flex flex-col gap-6">
      <div className="card flex flex-wrap items-center gap-x-5 gap-y-3">
        <label className="search" style={{ maxWidth: "24rem" }}>
          <Icon name="search" />
          <input
            aria-label="Search people"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, or ID…"
          />
        </label>
        <label className="flex cursor-pointer select-none items-center gap-2 text-sm font-medium text-[var(--muted)]">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          Include inactive
        </label>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PeopleColumn
          title="Students"
          rows={students}
          canEdit={canEdit}
          emptyHint={searching ? "No students match your search." : "No active students."}
        />
        <PeopleColumn
          title="Mentors"
          rows={mentors}
          canEdit={canEdit}
          emptyHint={searching ? "No mentors match your search." : "No active mentors."}
        />
      </div>
    </div>
  );
}
