import { createHash } from "node:crypto";

import { Ratelimit } from "@upstash/ratelimit";

import { env } from "@/lib/env";
import {
  createRedisRateLimitClient,
  type RateLimitRedis,
} from "@/lib/ratelimit";

const signInPath = "/sign-in/email";

/** Stricter window for credential brute-force than the generic limiter. */
export const SIGN_IN_RATE_LIMIT = {
  requests: 5,
  window: "60 s",
} as const;

/** Broader password-spraying guard shared by all accounts behind one IP. */
export const SIGN_IN_IP_RATE_LIMIT = {
  requests: 25,
  window: "60 s",
} as const;

type UpstashRedis = ConstructorParameters<typeof Ratelimit>[0]["redis"];

export function createSignInRateLimiter(
  redis: RateLimitRedis,
  policy: { requests: number; window: `${number} s` } = SIGN_IN_RATE_LIMIT,
  prefix = "kastir:ratelimit:signin",
) {
  return new Ratelimit({
    redis: redis as unknown as UpstashRedis,
    limiter: Ratelimit.fixedWindow(policy.requests, policy.window),
    analytics: false,
    prefix,
  });
}

const signInRedis = createRedisRateLimitClient(env.REDIS_URL);
export const signInRateLimiter = createSignInRateLimiter(signInRedis);
export const signInIpRateLimiter = createSignInRateLimiter(
  signInRedis,
  SIGN_IN_IP_RATE_LIMIT,
  "kastir:ratelimit:signin-ip",
);

/**
 * Resolves a client IP only when AUTH_TRUST_PROXY is enabled.
 * Otherwise returns null so callers must not trust client-supplied headers.
 */
export function resolveClientIp(
  request: Request,
  trustProxy: boolean = env.AUTH_TRUST_PROXY,
): string | null {
  if (!trustProxy) {
    return null;
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  return forwardedFor?.split(",", 1)[0]?.trim() || null;
}

function hashRateLimitIdentity(material: string): string {
  return createHash("sha256").update(material).digest("hex");
}

export function buildSignInRateLimitKeys(
  request: Request,
  email: string,
  trustProxy: boolean = env.AUTH_TRUST_PROXY,
): { email: string; ip: string | null } {
  const normalizedEmail = email.trim().toLowerCase() || "unknown";
  const ip = resolveClientIp(request, trustProxy);

  return {
    email: hashRateLimitIdentity(`email:${normalizedEmail}`),
    ip: ip ? hashRateLimitIdentity(`ip:${ip}`) : null,
  };
}

async function requestEmail(request: Request): Promise<string> {
  try {
    const body = (await request.clone().json()) as { email?: unknown };
    return typeof body.email === "string"
      ? body.email.trim().toLowerCase()
      : "unknown";
  } catch {
    return "unknown";
  }
}

export function isEmailSignInRequest(request: Request): boolean {
  return new URL(request.url).pathname.endsWith(signInPath);
}

export async function isAuthRequestAllowed(request: Request): Promise<boolean> {
  const email = await requestEmail(request);
  const keys = buildSignInRateLimitKeys(request, email);
  const checks = [
    signInRateLimiter.limit(`auth:sign-in:${keys.email}`),
    ...(keys.ip
      ? [signInIpRateLimiter.limit(`auth:sign-in-ip:${keys.ip}`)]
      : []),
  ];

  return (await Promise.all(checks)).every((result) => result.success);
}
