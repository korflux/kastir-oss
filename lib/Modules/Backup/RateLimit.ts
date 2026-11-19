import { Ratelimit } from "@upstash/ratelimit";

import { redisRateLimitClient, type RateLimitRedis } from "@/lib/ratelimit";

/** Coarse limit: export/import are expensive and disk-heavy. */
export function createBackupRateLimiter(
  redis: RateLimitRedis = redisRateLimitClient,
) {
  return new Ratelimit({
    // Upstash types are stricter than our thin Redis wrapper; cast matches
    // other panel rate limiters in this codebase.
    redis: redis as never,
    limiter: Ratelimit.slidingWindow(10, "10 m"),
    prefix: "kastir:ratelimit:backup",
    analytics: false,
  });
}

let shared: ReturnType<typeof createBackupRateLimiter> | undefined;

export function getBackupRateLimiter() {
  shared ??= createBackupRateLimiter();
  return shared;
}

export async function assertBackupRateLimit(userId: string): Promise<void> {
  try {
    const result = await getBackupRateLimiter().limit(`user:${userId}`);
    if (!result.success) {
      const error = new Error("Too many backup operations. Try again later.");
      (error as Error & { code?: string }).code = "RATE_LIMITED";
      throw error;
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (error as Error & { code?: string }).code === "RATE_LIMITED"
    ) {
      throw error;
    }
    // If Redis is unavailable, fail open — size limits still apply.
  }
}
