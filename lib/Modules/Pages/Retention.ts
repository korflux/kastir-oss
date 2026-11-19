export const PAGE_TRASH_RETENTION_DAYS = 30;
export const PAGE_TRASH_RETENTION_MS =
  PAGE_TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
/** Max trashed pages processed per expire job batch query. */
export const PAGE_TRASH_EXPIRE_BATCH_SIZE = 50;
