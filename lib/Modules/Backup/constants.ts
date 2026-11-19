/** Kastir site package format constants (phase 22). */

export const PACKAGE_FORMAT = "kastir-site-package" as const;

/** Bump only on breaking package layout changes. */
export const PACKAGE_FORMAT_VERSION = 1;

/** Max local history snapshots (FIFO). Safety snapshots during apply are separate. */
export const MAX_LOCAL_SNAPSHOTS = 5;

/** Teto de intervalDays do backup automático (evita overflow de every no BullMQ). */
export const BACKUP_AUTO_INTERVAL_DAYS_MAX = 3650;

/** Exact confirmation phrase required for restore/import. */
export const RESTORE_CONFIRMATION_PHRASE = "RESTAURAR";

/** Max compressed package size (bytes). Override with BACKUP_MAX_BYTES. */
export function getBackupMaxBytes(): number {
  const raw = process.env.BACKUP_MAX_BYTES;
  if (raw && /^\d+$/.test(raw)) {
    const n = Number(raw);
    if (n > 0) return n;
  }
  // 512 MiB default — large enough for typical sites, bounded for DoS.
  return 512 * 1024 * 1024;
}

/** Max ZIP entries (manifest + data files + assets). */
export const BACKUP_MAX_ZIP_ENTRIES = 50_000;

/** Max uncompressed size for a single ZIP entry. */
export const BACKUP_MAX_ENTRY_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;

/** Max total uncompressed payload across all ZIP entries. */
export const BACKUP_MAX_TOTAL_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024;

/** Advisory lock key for destructive backup apply (import/restore). */
export const BACKUP_APPLY_LOCK_NAME = "kastir:backup-apply";

/**
 * Relative public URL path prefix for backups when stored under public/.
 * Must be denied by Nginx (see nginx.conf).
 */
export const BACKUP_PUBLIC_URL_PREFIX = "/_kastir/backups";

/** Directory name under public/_kastir/ */
export const BACKUP_DIR_NAME = "backups";

/**
 * Latest Prisma migration id applied by this codebase.
 * Update when adding migrations that affect importable domains.
 */
export const CURRENT_SCHEMA_VERSION =
  "20260813130000_add_page_and_snippet_revisions";

export const PACKAGE_DATA_FILES = [
  "pages.json",
  "page-folders.json",
  "page-revisions.json",
  "media.json",
  "media-folders.json",
  "settings.json",
  "custom-code.json",
  "snippet-revisions.json",
  "split-tests.json",
  "users.json",
] as const;

export type PackageDataFile = (typeof PACKAGE_DATA_FILES)[number];
