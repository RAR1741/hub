import type { GithubReconcileResult } from "@/lib/github-team-sync";

/**
 * Renders the last GitHub team reconcile report. Logins resolve to hub names
 * via `nameByLogin`; a login with no match renders as a plain `@login` link
 * to the GitHub profile. No associate modal here (unlike ReconcileReport) —
 * GitHub identity is OAuth-verified only, so there's nothing for an admin to
 * hand-link.
 */
export function GithubReconcileReport({
  report,
  nameByLogin,
}: {
  report: GithubReconcileResult;
  nameByLogin: Record<string, string>;
}) {
  const nameFor = (login: string): string | null => nameByLogin[login.toLowerCase()] ?? null;

  return (
    <>
      <p className="text-sm text-[var(--muted)]">
        Ran at <span className="mono">{new Date(report.ranAt).toLocaleString()}</span>
      </p>
      <div className="flex flex-col gap-4">
        {report.teams.map((t) => (
          <div
            key={t.teamSlug}
            className="flex flex-col gap-2 border-t border-[var(--hair)] pt-3 first:border-t-0 first:pt-0"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">
                {t.teamName} <span className="text-[var(--muted)]">({t.teamSlug})</span>
              </span>
              <span className="text-xs text-[var(--muted)]">
                {t.actualCount} actual / {t.expectedCount} expected
              </span>
            </div>
            <LoginList label="Added" logins={t.added} nameFor={nameFor} />
            <LoginList label="Pending" logins={t.pending} nameFor={nameFor} />
            <LoginList
              label="Would remove"
              logins={t.wouldRemove.map((u) => u.login)}
              nameFor={nameFor}
            />
            {t.notConnected.length > 0 && (
              <div className="text-sm">
                <span className="font-medium">Not connected: </span>
                {t.notConnected.join(", ")}
              </div>
            )}
            {t.errors.length > 0 && (
              <div className="text-sm text-[var(--red)]">
                <span className="font-medium">Errors: </span>
                {t.errors.join("; ")}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function LoginList({
  label,
  logins,
  nameFor,
}: {
  label: string;
  logins: string[];
  nameFor: (login: string) => string | null;
}) {
  if (logins.length === 0) return null;
  return (
    <div className="text-sm">
      <span className="font-medium">{label}: </span>
      {logins.map((login, i) => {
        const name = nameFor(login);
        return (
          <span key={login}>
            {i > 0 && ", "}
            {name ? (
              <span>{name}</span>
            ) : (
              <a
                href={`https://github.com/${login}`}
                target="_blank"
                rel="noreferrer"
                className="link-btn"
              >
                @{login}
              </a>
            )}
          </span>
        );
      })}
    </div>
  );
}
