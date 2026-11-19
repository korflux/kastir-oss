import { describe, expect, it, vi } from "vitest";

describe("rate limiter", () => {
  it("allows a request when the Redis-backed window has capacity", async () => {
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://kastir:kastir@localhost:5432/kastir",
    );
    vi.stubEnv("REDIS_URL", "redis://:kastir@localhost:6379");
    vi.stubEnv(
      "NEXTAUTH_SECRET",
      "a-secret-with-at-least-thirty-two-characters",
    );
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    vi.stubEnv("MASTER_EMAIL", "admin@example.com");
    vi.stubEnv("MASTER_PASSWORD", "change-me");

    const { createRateLimiter } = await import("@/lib/ratelimit");
    const redis = {
      evalsha: vi.fn().mockResolvedValue([1, 10]),
      eval: vi.fn().mockResolvedValue([1, 10]),
      get: vi.fn(),
      set: vi.fn(),
    };
    const limiter = createRateLimiter(redis);

    const result = await limiter.limit("phase-zero-smoke");

    expect(result.success).toBe(true);
    expect(result.limit).toBe(10);
    expect(result.remaining).toBe(9);
    expect(redis.evalsha).toHaveBeenCalledOnce();
  });
});
