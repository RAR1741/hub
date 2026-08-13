import { withRole } from "@/lib/api";
import {
  createPerson,
  findPersonForRosterRow,
  updatePersonRosterFields,
  type PersonInput,
} from "@/lib/people";
import { parseRosterCsv, type ParsedRosterRow } from "@/lib/roster-import";

type RowResult =
  | { line: number; status: "created"; message?: undefined }
  | { line: number; status: "updated"; message?: undefined }
  | { line: number; status: "error"; message: string };

type ImportSummary = {
  created: number;
  updated: number;
  skipped: number;
  errors: { line: number; message: string }[];
  results: RowResult[];
};

async function importRow(row: ParsedRosterRow): Promise<RowResult> {
  const existingId = await findPersonForRosterRow(row);

  if (existingId) {
    const result = await updatePersonRosterFields(existingId, {
      firstName: row.firstName,
      lastName: row.lastName,
      // null means "this CSV row left the cell blank" — updatePersonRosterFields
      // treats null as "leave the existing value alone", never as "clear it".
      // A defaulted-to-student role must not demote an existing mentor/admin.
      email: row.email,
      role: row.roleWasSpecified ? row.role : null,
      gradYear: row.gradYear,
      studentIdNumber: row.studentIdNumber,
    });
    if (!result.ok) {
      return {
        line: row.line,
        status: "error",
        message: result.status === 409 ? "Email or student ID already in use by another person" : "Update failed",
      };
    }
    return { line: row.line, status: "updated" };
  }

  const input: PersonInput = {
    firstName: row.firstName,
    lastName: row.lastName,
    displayName: null,
    role: row.role,
    gradYear: row.gradYear,
    email: row.email,
    phone: null,
    shirtSize: null,
    dietaryRestrictions: null,
    bio: null,
    studentIdNumber: row.studentIdNumber,
    isActive: true,
  };
  const created = await createPerson(input);
  if (!created.ok) {
    return {
      line: row.line,
      status: "error",
      message: created.status === 409 ? "Email or student ID already in use" : "Create failed",
    };
  }
  return { line: row.line, status: "created" };
}

const TEMPLATE_HEADER = "first_name,last_name,email,role,grad_year,student_id_number\n";

/** Downloadable starter CSV — just the header row. */
export const GET = withRole("admin", async () => {
  return new Response(TEMPLATE_HEADER, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="roster-template.csv"',
    },
  });
});

export const POST = withRole("admin", async (_viewer, request) => {
  const body = await request.json().catch(() => null);
  const csv =
    typeof body === "object" && body !== null && typeof (body as Record<string, unknown>).csv === "string"
      ? (body as Record<string, unknown>).csv as string
      : null;
  if (csv === null) return Response.json({ error: "invalid" }, { status: 400 });

  // Never trust a client-computed preview — re-parse and re-validate from
  // the raw text server-side.
  const { rows, errors: parseErrors } = parseRosterCsv(csv);

  const summary: ImportSummary = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [...parseErrors],
    results: parseErrors.map((e) => ({ line: e.line, status: "error", message: e.message })),
  };

  for (const row of rows) {
    const result = await importRow(row);
    summary.results.push(result);
    if (result.status === "created") summary.created += 1;
    else if (result.status === "updated") summary.updated += 1;
    else {
      summary.skipped += 1;
      summary.errors.push({ line: result.line, message: result.message });
    }
  }

  summary.results.sort((a, b) => a.line - b.line);
  summary.errors.sort((a, b) => a.line - b.line);

  return Response.json(summary, { status: 200 });
});
