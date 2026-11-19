import { createHash } from "node:crypto";

import { Ratelimit } from "@upstash/ratelimit";

import { env } from "@/lib/env";
import { resolveClientIp } from "@/lib/auth-rate-limit";
import {
  createRedisRateLimitClient,
  type RateLimitRedis,
} from "@/lib/ratelimit";

export const PREVIEW_RATE_LIMIT = {
  requests: 30,
  window: "60 s",
} as const;

type UpstashRedis = ConstructorParameters<typeof Ratelimit>[0]["redis"];

/** Limiter do preview privado — recompile de rascunho não pode ser martelado. */
export function createPreviewRateLimiter(redis: RateLimitRedis) {
  return new Ratelimit({
    redis: redis as unknown as UpstashRedis,
    limiter: Ratelimit.fixedWindow(
      PREVIEW_RATE_LIMIT.requests,
      PREVIEW_RATE_LIMIT.window,
    ),
    analytics: false,
    prefix: "kastir:ratelimit:preview",
  });
}

const previewRateLimiter = createPreviewRateLimiter(
  createRedisRateLimitClient(env.REDIS_URL),
);

/** Bucket sessão+IP — um user autenticado não zera a janela trocando de rede. */
export function buildPreviewRateLimitKey(
  request: Request,
  userId: string,
  trustProxy: boolean = env.AUTH_TRUST_PROXY,
): string {
  const ip = resolveClientIp(request, trustProxy) ?? "unknown-ip";
  return createHash("sha256").update(`${ip}:${userId}`, "utf8").digest("hex");
}

export async function isPreviewRequestAllowed(
  request: Request,
  userId: string,
): Promise<boolean> {
  try {
    const key = buildPreviewRateLimitKey(request, userId);
    const result = await previewRateLimiter.limit("preview:" + key);
    return result.success;
  } catch {
    return false;
  }
}
