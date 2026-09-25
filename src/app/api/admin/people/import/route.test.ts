import { expect, test, vi } from "vitest";

// route.ts -> @/lib/people -> @/lib/db imports "server-only", which throws
// outside a Next RSC/webpack build; people is mocked wholesale anyway.
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/people", () => ({
  findPersonForRosterRow: vi.fn(),
  createPerson: vi.fn(),
  updatePersonRosterFields: vi.fn(),
}));
vi.mock("@/lib/viewer", () => ({
  getViewer: () => Promise.resolve({ role: "admin", person: { id: "p1" } }),
}));

import { POST } from "./route";
import { createPerson, findPersonForRosterRow } from "@/lib/people";

const CSV =
  "first_name,last_name,email,role,grad_year,student_id_number\nAda,Lovelace,ada@example.org,student,2028,1741\n";

function req(csv: string) {
  return new Request("http://localhost/api/admin/people/import", {
    method: "POST",
    body: JSON.stringify({ csv }),
    headers: { "content-type": "application/json" },
  });
}

test("a failed lookup aborts the row instead of creating a duplicate person", async () => {
  // Swallowing the read error would read as "no such person" and the importer
  // would happily create a second Ada (#287).
  vi.mocked(findPersonForRosterRow).mockRejectedValue(new Error("identity query failed: boom"));

  const res = await POST(req(CSV), undefined);
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    created: number;
    skipped: number;
    errors: { line: number; message: string }[];
  };
  expect(createPerson).not.toHaveBeenCalled();
  expect(body.created).toBe(0);
  expect(body.skipped).toBe(1);
  expect(body.errors[0].message).toMatch(/identity query failed/);
});
