import type { ReactNode } from "react";
import type { TeamNode } from "@/lib/teams";

/** Recursive branch: renders a node's card plus a horizontal row of its
 *  children beneath it. Only walks `children` — buildTeamTree already drops
 *  cycle members when building the tree, so this can't infinite-loop. */
function Branch({ node, renderNode }: { node: TeamNode; renderNode: (n: TeamNode) => ReactNode }) {
  return (
    <li>
      <div className="team-tree-card">{renderNode(node)}</div>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <Branch key={child.id} node={child} renderNode={renderNode} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Top-down org-chart view of one or more team trees. Each root gets its own
 *  `.team-tree`, stacked vertically; wrapped in a horizontally-scrolling div
 *  so wide trees never overflow the page body. */
export function TeamTreeView({
  roots,
  renderNode,
}: {
  roots: TeamNode[];
  renderNode: (n: TeamNode) => ReactNode;
}) {
  if (roots.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <div className="flex flex-col gap-8">
        {roots.map((root) => (
          <ul className="team-tree" key={root.id}>
            <Branch node={root} renderNode={renderNode} />
          </ul>
        ))}
      </div>
    </div>
  );
}
