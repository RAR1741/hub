import type { PersonRow, Person, Role } from "./types";
import { personFromRow } from "./types";

export type Viewer = {
  person: Person | null;
  role: Role;
  /** If present, this viewer is masquerading as another person. The real admin's info is preserved here. */
  masquerade?: {
    adminPersonId: string;
    targetPersonId: string;
    sessionId: string;
  };
};

const GUEST: Viewer = { person: null, role: "guest" };

type ResolveDeps = {
  supabaseUserId: string | null;
  studentToken: string | null;
  verifyToken: (token: string) => Promise<{ personId: string } | null>;
  findPersonByAuthUserId: (authUserId: string) => Promise<PersonRow | null>;
  findPersonById: (id: string) => Promise<PersonRow | null>;
};

export async function resolveViewer(deps: ResolveDeps): Promise<Viewer> {
  if (deps.supabaseUserId) {
    const row = await deps.findPersonByAuthUserId(deps.supabaseUserId);
    if (row?.is_active) return { person: personFromRow(row), role: row.role };
  }
  if (deps.studentToken) {
    const claims = await deps.verifyToken(deps.studentToken);
    if (claims) {
      const row = await deps.findPersonById(claims.personId);
      if (row?.is_active) return { person: personFromRow(row), role: row.role };
    }
  }
  return GUEST;
}

/** Next.js wrapper: reads both session types from cookies. Server-only. */
export async function getViewer(): Promise<Viewer> {
  const { cookies } = await import("next/headers");
  const { createServerClient } = await import("@supabase/ssr");
  const { getDb } = await import("./db");
  const { STUDENT_SESSION_COOKIE, verifyStudentSessionToken } = await import(
    "./student-session"
  );

  const { serverSupabaseUrl } = await import("./supabase-url");
  const { AUTH_COOKIE_NAME } = await import("./supabase-cookie");
  const { MASQUERADE_COOKIE, findActiveMasquerade } = await import(
    "./masquerade"
  );

  const cookieStore = await cookies();
  const supabase = createServerClient(
    serverSupabaseUrl(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Must match the name used when the session cookie was written
      // (supabase-cookie.ts) or getUser() won't find the mentor's session.
      cookieOptions: { name: AUTH_COOKIE_NAME },
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {}, // read-only here; auth callback handles writes
      },
    },
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const db = getDb();
  const findOne = async (col: string, val: string) => {
    const { data } = await db
      .from("person")
      .select("*")
      .eq(col, val)
      .maybeSingle();
    return data;
  };

  const realViewer = await resolveViewer({
    supabaseUserId: user?.id ?? null,
    studentToken: cookieStore.get(STUDENT_SESSION_COOKIE)?.value ?? null,
    verifyToken: (t) =>
      verifyStudentSessionToken(t, process.env.STUDENT_SESSION_SECRET!),
    findPersonByAuthUserId: async (id) => {
      const { data } = await db
        .from("person_identity")
        .select("person (*)")
        .eq("auth_user_id", id)
        .maybeSingle();
      const person = (data as { person: PersonRow | PersonRow[] | null } | null)?.person;
      return (Array.isArray(person) ? person[0] : person) ?? null;
    },
    findPersonById: (id) => findOne("id", id),
  });

  // Check for active masquerade session. Only applies if:
  // 1. Admin is logged in (not a guest)
  // 2. A masquerade cookie exists
  // 3. The session is still active in the DB
  // 4. The admin in the session matches the real logged-in admin
  if (realViewer.role === "admin" && realViewer.person?.id) {
    const masqueradeSessionId = cookieStore.get(MASQUERADE_COOKIE)?.value;
    if (masqueradeSessionId) {
      const session = await findActiveMasquerade(masqueradeSessionId);
      if (session && session.adminPersonId === realViewer.person.id) {
        // Look up the target person and swap roles
        const targetRow = await findOne("id", session.targetPersonId);
        if (targetRow && targetRow.is_active) {
          return {
            person: personFromRow(targetRow),
            role: targetRow.role,
            masquerade: {
              adminPersonId: realViewer.person.id,
              targetPersonId: session.targetPersonId,
              sessionId: masqueradeSessionId,
            },
          };
        }
      }
    }
  }

  return realViewer;
}
