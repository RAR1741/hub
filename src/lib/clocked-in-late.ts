// src/lib/clocked-in-late.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { pushDepsFromEnv, sendPushToOptedIn, type PushDeps } from "./push-dispatch";

export async function pushClockedInLate(deps: {
  db: SupabaseClient;
  push?: PushDeps;
}): Promise<{ sent: number; pruned: number }> {
  const { data, error } = await deps.db.from("session").select("person_id").is("time_out", null);
  if (error) {
    console.error("[clocked-in-late] load open sessions failed:", error.message);
    return { sent: 0, pruned: 0 };
  }
  const ids = [...new Set(((data ?? []) as { person_id: string }[]).map((r) => r.person_id))];
  if (ids.length === 0) return { sent: 0, pruned: 0 };
  return sendPushToOptedIn(
    ids,
    "clocked_in_late",
    { title: "Still clocked in", body: "Forget to clock out?", url: "/me/attendance" },
    { db: deps.db, push: deps.push ?? pushDepsFromEnv() },
  );
}
