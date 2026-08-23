import { discardOnshapeToken } from "@/lib/onshape";
import { OnshapePanel } from "@/components/OnshapePanel";

// Right-panel action URL (spec §7) hands the Onshape selection context as
// query params, some unsubstituted -> literal `{$...}` tokens. Onshape
// re-navigates this iframe on every selection change, so the panel always
// needs a fresh server render (never cache the shell).
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function OnshapePanelPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const context = {
    documentId: discardOnshapeToken(sp.documentId),
    workspaceOrVersion: discardOnshapeToken(sp.workspaceOrVersion),
    workspaceOrVersionId: discardOnshapeToken(sp.workspaceOrVersionId),
    elementId: discardOnshapeToken(sp.elementId),
    server: discardOnshapeToken(sp.server),
  };

  return (
    <main className="onshape-panel">
      <OnshapePanel context={context} />
    </main>
  );
}
