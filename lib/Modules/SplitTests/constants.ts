/** Hits below this use weighted random; at/above use deficit balancing. */
export const COLD_START_THRESHOLD = 50;

/** Public campaign path prefix (no trailing slash). */
export const SPLIT_PUBLIC_PREFIX = "/s";

/** Raw SplitRedirectEvent rows older than this are rolled up and purged. */
export const SPLIT_EVENT_RETENTION_DAYS = 30;
export const SPLIT_EVENT_RETENTION_MS =
  SPLIT_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
/** Max raw events processed per expire job batch query. */
export const SPLIT_EVENT_PURGE_BATCH_SIZE = 500;

/** Durable telemetry write limit per IP+campaign (does not gate the redirect). */
export const SPLIT_TELEMETRY_RATE_LIMIT = {
  requests: 20,
  window: "10 s",
} as const;

export function campaignPublicPath(slug: string): string {
  return `${SPLIT_PUBLIC_PREFIX}/${slug}`;
}
