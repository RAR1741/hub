import { serverSupabaseUrl } from "./supabase-url";

/**
 * Fire-and-forget ping to Supabase Realtime Broadcast on a private channel.
 *
 * Never throws: a Realtime outage must not fail the calling mutation. Missed
 * pings degrade to the client's fallback poll (see useRealtimeRefetch).
 */
export async function broadcast(
  topic: string,
  event: string,
  payload: object = {},
): Promise<void> {
  try {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    await fetch(`${serverSupabaseUrl()}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        messages: [{ topic, event, payload, private: true }],
      }),
      signal: AbortSignal.timeout(2000),
    });
  } catch (err) {
    console.error("broadcast failed", topic, event, err);
  }
}
