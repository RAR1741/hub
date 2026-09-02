"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TeamAddRecommendations } from "@/lib/drive-group-sync";

type RowState = "idle" | "adding" | "failed";

export function RecommendedMembers({
  teams,
  ranAt,
  teamTz,
  description,
}: {
  teams: TeamAddRecommendations[];
  ranAt: string;
  teamTz: string;
  description: string;
}) {
  const router = useRouter();
  // key: `${teamId}:${personId}` -> row state
  const [state, setState] = useState<Record<string, RowState>>({});
  const [busyTeam, setBusyTeam] = useState<string | null>(null);

  function keyFor(teamId: string, personId: string) {
    return `${teamId}:${personId}`;
  }

  async function addOne(teamId: string, personId: string): Promise<boolean> {
    const k = keyFor(teamId, personId);
    setState((s) => ({ ...s, [k]: "adding" }));
    try {
      const res = await fetch(`/api/admin/teams/${teamId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId }),
      });
      if (res.ok) {
        setState((s) => ({ ...s, [k]: "idle" }));
        return true;
      }
      setState((s) => ({ ...s, [k]: "failed" }));
      return false;
    } catch {
      setState((s) => ({ ...s, [k]: "failed" }));
      return false;
    }
  }

  async function addOneAndRefresh(teamId: string, personId: string) {
    const ok = await addOne(teamId, personId);
    if (ok) router.refresh();
  }

  async function addAll(team: TeamAddRecommendations) {
    if (busyTeam) return;
    setBusyTeam(team.teamId);
    let anyOk = false;
    // Sequential: each add triggers a Google Directory call; keeps failures attributable.
    for (const p of team.people) {
      const ok = await addOne(team.teamId, p.personId);
      anyOk = anyOk || ok;
    }
    setBusyTeam(null);
    if (anyOk) router.refresh();
  }

  return (
    <section className="card flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">Recommended members</h2>
        <p className="text-sm text-[var(--muted)]">
          {description} Based on the sync from{" "}
          <span className="mono">{new Date(ranAt).toLocaleString(undefined, { timeZone: teamTz })}</span>.
        </p>
      </div>

      {teams.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No recommendations.</p>
      ) : (
        teams.map((team) => (
          <div
            key={team.teamId}
            className="flex flex-col gap-2 border-t border-[var(--hair)] pt-3 first:border-t-0 first:pt-0"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">{team.teamName}</span>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busyTeam === team.teamId}
                onClick={() => addAll(team)}
              >
                {busyTeam === team.teamId ? "Adding…" : "Add all to team"}
              </button>
            </div>
            <ul className="flex flex-col gap-1">
              {team.people.map((p) => {
                const st = state[keyFor(team.teamId, p.personId)] ?? "idle";
                return (
                  <li key={p.personId} className="flex items-center justify-between gap-3 text-sm">
                    <span>
                      {p.name}{" "}
                      <span className="mono text-[var(--muted)]">({p.labels.join(", ")})</span>
                    </span>
                    <span className="flex items-center gap-2">
                      {st === "failed" && <span className="text-xs text-[var(--red)]">failed</span>}
                      <button
                        type="button"
                        className="btn"
                        disabled={st === "adding" || busyTeam === team.teamId}
                        onClick={() => addOneAndRefresh(team.teamId, p.personId)}
                      >
                        {st === "adding" ? "Adding…" : "Add"}
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
