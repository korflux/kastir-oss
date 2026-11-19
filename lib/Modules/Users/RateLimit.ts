import { createHash } from "node:crypto";

import { Ratelimit } from "@upstash/ratelimit";

import { env } from "@/lib/env";
import {
  createRedisRateLimitClient,
  type RateLimitRedis,
} from "@/lib/ratelimit";
import { resolveClientIp } from "@/lib/auth-rate-limit";
import { digestToken } from "@/lib/Modules/Users/Token";

export const USER_TOKEN_RATE_LIMIT = {
  requests: 10,
  window: "60 s",
} as const;

type UpstashRedis = ConstructorParameters<typeof Ratelimit>[0]["redis"];

export function createUserTokenRateLimiter(redis: RateLimitRedis) {
  return new Ratelimit({
    redis: redis as unknown as UpstashRedis,
    limiter: Ratelimit.fixedWindow(
      USER_TOKEN_RATE_LIMIT.requests,
      USER_TOKEN_RATE_LIMIT.window,
    ),
    analytics: false,
    prefix: "kastir:ratelimit:user-token",
  });
}

const userTokenRateLimiter = createUserTokenRateLimiter(
  createRedisRateLimitClient(env.REDIS_URL),
);

export function buildUserTokenRateLimitKey(
  request: Request,
  rawToken: string,
  trustProxy: boolean = env.AUTH_TRUST_PROXY,
): string {
  const ip = resolveClientIp(request, trustProxy) ?? "unknown-ip";
  const tokenDigest = digestToken(rawToken);
  return createHash("sha256")
    .update(`${ip}:${tokenDigest}`, "utf8")
    .digest("hex");
}

/** Bucket só por IP — token rotável não abre janela nova no accept. */
export function buildUserTokenIpRateLimitKey(
  request: Request,
  trustProxy: boolean = env.AUTH_TRUST_PROXY,
): string {
  const ip = resolveClientIp(request, trustProxy) ?? "unknown-ip";
  return createHash("sha256").update(`ip:${ip}`, "utf8").digest("hex");
}

export async function isUserTokenRequestAllowed(
  request: Request,
  rawToken: string,
): Promise<boolean> {
  try {
    const key = buildUserTokenRateLimitKey(request, rawToken);
    const result = await userTokenRateLimiter.limit(`user-token:${key}`);
    return result.success;
  } catch {
    // A token endpoint must fail closed when its abuse-control dependency is unavailable.
    return false;
  }
}

/** Accept: IP+token e IP sem token. Rotacionar o token não zera o teto por IP. */
export async function isUserTokenAcceptAllowed(
  request: Request,
  rawToken: string,
): Promise<boolean> {
  try {
    const tokenKey = buildUserTokenRateLimitKey(request, rawToken);
    const ipKey = buildUserTokenIpRateLimitKey(request);
    const [tokenResult, ipResult] = await Promise.all([
      userTokenRateLimiter.limit(`user-token:${tokenKey}`),
      userTokenRateLimiter.limit(`user-token-ip:${ipKey}`),
    ]);
    return tokenResult.success && ipResult.success;
  } catch {
    return false;
  }
}
