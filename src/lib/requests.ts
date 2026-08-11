import type { SupabaseClient } from "@supabase/supabase-js";
import { createPerson } from "./people";
import { upsertMember } from "./teams";
import { reqString } from "./validate";

export type AccountRequestRow = {
  id: string;
  first_name: string;
  last_name: string;
  grad_year: number | null;
  email: string | null;
  status: string;
  created_at: string;
};

export type PendingApplication = {
  id: string;
  personName: string;
  teamId: string;
  teamName: string;
  personId: string;
  message: string | null;
  createdAt: string;
};

const APPROVABLE_ROLES = ["student", "captain"] as const;

/** Validate the approval payload. PURE. Mentors/admins are created in /admin/people, not here. */
export function parseApproval(
  body: unknown,
): { studentIdNumber: string; role: (typeof APPROVABLE_ROLES)[number] } | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const studentIdNumber = reqString(b.studentIdNumber, 64);
  if (!studentIdNumber) return null;
  const role =
    b.role === undefined
      ? "student"
      : APPROVABLE_ROLES.find((r) => r === b.role);
  if (!role) return null;
  return { studentIdNumber, role };
}

export async function listPendingAccountRequests(
  db?: SupabaseClient,
): Promise<AccountRequestRow[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client
    .from("account_request")
    .select("*")
    .eq("status", "pending")
    .order("created_at");
  return (data ?? []) as AccountRequestRow[];
}

export async function listPendingApplications(
  db?: SupabaseClient,
): Promise<PendingApplication[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("membership_application")
    .select(
      "id, message, created_at, person!person_id (id, first_name, last_name, display_name), team (id, name)",
    )
    .eq("status", "pending")
    .order("created_at");
  if (error) console.error("listPendingApplications: query failed", error);
  return (data ?? [])
    .filter((r) => r.person && r.team)
    .map((r) => {
      const p = r.person as unknown as {
        id: string; first_name: string; last_name: string; display_name: string | null;
      };
      const t = r.team as unknown as { id: string; name: string };
      return {
        id: r.id as string,
        personId: p.id,
        personName: p.display_name ?? `${p.first_name} ${p.last_name}`,
        teamId: t.id,
        teamName: t.name,
        message: (r.message as string | null) ?? null,
        createdAt: r.created_at as string,
      };
    });
}

/**
 * Approve: create the person from the request, then mark the request reviewed.
 * Not transactional (PostgREST has no multi-statement tx): if the second step
 * fails, the person exists but the request stays pending — re-approving then
 * 409s on the duplicate student ID, which surfaces the inconsistency rather
 * than hiding it. Acceptable at team scale.
 */
export async function approveAccountRequest(
  id: string,
  approval: { studentIdNumber: string; role: "student" | "captain" },
  reviewerId: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data: request } = await client
    .from("account_request")
    .select("*")
    .eq("id", id)
    .eq("status", "pending")
    .maybeSingle();
  if (!request) return { ok: false, status: 404 };
  const r = request as AccountRequestRow;

  const created = await createPerson(
    {
      firstName: r.first_name,
      lastName: r.last_name,
      displayName: null,
      role: approval.role,
      gradYear: r.grad_year,
      email: r.email, // already lowercased by the request route + DB constraint
      phone: null,
      shirtSize: null,
      dietaryRestrictions: null,
      bio: null,
      studentIdNumber: approval.studentIdNumber,
      isActive: true,
    },
    client,
  );
  if (!created.ok) return { ok: false, status: created.status };

  const { error } = await client
    .from("account_request")
    .update({ status: "approved", reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    console.error("account_request approved but status update failed", { id, error });
    return { ok: false, status: 500 };
  }
  return { ok: true, status: 200 };
}

export async function denyAccountRequest(
  id: string,
  reviewerId: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("account_request")
    .update({ status: "denied", reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, status: 500 };
  if (!data) return { ok: false, status: 404 };
  return { ok: true, status: 200 };
}

/** Approve an application: create the membership, then mark reviewed. */
export async function approveApplication(
  id: string,
  reviewerId: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data: app } = await client
    .from("membership_application")
    .select("id, person_id, team_id")
    .eq("id", id)
    .eq("status", "pending")
    .maybeSingle();
  if (!app) return { ok: false, status: 404 };

  const membership = await upsertMember(
    app.team_id as string,
    app.person_id as string,
    false,
    client,
  );
  if (!membership.ok) return { ok: false, status: membership.status };

  const { error } = await client
    .from("membership_application")
    .update({ status: "approved", reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    console.error("application approved but status update failed", { id, error });
    return { ok: false, status: 500 };
  }
  return { ok: true, status: 200 };
}

export async function denyApplication(
  id: string,
  reviewerId: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("membership_application")
    .update({ status: "denied", reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, status: 500 };
  if (!data) return { ok: false, status: 404 };
  return { ok: true, status: 200 };
}
