import { fetchGoogleAccessToken } from "./google-auth";
import { selectBackupsToDelete, type DriveFileMeta } from "./backup-retention";

export type DriveBackupCredentials = {
  clientEmail: string;
  privateKey: string;
  subject?: string;
};

export type DriveBackupDeps = {
  fetch: typeof globalThis.fetch;
  credentials: DriveBackupCredentials;
  now?: () => number;
};

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

const FILES_URL = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true";

/** Read Drive backup service-account creds from env; null if not fully configured. */
export function driveBackupCredentialsFromEnv(): DriveBackupCredentials | null {
  const clientEmail = process.env.GOOGLE_SA_CLIENT_EMAIL;
  // Private keys in env keep literal "\n"; restore real newlines for the PEM parser.
  const privateKey = process.env.GOOGLE_SA_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!clientEmail || !privateKey) return null;
  // An unset GitHub secret resolves to "" rather than being absent — treat that
  // as no subject so a Shared-Drive setup mints an SA-owned token instead of
  // trying (and failing) to impersonate an empty user.
  const subject = process.env.BACKUP_DRIVE_SUBJECT;
  return {
    clientEmail,
    privateKey,
    ...(subject ? { subject } : {}),
  };
}

// One access token is reused for every call sharing the same `deps` object.
// Keyed by object identity via a WeakMap so cached promises are collected
// with their deps and never leak.
const tokenCache = new WeakMap<DriveBackupDeps, Promise<string>>();

async function fetchAccessToken(deps: DriveBackupDeps): Promise<string> {
  const cached = tokenCache.get(deps);
  if (cached) return cached;
  const promise = fetchGoogleAccessToken(
    deps.fetch,
    deps.credentials,
    { scope: DRIVE_SCOPE, ...(deps.credentials.subject ? { subject: deps.credentials.subject } : {}) },
    deps.now,
  );
  tokenCache.set(deps, promise);
  return promise;
}

/** Upload a backup file to Drive via a multipart upload; throws on non-2xx. */
export async function uploadBackup(
  deps: DriveBackupDeps,
  opts: { folderId: string; name: string; data: Uint8Array },
): Promise<{ id: string }> {
  const token = await fetchAccessToken(deps);
  const boundary = "teamhub-backup-boundary";
  const meta = JSON.stringify({ name: opts.name, parents: [opts.folderId] });
  const enc = new TextEncoder();
  const pre = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
      `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const post = enc.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(pre.length + opts.data.length + post.length);
  body.set(pre, 0);
  body.set(opts.data, pre.length);
  body.set(post, pre.length + opts.data.length);
  const res = await deps.fetch(UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) throw new Error(`drive upload failed: ${res.status}`);
  const json = (await res.json()) as { id?: string };
  if (!json.id) throw new Error("drive upload returned no id");
  return { id: json.id };
}

/** List non-trashed backup files in a folder whose name contains `prefix`. */
export async function listBackups(
  deps: DriveBackupDeps,
  folderId: string,
  prefix: string,
): Promise<DriveFileMeta[]> {
  const token = await fetchAccessToken(deps);
  const url = new URL(FILES_URL);
  url.searchParams.set(
    "q",
    `'${folderId}' in parents and name contains '${prefix}' and trashed = false`,
  );
  url.searchParams.set("fields", "files(id,name,createdTime)");
  url.searchParams.set("orderBy", "createdTime desc");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  url.searchParams.set("pageSize", "1000");
  const res = await deps.fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`list backups failed: ${res.status}`);
  const json = (await res.json()) as {
    files?: { id?: string; name?: string; createdTime?: string }[];
  };
  return (json.files ?? []).map((f) => ({
    id: f.id ?? "",
    name: f.name ?? "",
    createdTime: f.createdTime ?? "",
  }));
}

/** Delete a Drive file by id; 404 (already gone) is tolerated. */
export async function deleteDriveFile(deps: DriveBackupDeps, id: string): Promise<void> {
  const token = await fetchAccessToken(deps);
  const url = `${FILES_URL}/${encodeURIComponent(id)}?supportsAllDrives=true`;
  const res = await deps.fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) throw new Error(`delete backup failed: ${res.status}`);
}

/** List, select, and delete backups beyond the `keep` most recent; returns deleted ids. */
export async function pruneBackups(
  deps: DriveBackupDeps,
  folderId: string,
  prefix: string,
  keep: number,
): Promise<string[]> {
  const files = await listBackups(deps, folderId, prefix);
  const toDelete = selectBackupsToDelete(files, keep);
  for (const id of toDelete) {
    await deleteDriveFile(deps, id);
  }
  return toDelete;
}
