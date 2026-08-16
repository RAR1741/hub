import { describe, expect, test } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import {
  DRIVE_SCOPE,
  deleteDriveFile,
  driveBackupCredentialsFromEnv,
  listBackups,
  pruneBackups,
  uploadBackup,
  type DriveBackupCredentials,
  type DriveBackupDeps,
} from "./drive-backup";

// A throwaway RSA key so the token-exchange JWT can actually sign in the test.
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const CREDS: DriveBackupCredentials = {
  clientEmail: "svc@proj.iam.gserviceaccount.com",
  privateKey: PEM,
};

function decodeAssertionClaims(body: string): Record<string, unknown> {
  const params = new URLSearchParams(body);
  const assertion = params.get("assertion")!;
  const [, claimsB64] = assertion.split(".");
  return JSON.parse(Buffer.from(claimsB64, "base64url").toString());
}

type CapturedRequest = { url: string; init?: RequestInit };

// Fake fetch: dispatches on URL (token endpoint vs Drive endpoints) against a
// queue of canned responses, and records every request it received.
function fakeFetch(responses: { status: number; body?: unknown }[]) {
  const requests: CapturedRequest[] = [];
  const queue = [...responses];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    requests.push({ url: href, init });
    if (href.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "fake-token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    const next = queue.shift();
    if (!next) throw new Error(`no fake response queued for ${href}`);
    return new Response(next.body !== undefined ? JSON.stringify(next.body) : undefined, {
      status: next.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
  return { fetchFn, requests };
}

async function bodyText(init?: RequestInit): Promise<string> {
  const body = init?.body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString("utf-8");
  return String(body);
}

describe("driveBackupCredentialsFromEnv", () => {
  test("reads and restores the private key from env vars", () => {
    const prev = {
      email: process.env.GOOGLE_SA_CLIENT_EMAIL,
      key: process.env.GOOGLE_SA_PRIVATE_KEY,
      subject: process.env.BACKUP_DRIVE_SUBJECT,
    };
    process.env.GOOGLE_SA_CLIENT_EMAIL = "svc@proj.iam.gserviceaccount.com";
    process.env.GOOGLE_SA_PRIVATE_KEY = "line1\\nline2";
    delete process.env.BACKUP_DRIVE_SUBJECT;
    try {
      expect(driveBackupCredentialsFromEnv()).toEqual({
        clientEmail: "svc@proj.iam.gserviceaccount.com",
        privateKey: "line1\nline2",
      });
    } finally {
      process.env.GOOGLE_SA_CLIENT_EMAIL = prev.email;
      process.env.GOOGLE_SA_PRIVATE_KEY = prev.key;
      process.env.BACKUP_DRIVE_SUBJECT = prev.subject;
    }
  });

  test("returns null when either var is missing", () => {
    const prev = {
      email: process.env.GOOGLE_SA_CLIENT_EMAIL,
      key: process.env.GOOGLE_SA_PRIVATE_KEY,
    };
    delete process.env.GOOGLE_SA_CLIENT_EMAIL;
    process.env.GOOGLE_SA_PRIVATE_KEY = "line1\\nline2";
    try {
      expect(driveBackupCredentialsFromEnv()).toBeNull();
    } finally {
      process.env.GOOGLE_SA_CLIENT_EMAIL = prev.email;
      process.env.GOOGLE_SA_PRIVATE_KEY = prev.key;
    }
  });

  test("treats an empty-string subject (unset GitHub secret) as absent", () => {
    const prev = {
      email: process.env.GOOGLE_SA_CLIENT_EMAIL,
      key: process.env.GOOGLE_SA_PRIVATE_KEY,
      subject: process.env.BACKUP_DRIVE_SUBJECT,
    };
    process.env.GOOGLE_SA_CLIENT_EMAIL = "svc@proj.iam.gserviceaccount.com";
    process.env.GOOGLE_SA_PRIVATE_KEY = "line1\\nline2";
    process.env.BACKUP_DRIVE_SUBJECT = "";
    try {
      const creds = driveBackupCredentialsFromEnv();
      expect(creds).not.toBeNull();
      expect(creds!.subject).toBeUndefined();
    } finally {
      process.env.GOOGLE_SA_CLIENT_EMAIL = prev.email;
      process.env.GOOGLE_SA_PRIVATE_KEY = prev.key;
      process.env.BACKUP_DRIVE_SUBJECT = prev.subject;
    }
  });

  test("includes subject when set to a non-empty string", () => {
    const prev = {
      email: process.env.GOOGLE_SA_CLIENT_EMAIL,
      key: process.env.GOOGLE_SA_PRIVATE_KEY,
      subject: process.env.BACKUP_DRIVE_SUBJECT,
    };
    process.env.GOOGLE_SA_CLIENT_EMAIL = "svc@proj.iam.gserviceaccount.com";
    process.env.GOOGLE_SA_PRIVATE_KEY = "line1\\nline2";
    process.env.BACKUP_DRIVE_SUBJECT = "backup-owner@example.com";
    try {
      expect(driveBackupCredentialsFromEnv()).toEqual({
        clientEmail: "svc@proj.iam.gserviceaccount.com",
        privateKey: "line1\nline2",
        subject: "backup-owner@example.com",
      });
    } finally {
      process.env.GOOGLE_SA_CLIENT_EMAIL = prev.email;
      process.env.GOOGLE_SA_PRIVATE_KEY = prev.key;
      process.env.BACKUP_DRIVE_SUBJECT = prev.subject;
    }
  });
});

describe("uploadBackup", () => {
  test("posts a multipart upload and returns the new id", async () => {
    const { fetchFn, requests } = fakeFetch([{ status: 200, body: { id: "file-123" } }]);
    const deps: DriveBackupDeps = { fetch: fetchFn, credentials: CREDS };
    const data = new Uint8Array([1, 2, 3, 4]);
    const result = await uploadBackup(deps, { folderId: "folder-1", name: "backup.sql.gz.gpg", data });
    expect(result).toEqual({ id: "file-123" });

    const uploadReq = requests.find((r) => r.url.includes("/upload/drive/v3/files"))!;
    expect(uploadReq.url).toBe(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true",
    );
    expect(uploadReq.init?.method).toBe("POST");
    const headers = uploadReq.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer fake-token");
    expect(headers["Content-Type"]).toMatch(/^multipart\/related; boundary=/);

    const text = await bodyText(uploadReq.init);
    expect(text).toContain('"name":"backup.sql.gz.gpg"');
    expect(text).toContain('"parents":["folder-1"]');
    // The raw data bytes 1,2,3,4 should appear in the body (as latin1 chars).
    const body = uploadReq.init!.body as Uint8Array;
    const tail = body.slice(body.length - 4 - "\r\n--teamhub-backup-boundary--".length, body.length - "\r\n--teamhub-backup-boundary--".length);
    expect(Array.from(tail)).toEqual([1, 2, 3, 4]);
  });

  test("throws on non-2xx", async () => {
    const { fetchFn } = fakeFetch([{ status: 500, body: { error: "boom" } }]);
    const deps: DriveBackupDeps = { fetch: fetchFn, credentials: CREDS };
    await expect(
      uploadBackup(deps, { folderId: "folder-1", name: "x", data: new Uint8Array() }),
    ).rejects.toThrow(/drive upload failed: 500/);
  });
});

describe("listBackups", () => {
  test("gets with the q/fields/orderBy params and maps the response", async () => {
    const { fetchFn, requests } = fakeFetch([
      {
        status: 200,
        body: {
          files: [
            { id: "f1", name: "teamhub-backup-a.sql.gz.gpg", createdTime: "2026-01-01T00:00:00Z" },
            { id: "f2", name: "teamhub-backup-b.sql.gz.gpg", createdTime: "2026-01-02T00:00:00Z" },
          ],
        },
      },
    ]);
    const deps: DriveBackupDeps = { fetch: fetchFn, credentials: CREDS };
    const files = await listBackups(deps, "folder-1", "teamhub-backup-");
    expect(files).toEqual([
      { id: "f1", name: "teamhub-backup-a.sql.gz.gpg", createdTime: "2026-01-01T00:00:00Z" },
      { id: "f2", name: "teamhub-backup-b.sql.gz.gpg", createdTime: "2026-01-02T00:00:00Z" },
    ]);

    const listReq = requests.find((r) => r.url.includes("/drive/v3/files") && !r.url.includes("/upload"))!;
    const url = new URL(listReq.url);
    expect(url.searchParams.get("q")).toBe(
      "'folder-1' in parents and name contains 'teamhub-backup-' and trashed = false",
    );
    expect(url.searchParams.get("fields")).toBe("files(id,name,createdTime)");
    expect(url.searchParams.get("orderBy")).toBe("createdTime desc");
    expect(url.searchParams.get("supportsAllDrives")).toBe("true");
    expect(url.searchParams.get("includeItemsFromAllDrives")).toBe("true");
    expect(url.searchParams.get("pageSize")).toBe("1000");
  });
});

describe("deleteDriveFile", () => {
  test("deletes to the right URL", async () => {
    const { fetchFn, requests } = fakeFetch([{ status: 200, body: {} }]);
    const deps: DriveBackupDeps = { fetch: fetchFn, credentials: CREDS };
    await deleteDriveFile(deps, "file-1");
    const delReq = requests.find((r) => r.init?.method === "DELETE")!;
    expect(delReq.url).toBe("https://www.googleapis.com/drive/v3/files/file-1?supportsAllDrives=true");
  });

  test("tolerates 404", async () => {
    const { fetchFn } = fakeFetch([{ status: 404, body: {} }]);
    const deps: DriveBackupDeps = { fetch: fetchFn, credentials: CREDS };
    await expect(deleteDriveFile(deps, "file-1")).resolves.toBeUndefined();
  });

  test("throws on other non-2xx", async () => {
    const { fetchFn } = fakeFetch([{ status: 500, body: {} }]);
    const deps: DriveBackupDeps = { fetch: fetchFn, credentials: CREDS };
    await expect(deleteDriveFile(deps, "file-1")).rejects.toThrow(/delete backup failed: 500/);
  });
});

describe("pruneBackups", () => {
  test("deletes exactly the ids selectBackupsToDelete chooses", async () => {
    const files = Array.from({ length: 32 }, (_, i) => ({
      id: `f${i}`,
      name: `teamhub-backup-${i}.sql.gz.gpg`,
      createdTime: new Date(2026, 0, i + 1).toISOString(),
    }));
    const { fetchFn, requests } = fakeFetch([
      { status: 200, body: { files } },
      ...Array.from({ length: 2 }, () => ({ status: 200, body: {} })),
    ]);
    const deps: DriveBackupDeps = { fetch: fetchFn, credentials: CREDS };
    const deleted = await pruneBackups(deps, "folder-1", "teamhub-backup-", 30);

    // Oldest two by createdTime (f0, f1) should be deleted.
    expect(deleted).toHaveLength(2);
    expect([...deleted].sort()).toEqual(["f0", "f1"]);

    const deleteReqs = requests.filter((r) => r.init?.method === "DELETE");
    expect(deleteReqs).toHaveLength(2);
    expect(deleteReqs.map((r) => r.url).sort()).toEqual(
      [
        "https://www.googleapis.com/drive/v3/files/f0?supportsAllDrives=true",
        "https://www.googleapis.com/drive/v3/files/f1?supportsAllDrives=true",
      ].sort(),
    );
  });
});

describe("token exchange", () => {
  test("uses DRIVE_SCOPE and no subject when creds lack one (SA-owned token)", async () => {
    const { fetchFn, requests } = fakeFetch([{ status: 200, body: { files: [] } }]);
    const deps: DriveBackupDeps = { fetch: fetchFn, credentials: CREDS, now: () => 1_700_000_000_000 };
    await listBackups(deps, "folder-1", "teamhub-backup-");

    const tokenReq = requests.find((r) => r.url.includes("oauth2.googleapis.com/token"))!;
    const claims = decodeAssertionClaims(tokenReq.init!.body as string);
    expect(claims.scope).toBe(DRIVE_SCOPE);
    expect(claims.sub).toBeUndefined();
  });

  test("forwards subject in creds to the token exchange as sub (DWD impersonation)", async () => {
    const { fetchFn, requests } = fakeFetch([{ status: 200, body: { files: [] } }]);
    const credsWithSubject: DriveBackupCredentials = { ...CREDS, subject: "backup-owner@example.com" };
    const deps: DriveBackupDeps = {
      fetch: fetchFn,
      credentials: credsWithSubject,
      now: () => 1_700_000_000_000,
    };
    await listBackups(deps, "folder-1", "teamhub-backup-");

    const tokenReq = requests.find((r) => r.url.includes("oauth2.googleapis.com/token"))!;
    const claims = decodeAssertionClaims(tokenReq.init!.body as string);
    expect(claims.scope).toBe(DRIVE_SCOPE);
    expect(claims.sub).toBe("backup-owner@example.com");
  });
});
