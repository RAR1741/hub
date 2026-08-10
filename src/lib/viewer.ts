import type { PersonRow, Person, Role } from "./types";
import { personFromRow } from "./types";

export type Viewer = { person: Person | null; role: Role };

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

  const cookieStore = await cookies();
  const supabase = createServerClient(
    serverSupabaseUrl(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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

  return resolveViewer({
    supabaseUserId: user?.id ?? null,
    studentToken: cookieStore.get(STUDENT_SESSION_COOKIE)?.value ?? null,
    verifyToken: (t) =>
      verifyStudentSessionToken(t, process.env.STUDENT_SESSION_SECRET!),
    findPersonByAuthUserId: (id) => findOne("auth_user_id", id),
    findPersonById: (id) => findOne("id", id),
  });
}
