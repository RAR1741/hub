import { describe, expect, test, vi } from "vitest";

vi.mock("@/lib/viewer", () => ({
  getViewer: vi.fn(),
}));
vi.mock("@/lib/people", () => ({
  listPeople: vi.fn(),
  displayName: (p: { first_name: string; last_name: string }) =>
    `${p.first_name} ${p.last_name}`,
}));

function personRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "p-1",
    first_name: "Ada",
    last_name: "Lovelace",
    display_name: null,
    role: "student",
    grad_year: 2027,
    email: null,
    is_active: true,
    student_id_number: null,
    ...overrides,
  };
}

describe("GET /api/people/search", () => {
  test("student viewer -> 403, helper not called", async () => {
    const { getViewer } = await import("@/lib/viewer");
    const { listPeople } = await import("@/lib/people");
    vi.mocked(getViewer).mockResolvedValue({ person: null, role: "student" } as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://x/api/people/search?q=te"));
    expect(res.status).toBe(403);
    expect(listPeople).not.toHaveBeenCalled();
  });

  test("guest viewer -> 403", async () => {
    const { getViewer } = await import("@/lib/viewer");
    vi.mocked(getViewer).mockResolvedValue({ person: null, role: "guest" } as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://x/api/people/search?q=te"));
    expect(res.status).toBe(403);
  });

  test("mentor + blank q -> empty list, helper not called", async () => {
    const { getViewer } = await import("@/lib/viewer");
    const { listPeople } = await import("@/lib/people");
    vi.mocked(getViewer).mockResolvedValue({ person: { id: "m-1" }, role: "mentor" } as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://x/api/people/search?q=%20%20"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ people: [] });
    expect(listPeople).not.toHaveBeenCalled();
  });

  test("mentor + q returns people with exactly the PII-safe keys, capped at 8", async () => {
    const { getViewer } = await import("@/lib/viewer");
    const { listPeople } = await import("@/lib/people");
    vi.mocked(getViewer).mockResolvedValue({ person: { id: "m-1" }, role: "mentor" } as never);
    const rows = Array.from({ length: 10 }, (_, i) =>
      personRow({ id: `p-${i}`, email: `p${i}@example.com`, phone: `555-000${i}` }),
    );
    vi.mocked(listPeople).mockResolvedValue(rows as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://x/api/people/search?q=te"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { people: Array<Record<string, unknown>> };
    expect(body.people).toHaveLength(8);
    for (const p of body.people) {
      expect(Object.keys(p).sort()).toEqual(["gradYear", "id", "isActive", "name", "role"]);
    }
  });

  test("inactive sorted after active", async () => {
    const { getViewer } = await import("@/lib/viewer");
    const { listPeople } = await import("@/lib/people");
    vi.mocked(getViewer).mockResolvedValue({ person: { id: "m-1" }, role: "mentor" } as never);
    vi.mocked(listPeople).mockResolvedValue([
      personRow({ id: "inactive-1", is_active: false }),
      personRow({ id: "active-1", is_active: true }),
    ] as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://x/api/people/search?q=te"));
    const body = (await res.json()) as { people: Array<{ id: string }> };
    expect(body.people.map((p) => p.id)).toEqual(["active-1", "inactive-1"]);
  });

  test("q longer than 80 chars is truncated before being passed to the helper", async () => {
    const { getViewer } = await import("@/lib/viewer");
    const { listPeople } = await import("@/lib/people");
    vi.mocked(getViewer).mockResolvedValue({ person: { id: "m-1" }, role: "mentor" } as never);
    vi.mocked(listPeople).mockResolvedValue([]);

    const longQ = "a".repeat(100);
    const { GET } = await import("./route");
    await GET(new Request(`http://x/api/people/search?q=${longQ}`));
    expect(listPeople).toHaveBeenCalledWith("a".repeat(80));
  });
});
