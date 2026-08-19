import { describe, expect, test } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";
import { MASQUERADE_COOKIE } from "./lib/masquerade";

describe("proxy (masquerade read-only enforcement)", () => {
  test("blocks POST /api/* when masquerade cookie present", () => {
    const request = new NextRequest(
      new URL("http://localhost/api/events/123/checkin", "http://localhost"),
      {
        method: "POST",
        headers: { cookie: `${MASQUERADE_COOKIE}=session-123` },
      },
    );
    const response = proxy(request);
    expect(response.status).toBe(403);
  });

  test("allows GET /api/* when masquerade cookie present", () => {
    const request = new NextRequest(
      new URL("http://localhost/api/events/123", "http://localhost"),
      {
        method: "GET",
        headers: { cookie: `${MASQUERADE_COOKIE}=session-123` },
      },
    );
    const response = proxy(request);
    expect(response.status).toBe(200); // NextResponse.next() doesn't set status; defaults to 200
  });

  test("allows POST /api/admin/masquerade/exit when masquerade cookie present", () => {
    const request = new NextRequest(
      new URL("http://localhost/api/admin/masquerade/exit", "http://localhost"),
      {
        method: "POST",
        headers: { cookie: `${MASQUERADE_COOKIE}=session-123` },
      },
    );
    const response = proxy(request);
    expect(response.status).toBe(200); // NextResponse.next() allows the request through
  });

  test("allows POST /api/* when no masquerade cookie", () => {
    const request = new NextRequest(
      new URL("http://localhost/api/events/123/checkin", "http://localhost"),
      {
        method: "POST",
      },
    );
    const response = proxy(request);
    expect(response.status).toBe(200); // NextResponse.next() allows the request through
  });

  test("allows HEAD /api/* when masquerade cookie present", () => {
    const request = new NextRequest(
      new URL("http://localhost/api/events/123", "http://localhost"),
      {
        method: "HEAD",
        headers: { cookie: `${MASQUERADE_COOKIE}=session-123` },
      },
    );
    const response = proxy(request);
    expect(response.status).toBe(200); // NextResponse.next() allows the request through
  });

  test("allows non-API routes even with masquerade cookie", () => {
    const request = new NextRequest(
      new URL("http://localhost/admin/people", "http://localhost"),
      {
        method: "POST",
        headers: { cookie: `${MASQUERADE_COOKIE}=session-123` },
      },
    );
    const response = proxy(request);
    expect(response.status).toBe(200); // NextResponse.next() allows non-API routes through
  });
});
