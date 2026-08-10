import { withRole } from "@/lib/api";

export const GET = withRole("admin", async () => Response.json({ ok: true }));
