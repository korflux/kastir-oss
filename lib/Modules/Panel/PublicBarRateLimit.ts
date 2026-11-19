import { createHash } from "node:crypto";

import { Ratelimit } from "@upstash/ratelimit";

import { env } from "@/lib/env";
import { resolveClientIp } from "@/lib/auth-rate-limit";
import {
  createRedisRateLimitClient,
  type RateLimitRedis,
} from "@/lib/ratelimit";

export const PUBLIC_BAR_RATE_LIMIT = {
  requests: 30,
  window: "60 s",
} as const;

type UpstashRedis = ConstructorParameters<typeof Ratelimit>[0]["redis"];

export type AdminBarRateLimiter = {
  limit(key: string): Promise<{ success: boolean }>;
};

export type AdminBarRateLimitResult = {
  allowed: boolean;
  unavailable: boolean;
};

export function createAdminBarRateLimiter(
  redis: RateLimitRedis,
): AdminBarRateLimiter {
  return new Ratelimit({
    redis: redis as unknown as UpstashRedis,
    limiter: Ratelimit.fixedWindow(
      PUBLIC_BAR_RATE_LIMIT.requests,
      PUBLIC_BAR_RATE_LIMIT.window,
    ),
    analytics: false,
    prefix: "kastir:ratelimit:admin-bar",
  });
}

const adminBarRateLimiter = createAdminBarRateLimiter(
  createRedisRateLimitClient(env.REDIS_URL),
);

/**
 * Builds a digested rate-limit identity for the published admin-bar session route.
 *
 * When `sessionUserId` is set, the bucket is per authenticated user.
 * When anonymous and `AUTH_TRUST_PROXY` is true, the client IP from trusted
 * proxy headers is used. When the proxy is not trusted (default in local
 * `pnpm dev` / Playwright), every anonymous request shares the conservative
 * `unknown-ip` bucket — intentional: we refuse to trust spoofable headers, so
 * a shared anonymous bucket is safer than client-supplied IPs. Authenticated
 * users still get per-user keys. Login uses a separate prefix and is unaffected.
 */
export function buildAdminBarRateLimitKey(
  request: Request,
  sessionUserId: string | null,
  trustProxy: boolean = env.AUTH_TRUST_PROXY,
): string {
  const identity = sessionUserId
    ? `user:${sessionUserId}`
    : `ip:${resolveClientIp(request, trustProxy) ?? "unknown-ip"}`;

  return createHash("sha256").update(identity, "utf8").digest("hex");
}

export async function checkAdminBarRateLimit(
  request: Request,
  sessionUserId: string | null,
  limiter: AdminBarRateLimiter = adminBarRateLimiter,
  trustProxy: boolean = env.AUTH_TRUST_PROXY,
): Promise<AdminBarRateLimitResult> {
  const key = buildAdminBarRateLimitKey(request, sessionUserId, trustProxy);

  try {
    const result = await limiter.limit(`admin-bar:session:${key}`);
    return { allowed: result.success, unavailable: false };
  } catch {
    return { allowed: false, unavailable: true };
  }
}
