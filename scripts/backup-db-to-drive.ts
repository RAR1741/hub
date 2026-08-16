import { readFile } from "node:fs/promises";
import { driveBackupCredentialsFromEnv, uploadBackup, pruneBackups } from "../src/lib/drive-backup";
import { backupObjectName } from "../src/lib/backup-retention";

async function main() {
  const filePath = process.argv[2];
  const folderId = process.env.BACKUP_DRIVE_FOLDER_ID;
  const iso = process.env.BACKUP_STAMP; // filesystem-safe ISO from the workflow
  const keep = Number(process.env.BACKUP_KEEP ?? "30");
  const credentials = driveBackupCredentialsFromEnv();
  if (!filePath) throw new Error("usage: backup-db-to-drive <encrypted-dump-path>");
  if (!folderId) throw new Error("BACKUP_DRIVE_FOLDER_ID is required");
  if (!iso) throw new Error("BACKUP_STAMP is required");
  if (!credentials) throw new Error("GOOGLE_SA_CLIENT_EMAIL / GOOGLE_SA_PRIVATE_KEY are required");

  const data = new Uint8Array(await readFile(filePath));
  const deps = { fetch: globalThis.fetch, credentials };
  const name = backupObjectName(iso);
  const { id } = await uploadBackup(deps, { folderId, name, data });
  console.log(`uploaded ${name} (${data.length} bytes) as ${id}`);
  const deleted = await pruneBackups(deps, folderId, "teamhub-backup-", keep);
  console.log(`pruned ${deleted.length} old backup(s), keeping ${keep}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
