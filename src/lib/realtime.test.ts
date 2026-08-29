import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { broadcast } from "./realtime";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  delete process.env.SUPABASE_INTERNAL_URL;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe("broadcast", () => {
  test("POSTs to the broadcast endpoint with service-role auth and message body", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await broadcast("hub:presence", "clock-in", { personId: "p1" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://project.supabase.co/realtime/v1/api/broadcast");
    expect(init!.method).toBe("POST");
    expect(init!.headers).toMatchObject({
      apikey: "service-key",
      Authorization: "Bearer service-key",
    });
    expect(JSON.parse(init!.body as string)).toEqual({
      messages: [
        {
          topic: "hub:presence",
          event: "clock-in",
          payload: { personId: "p1" },
          private: true,
        },
      ],
    });
  });

  test("defaults payload to {} when omitted", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await broadcast("hub:presence", "clock-out");

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init!.body as string).messages[0].payload).toEqual({});
  });

  test("logs a non-ok response instead of throwing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad service-role key", { status: 401 })),
    );

    await expect(broadcast("hub:presence", "clock-in")).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      "broadcast failed",
      "hub:presence",
      "clock-in",
      401,
      "bad service-role key",
    );
  });

  test("swallows a rejected fetch instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    await expect(broadcast("hub:presence", "clock-in")).resolves.toBeUndefined();
  });

  test("swallows a thrown error building the request (e.g. missing Supabase URL config)", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_INTERNAL_URL;
    vi.stubGlobal("fetch", vi.fn());

    await expect(broadcast("hub:presence", "clock-in")).resolves.toBeUndefined();
  });
});
