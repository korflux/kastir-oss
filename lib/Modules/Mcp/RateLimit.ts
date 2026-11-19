import { createHash } from "node:crypto";

import { Ratelimit } from "@upstash/ratelimit";

import { env } from "@/lib/env";
import { resolveClientIp } from "@/lib/auth-rate-limit";
import {
  createRedisRateLimitClient,
  type RateLimitRedis,
} from "@/lib/ratelimit";
import { digestToken } from "@/lib/Modules/Users/Token";
import {
  McpPayloadTooLargeError,
  McpRateLimitError,
  McpRateLimitUnavailableError,
} from "@/lib/Modules/Mcp/Errors";

export type McpRateLimitKind = "read" | "mutation";

/** Teto de items num batch JSON-RPC — um POST não pode amplificar N tools/call. */
export const MCP_MAX_BATCH_ITEMS = 32;

export const MCP_RATE_LIMITS = {
  read: { requests: 120, window: "60 s" },
  mutation: { requests: 30, window: "60 s" },
} as const;

type UpstashRedis = ConstructorParameters<typeof Ratelimit>[0]["redis"];

export function createMcpRateLimiter(
  kind: McpRateLimitKind,
  redis: RateLimitRedis,
) {
  const config = MCP_RATE_LIMITS[kind];

  return new Ratelimit({
    redis: redis as unknown as UpstashRedis,
    limiter: Ratelimit.fixedWindow(config.requests, config.window),
    analytics: false,
    prefix: "kastir:ratelimit:mcp:" + kind,
  });
}

const redis = createRedisRateLimitClient(env.REDIS_URL);
const limiters = new Map<
  McpRateLimitKind,
  ReturnType<typeof createMcpRateLimiter>
>();

function getMcpRateLimiter(kind: McpRateLimitKind) {
  let limiter = limiters.get(kind);

  if (!limiter) {
    limiter = createMcpRateLimiter(kind, redis);
    limiters.set(kind, limiter);
  }

  return limiter;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Read = tool name *suffix*, never substring: `includes("_settings")` used to
 * classify `kastir_settings_update` (the most sensitive mutation) as a read.
 * Every tool name ends in its verb, so the suffix is the right discriminant.
 * Unknown names fall through to `mutation` (the stricter bucket) by design.
 */
const READ_TOOL_SUFFIXES = [
  "_list",
  "_get",
  "_preview",
  "_download",
  "_context",
  "_stats",
];

function isReadToolName(name: string): boolean {
  return READ_TOOL_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

export function getMcpRateLimitKind(body: unknown): McpRateLimitKind {
  if (Array.isArray(body)) {
    return body.some((item) => getMcpRateLimitKind(item) === "mutation")
      ? "mutation"
      : "read";
  }

  if (!isObject(body) || body.method !== "tools/call") {
    return "read";
  }

  const params = body.params;
  const toolName =
    isObject(params) && typeof params.name === "string" ? params.name : null;

  return toolName && isReadToolName(toolName) ? "read" : "mutation";
}

/** Recusa batch JSON-RPC acima do teto antes de gastar Redis/introspecção. */
export function assertMcpBatchSize(body: unknown): void {
  if (Array.isArray(body) && body.length > MCP_MAX_BATCH_ITEMS) {
    throw new McpPayloadTooLargeError();
  }
}

function clientIp(request: Request): string {
  return resolveClientIp(request, env.AUTH_TRUST_PROXY) ?? "unknown-ip";
}

/** Bucket por IP+token — um token válido continua limitado por cliente. */
export function buildMcpRateLimitTokenKey(
  request: Request,
  token: string,
): string {
  return createHash("sha256")
    .update(`${clientIp(request)}:${digestToken(token)}`, "utf8")
    .digest("hex");
}

/** Bucket só por IP — rotacionar token-lixo não abre janela nova. */
export function buildMcpRateLimitIpKey(request: Request): string {
  return createHash("sha256")
    .update(`ip:${clientIp(request)}`, "utf8")
    .digest("hex");
}

export async function assertMcpRateLimit(
  request: Request,
  token: string,
  kind: McpRateLimitKind,
): Promise<void> {
  try {
    const limiter = getMcpRateLimiter(kind);
    const [tokenResult, ipResult] = await Promise.all([
      limiter.limit("token:" + buildMcpRateLimitTokenKey(request, token)),
      limiter.limit("ip:" + buildMcpRateLimitIpKey(request)),
    ]);

    if (!tokenResult.success || !ipResult.success) {
      throw new McpRateLimitError();
    }
  } catch (error) {
    if (error instanceof McpRateLimitError) {
      throw error;
    }

    throw new McpRateLimitUnavailableError();
  }
}
