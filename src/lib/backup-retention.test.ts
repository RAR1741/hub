import { describe, it, expect } from "vitest";
import { backupObjectName, selectBackupsToDelete, type DriveFileMeta } from "./backup-retention";

describe("backupObjectName", () => {
  it("formats the backup object name from an ISO stamp", () => {
    expect(backupObjectName("2026-08-16T07-00-00Z")).toBe(
      "teamhub-backup-2026-08-16T07-00-00Z.sql.gz.gpg"
    );
  });
});

describe("selectBackupsToDelete", () => {
  const files: DriveFileMeta[] = [
    { id: "a", name: "teamhub-backup-2026-08-13.sql.gz.gpg", createdTime: "2026-08-13T07-00-00Z" },
    { id: "b", name: "teamhub-backup-2026-08-14.sql.gz.gpg", createdTime: "2026-08-14T07-00-00Z" },
    { id: "c", name: "teamhub-backup-2026-08-15.sql.gz.gpg", createdTime: "2026-08-15T07-00-00Z" },
    { id: "d", name: "teamhub-backup-2026-08-16.sql.gz.gpg", createdTime: "2026-08-16T07-00-00Z" },
  ];

  it("keeps the newest N by createdTime and returns the older ids", () => {
    const result = selectBackupsToDelete(files, 2);
    expect(result.sort()).toEqual(["a", "b"].sort());
  });

  it("returns [] when keep is larger than the list length", () => {
    expect(selectBackupsToDelete(files, 100)).toEqual([]);
  });

  it("returns all ids when keep is 0", () => {
    const result = selectBackupsToDelete(files, 0);
    expect(result.sort()).toEqual(["a", "b", "c", "d"].sort());
  });

  it("returns all ids when keep is negative", () => {
    const result = selectBackupsToDelete(files, -1);
    expect(result.sort()).toEqual(["a", "b", "c", "d"].sort());
  });

  it("deterministically tiebreaks on equal createdTime by name desc", () => {
    const tied: DriveFileMeta[] = [
      { id: "x", name: "teamhub-backup-b.sql.gz.gpg", createdTime: "2026-08-16T07-00-00Z" },
      { id: "y", name: "teamhub-backup-a.sql.gz.gpg", createdTime: "2026-08-16T07-00-00Z" },
    ];
    // name desc means "b" sorts before "a" -> kept first when keep=1, "a" (y) deleted
    expect(selectBackupsToDelete(tied, 1)).toEqual(["y"]);
  });
});
