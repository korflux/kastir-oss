import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";

import {
  BACKUP_PUBLIC_URL_PREFIX,
  MAX_LOCAL_SNAPSHOTS,
} from "@/lib/Modules/Backup/constants";
import {
  assertSafeBackupId,
  assertWithinBackupRoot,
  getBackupPublicUrlPrefix,
  getBackupRoot,
} from "@/lib/Modules/Backup/paths";

describe("backup storage paths", () => {
  it("places backups under public/_kastir/backups", () => {
    const root = getBackupRoot(resolve("/app/public"));
    expect(root.replace(/\\/g, "/")).toMatch(/public[/\\]_kastir[/\\]backups$/);
    expect(getBackupPublicUrlPrefix()).toBe(BACKUP_PUBLIC_URL_PREFIX);
    expect(BACKUP_PUBLIC_URL_PREFIX).toBe("/_kastir/backups");
  });

  it("rejects path escape from backup root", () => {
    const root = getBackupRoot(resolve("/app/public"));
    expect(() =>
      assertWithinBackupRoot(root, join(root, "..", "uploads", "x")),
    ).toThrow(/escapes backup root/);
  });

  it("rejects backup ids that escape the file name", () => {
    expect(() => assertSafeBackupId("../../package")).toThrow(
      /Invalid backup id/,
    );
    expect(() => assertSafeBackupId("a/b")).toThrow(/Invalid backup id/);
    expect(() => assertSafeBackupId("a\\b")).toThrow(/Invalid backup id/);
    expect(assertSafeBackupId("7f1c2e3a-4b5d-6789-abcd-ef0123456789")).toBe(
      "7f1c2e3a-4b5d-6789-abcd-ef0123456789",
    );
  });

  it("keeps retention at 5 snapshots", () => {
    expect(MAX_LOCAL_SNAPSHOTS).toBe(5);
  });
});
