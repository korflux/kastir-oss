export const LOG_ENTRY_RETENTION_DAYS = 180;
export const LOG_ENTRY_RETENTION_MS =
  LOG_ENTRY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
/** Max log entries processed per expire job batch query. */
export const LOG_ENTRY_PURGE_BATCH_SIZE = 500;
