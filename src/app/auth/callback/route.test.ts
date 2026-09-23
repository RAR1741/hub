import { describe, expect, it, vi } from "vitest";
import { GET } from "./route";

vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));

const call = (query: string) =>
  GET(new Request(`http://localhost:3000/auth/callback${query}`));

describe("GET /auth/callback without a code", () => {
  it("sends a provider error to the login page's error banner", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await call(
      "?error=server_error&error_description=Unable+to+exchange+external+code",
    );
    expect(res.headers.get("location")).toBe("http://localhost:3000/login?error=oauth");
  });

  it("still redirects home when there's no code and no error", async () => {
    const res = await call("");
    expect(res.headers.get("location")).toBe("http://localhost:3000/");
  });
});
