"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type TeamFormValues = {
  name: string;
  parentTeamId: string;
  description: string;
  joinMode: string;
  googleGroupEmail: string;
  githubTeamSlug: string;
  slackChannels: { channelId: string; label: string }[];
};

export function TeamForm({
  teams,
  initial,
  teamId,
}: {
  teams: { id: string; name: string }[]; // parent options
  initial?: TeamFormValues;
  teamId?: string; // present = edit
}) {
  const EMPTY: TeamFormValues = {
    name: "", parentTeamId: "", description: "", joinMode: "admin_only", googleGroupEmail: "", githubTeamSlug: "", slackChannels: [],
  };
  const [values, setValues] = useState<TeamFormValues>(initial ?? EMPTY);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    setBusy(true);
    try {
      const res = await fetch(teamId ? `/api/admin/teams/${teamId}` : "/api/admin/teams", {
        method: teamId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          parentTeamId: values.parentTeamId || undefined,
          description: values.description || undefined,
          joinMode: values.joinMode,
          googleGroupEmail: values.googleGroupEmail || undefined,
          githubTeamSlug: values.githubTeamSlug || undefined,
          slackChannels: values.slackChannels
            .filter((c) => c.channelId.trim())
            .map((c) => ({ channelId: c.channelId.trim(), label: c.label.trim() || null })),
        }),
      });
      if (res.ok) {
        if (teamId) {
          setStatus("Saved.");
          router.refresh();
        } else {
          const { id } = (await res.json()) as { id: string };
          router.push(`/admin/teams/${id}`);
        }
      } else if (res.status === 409) {
        setStatus("A team with that name already exists.");
      } else {
        setStatus("Save failed — check the fields.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="label">Name <input className="input" value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} required /></label>
      <label className="label">Parent{" "}
        <select className="input" value={values.parentTeamId} onChange={(e) => setValues({ ...values, parentTeamId: e.target.value })}>
          <option value="">(none — top level)</option>
          {teams.filter((t) => t.id !== teamId).map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </label>
      <label className="label">Description <input className="input" value={values.description} onChange={(e) => setValues({ ...values, description: e.target.value })} /></label>
      <label className="label">Google Group email
        <input
          className="input"
          type="email"
          value={values.googleGroupEmail}
          onChange={(e) => setValues({ ...values, googleGroupEmail: e.target.value })}
        />
        <span className="text-sm text-[var(--muted)]">
          Members of this team are synced into this Workspace group. Leave blank to disable.
        </span>
      </label>
      <label className="label">GitHub team slug
        <input
          className="input"
          type="text"
          placeholder="software"
          value={values.githubTeamSlug}
          onChange={(e) => setValues({ ...values, githubTeamSlug: e.target.value })}
        />
      </label>
      <div className="label">
        Slack channels
        <div className="flex flex-col gap-2">
          {values.slackChannels.map((c, i) => (
            <div key={i} className="flex gap-2">
              <input
                className="input"
                type="text"
                placeholder="C0123ABC"
                value={c.channelId}
                onChange={(e) => {
                  const slackChannels = [...values.slackChannels];
                  slackChannels[i] = { ...slackChannels[i], channelId: e.target.value };
                  setValues({ ...values, slackChannels });
                }}
              />
              <input
                className="input"
                type="text"
                placeholder="#frc"
                value={c.label}
                onChange={(e) => {
                  const slackChannels = [...values.slackChannels];
                  slackChannels[i] = { ...slackChannels[i], label: e.target.value };
                  setValues({ ...values, slackChannels });
                }}
              />
              <button
                type="button"
                className="btn"
                onClick={() => setValues({ ...values, slackChannels: values.slackChannels.filter((_, j) => j !== i) })}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => setValues({ ...values, slackChannels: [...values.slackChannels, { channelId: "", label: "" }] })}
        >
          Add channel
        </button>
        <span className="text-sm text-[var(--muted)]">
          Members of this team are auto-invited to these Slack channels. The bot must already be in each channel.
        </span>
      </div>
      <label className="label">Join mode{" "}
        <select className="input" value={values.joinMode} onChange={(e) => setValues({ ...values, joinMode: e.target.value })}>
          <option value="admin_only">admin only</option>
          <option value="open">open</option>
          <option value="requires_approval">requires approval</option>
        </select>
      </label>
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : teamId ? "Save changes" : "Create team"}</button>
      {status && <p role="status" className="text-sm text-[var(--muted)]">{status}</p>}
    </form>
  );
}
