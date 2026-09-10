export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { assertDevBypassFlagsSafe } = await import("./lib/startup-guard");
  assertDevBypassFlagsSafe(process.env);
}
