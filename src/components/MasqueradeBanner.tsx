import { getViewer } from "@/lib/viewer";
import { getDb } from "@/lib/db";
import { ExitMasqueradeButton } from "@/components/ExitMasqueradeButton";

function isPersonRow(p: unknown): p is { first_name?: string | null; last_name?: string | null } {
  return typeof p === "object" && p !== null && "first_name" in p;
}

function getName(p: unknown): string {
  if (!p || typeof p !== "object") {
    return "Unknown";
  }
  if (isPersonRow(p)) {
    const fn = p.first_name ?? "";
    const ln = p.last_name ?? "";
    return [fn, ln].filter(Boolean).join(" ") || "Unknown";
  }
  // Person type (camelCase)
  const obj = p as { firstName?: string | null; lastName?: string | null };
  const fn = obj.firstName ?? "";
  const ln = obj.lastName ?? "";
  return [fn, ln].filter(Boolean).join(" ") || "Unknown";
}

export async function MasqueradeBanner() {
  const viewer = await getViewer();

  if (!viewer.masquerade) {
    return null;
  }

  // Get admin person name (select only needed columns to avoid excess PII)
  const db = getDb();
  const { data: adminRow } = await db
    .from("person")
    .select("first_name, last_name")
    .eq("id", viewer.masquerade.adminPersonId)
    .maybeSingle();

  const adminName = adminRow ? getName(adminRow) : "Unknown admin";
  const targetName = viewer.person ? getName(viewer.person) : "Unknown target";

  return (
    <div className="masquerade-banner">
      <div className="flex items-center gap-4 px-4 py-3">
        <div className="flex-1">
          <div className="text-sm font-semibold text-[var(--red-fg)]">
            Viewing as {targetName}
          </div>
          <div className="text-xs text-[var(--red-fg)] opacity-90">
            Admin: {adminName} · Role: <span className={`pill ${viewer.role === "admin" ? "admin" : "role"}`}>{viewer.role}</span>
          </div>
        </div>
        <ExitMasqueradeButton />
      </div>
    </div>
  );
}
