import "server-only";

import { Ratelimit } from "@upstash/ratelimit";

import { redisRateLimitClient, type RateLimitRedis } from "@/lib/ratelimit";
import { SPLIT_TELEMETRY_RATE_LIMIT } from "@/lib/Modules/SplitTests/constants";

type UpstashRedis = ConstructorParameters<typeof Ratelimit>[0]["redis"];

export type TelemetryWriteGate = (
  ip: string | null,
  campaignId: string,
) => Promise<boolean>;

export function createSplitTelemetryLimiter(redis: RateLimitRedis): Ratelimit {
  return new Ratelimit({
    redis: redis as unknown as UpstashRedis,
    limiter: Ratelimit.fixedWindow(
      SPLIT_TELEMETRY_RATE_LIMIT.requests,
      SPLIT_TELEMETRY_RATE_LIMIT.window,
    ),
    analytics: false,
    prefix: "kastir:split:telemetry",
  });
}

/**
 * Rate limits the durable Postgres write only — never the redirect response
 * or the Redis counter that feeds the destination selector. Fails open: a
 * limiter error (e.g. Redis down) is treated as "allowed", since telemetry
 * is best-effort and must never block on its own infrastructure.
 *
 * IMPORTANT — depends on `AUTH_TRUST_PROXY` (lib/auth-rate-limit.ts,
 * resolveClientIp): the caller (RedirectService) passes the IP resolved by
 * that helper, which returns `null` whenever `AUTH_TRUST_PROXY` is not
 * enabled. With `ip: null`, every visitor of a given campaign shares ONE
 * rate-limit key (`no-ip:${campaignId}`) — the per-visitor budget collapses
 * into a single per-campaign budget, and legitimate traffic bursts can
 * silently stop being recorded in SplitRedirectEvent/hitCount well before
 * any real abuse. Both `.env` and `.env.example` default this to `false`.
 * `nginx.conf` already forwards `X-Real-IP`/`X-Forwarded-For` correctly, so
 * any deployment that puts Next.js behind that Nginx (production/Docker)
 * should set `AUTH_TRUST_PROXY=true`; local `pnpm dev` without a proxy in
 * front should keep it `false` (there is no trusted hop to read from).
 */
export function createTelemetryWriteGate(
  limiter: Pick<Ratelimit, "limit">,
): TelemetryWriteGate {
  return async (ip, campaignId) => {
    try {
      const { success } = await limiter.limit(`${ip ?? "no-ip"}:${campaignId}`);
      return success;
    } catch {
      return true;
    }
  };
}

const splitTelemetryLimiter = createSplitTelemetryLimiter(redisRateLimitClient);

export const isTelemetryWriteAllowed: TelemetryWriteGate =
  createTelemetryWriteGate(splitTelemetryLimiter);
