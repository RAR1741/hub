"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { Avatar } from "@/components/ui/Avatar";
import { sortByName } from "@/lib/name-sort";
import { filterPeople, ROLE_OPTIONS, type PeopleRow, type RoleFilter } from "@/lib/people-filter";

export type { PeopleRow } from "@/lib/people-filter";

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

export function PeopleBrowser({
  people,
  canEdit,
}: {
  people: PeopleRow[];
  canEdit: boolean;
}) {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<RoleFilter>("all");
  const [includeInactive, setIncludeInactive] = useState(false); // default: Active only

  const visible = useMemo(
    () => sortByName(filterPeople(people, { search, role, includeInactive })),
    [people, search, role, includeInactive],
  );

  const searching = search.trim() !== "";
  const noun = { all: "members", student: "students", mentor: "mentors", admin: "admins" }[role];
  const emptyMessage = searching
    ? `No ${noun} match your search.`
    : `No ${includeInactive ? "" : "active "}${noun}.`;

  return (
    <div className="flex flex-col gap-6">
      <div className="card flex flex-wrap items-center gap-x-5 gap-y-3">
        <label className="search basis-full">
          <Icon name="search" />
          <input
            aria-label="Search people"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, or ID…"
          />
        </label>
        <fieldset className="seg">
          <legend className="sr-only">Role</legend>
          {ROLE_OPTIONS.map(([value, label]) => (
            <label key={value}>
              <input
                type="radio"
                name="people-role"
                value={value}
                checked={role === value}
                onChange={() => setRole(value)}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <fieldset className="seg ml-auto">
          <legend className="sr-only">Status</legend>
          <label>
            <input
              type="radio"
              name="people-status"
              checked={!includeInactive}
              onChange={() => setIncludeInactive(false)}
            />
            <span>Active only</span>
          </label>
          <label>
            <input
              type="radio"
              name="people-status"
              checked={includeInactive}
              onChange={() => setIncludeInactive(true)}
            />
            <span>Include inactive</span>
          </label>
        </fieldset>
      </div>
      <section className="card flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
            Roster
          </h2>
          <span className="count">{visible.length}</span>
        </div>
        {visible.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--muted)]">{emptyMessage}</p>
        ) : (
          <div className="tablewrap">
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Role</th>
                    <th>Status</th>
                    {canEdit && <th aria-label="Edit" />}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => {
                    const name = `${p.firstName} ${p.lastName}`;
                    return (
                      <tr key={p.id}>
                        <td>
                          <Link href={`/people/${p.id}`} className="name-cell hover:no-underline">
                            <Avatar initials={initials(name)} role={p.role} />
                            <span>
                              <div className="nm" style={{ color: "var(--ink)" }}>
                                {name}
                              </div>
                            </span>
                          </Link>
                        </td>
                        <td>
                          <span className={`pill ${p.role === "admin" ? "admin" : "role"}`}>
                            {p.role}
                          </span>
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
    </div>
  );
}
