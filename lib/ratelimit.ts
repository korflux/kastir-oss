import { Ratelimit } from "@upstash/ratelimit";
import IORedis from "ioredis";

import { env } from "@/lib/env";

type UpstashRedis = ConstructorParameters<typeof Ratelimit>[0]["redis"];
type RedisArgument = string | number;

export interface RateLimitRedis {
  evalsha(sha: string, keys: string[], args: RedisArgument[]): Promise<unknown>;
  eval(script: string, keys: string[], args: RedisArgument[]): Promise<unknown>;
  get(key: string): Promise<unknown>;
  set(...args: RedisArgument[]): Promise<unknown>;
}

export function createRateLimiter(redis: RateLimitRedis) {
  return new Ratelimit({
    redis: redis as unknown as UpstashRedis,
    limiter: Ratelimit.fixedWindow(10, "10 s"),
    analytics: false,
    prefix: "kastir:ratelimit",
  });
}

export function createRedisRateLimitClient(redisUrl: string): RateLimitRedis {
  const redis = new IORedis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });

  return {
    evalsha: (sha, keys, args) =>
      redis.evalsha(sha, keys.length, ...keys, ...args),
    eval: (script, keys, args) =>
      redis.eval(script, keys.length, ...keys, ...args),
    get: (key) => redis.get(key),
    set: (...args) => redis.call("SET", ...args),
  };
}

export const redisRateLimitClient = createRedisRateLimitClient(env.REDIS_URL);
export const rateLimiter = createRateLimiter(redisRateLimitClient);
