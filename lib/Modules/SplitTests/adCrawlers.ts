/**
 * UAs of crawlers Meta itself fires against ad links (policy review +
 * link preview on Facebook/Instagram/WhatsApp). Not human clicks — keep
 * them out of hitCount / SplitRedirectEvent / Redis counters.
 *
 * Deliberately separate from AI_CRAWLER_USER_AGENTS in generateRobotsTxt
 * (robots/opt-out of AI training vs split telemetry). Same string may
 * appear in both lists; do not share a module.
 */
export const AD_REVIEW_CRAWLER_USER_AGENTS = [
  "facebookexternalhit",
  "Meta-ExternalAgent",
  "WhatsApp",
] as const;

/** Pure predicate: case-insensitive substring match on User-Agent. */
export function isAdReviewCrawler(userAgent: string | null): boolean {
  if (!userAgent) return false;
  const lower = userAgent.toLowerCase();
  return AD_REVIEW_CRAWLER_USER_AGENTS.some((ua) =>
    lower.includes(ua.toLowerCase()),
  );
}
