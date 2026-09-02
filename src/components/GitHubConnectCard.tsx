import { GitHubDisconnectButton } from "@/components/GitHubDisconnectButton";

const STATUS_MESSAGE: Record<string, { text: string; isError?: boolean }> = {
  connected: { text: "GitHub account connected." },
  taken: { text: "That GitHub account is already linked to another person.", isError: true },
  error: { text: "Couldn't connect that GitHub account. Please try again.", isError: true },
};

/**
 * GitHub connection status/actions for a person's profile. Server component —
 * the only interactivity (Disconnect) is a tiny client child, same split as
 * the rest of this page's cards.
 */
export function GitHubConnectCard({
  githubLogin,
  personId,
  isSelf,
  isAdmin,
  status,
}: {
  githubLogin: string | null;
  personId: string;
  isSelf: boolean;
  isAdmin: boolean;
  status?: string;
}) {
  const message = status ? STATUS_MESSAGE[status] : undefined;

  return (
    <section className="card flex flex-col gap-3">
      <h2 className="text-lg font-semibold">GitHub</h2>
      {message && (
        <p className={`text-sm ${message.isError ? "text-[var(--red)]" : "text-[var(--muted)]"}`}>
          {message.text}
        </p>
      )}
      {githubLogin ? (
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={`https://github.com/${githubLogin}`}
            target="_blank"
            rel="noreferrer"
            className="link-btn"
          >
            @{githubLogin}
          </a>
          {(isSelf || isAdmin) && <GitHubDisconnectButton personId={personId} />}
        </div>
      ) : isSelf ? (
        <a href="/api/github/oauth/start" className="btn">
          Connect GitHub
        </a>
      ) : (
        <p className="text-sm text-[var(--muted)]">Not connected.</p>
      )}
    </section>
  );
}
