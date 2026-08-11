import { withRole } from "@/lib/api";
import { parseSettingsInput, setSettings } from "@/lib/app-settings-admin";

export const PATCH = withRole("admin", async (_viewer, request) => {
  const input = parseSettingsInput(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await setSettings(input);
  return result.ok
    ? Response.json({ ok: true })
    : Response.json({ error: "failed" }, { status: result.status });
});
