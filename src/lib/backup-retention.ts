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
  const sorted = [...files].sort((a, b) => {
    if (a.createdTime !== b.createdTime) return a.createdTime < b.createdTime ? 1 : -1;
    return a.name < b.name ? 1 : -1;
  });
  if (keep <= 0) return sorted.map((f) => f.id);
  return sorted.slice(keep).map((f) => f.id);
}
