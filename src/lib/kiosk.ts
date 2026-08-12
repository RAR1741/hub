import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const KIOSK_COOKIE = "hub_kiosk_token";

export function hashKioskToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateKioskToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function createKioskDevice(
  name: string,
  createdBy: string,
  db?: SupabaseClient,
): Promise<{ token: string; id: string } | null> {
  const client = db ?? (await import("./db")).getDb();
  const token = generateKioskToken();
  const { data, error } = await client
    .from("kiosk_device")
    .insert({ name, token_hash: hashKioskToken(token), created_by: createdBy })
    .select("id")
    .single();
  if (error) return null;
  return { token, id: data.id as string };
}

export async function listKioskDevices(
  db?: SupabaseClient,
): Promise<{ id: string; name: string; lastSeenAt: string | null }[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client
    .from("kiosk_device")
    .select("id, name, last_seen_at")
    .order("name");
  return (data ?? []).map((d) => ({
    id: d.id as string,
    name: d.name as string,
    lastSeenAt: (d.last_seen_at as string | null) ?? null,
  }));
}

export async function renameKioskDevice(
  id: string,
  name: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("kiosk_device")
    .update({ name })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, status: 500 };
  if (!data) return { ok: false, status: 404 };
  return { ok: true, status: 200 };
}

export async function deleteKioskDevice(
  id: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { error } = await client.from("kiosk_device").delete().eq("id", id);
  if (error) return { ok: false, status: 500 };
  return { ok: true, status: 200 };
}

/** True when the token matches a registered kiosk device (and bumps last_seen_at). */
export async function verifyKioskToken(
  token: string | undefined,
  db?: SupabaseClient,
): Promise<boolean> {
  if (!token) return false;
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client
    .from("kiosk_device")
    .select("id")
    .eq("token_hash", hashKioskToken(token))
    .maybeSingle();
  if (!data) return false;
  await client
    .from("kiosk_device")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", data.id);
  return true;
}
