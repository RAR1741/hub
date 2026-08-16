export type DriveFileMeta = { id: string; name: string; createdTime: string };

/** Filesystem/Drive-safe backup object name for a given ISO stamp. PURE. */
export function backupObjectName(iso: string): string {
  return `teamhub-backup-${iso}.sql.gz.gpg`;
}

/**
 * Given the backup files currently in the folder, return the ids to delete so
 * only the newest `keep` remain. Sorts by createdTime desc (name desc as a
 * stable tiebreak). PURE.
 */
export function selectBackupsToDelete(files: DriveFileMeta[], keep: number): string[] {
  // Safety net: a non-finite keep (e.g. NaN from a misconfigured BACKUP_KEEP)
  // must never fall through to slice(NaN) === slice(0) and delete everything.
  // Callers validate too, but here we fail safe by deleting nothing.
  if (!Number.isFinite(keep)) return [];
  const sorted = [...files].sort((a, b) => {
    if (a.createdTime !== b.createdTime) return a.createdTime < b.createdTime ? 1 : -1;
    return a.name < b.name ? 1 : -1;
  });
  if (keep <= 0) return sorted.map((f) => f.id);
  return sorted.slice(keep).map((f) => f.id);
}
