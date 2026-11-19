import { beforeEach, describe, expect, it, vi } from "vitest";

const { limit, Ratelimit } = vi.hoisted(() => {
  const limit = vi.fn();
  class Ratelimit {
    static fixedWindow = vi.fn(() => ({}));
    limit = limit;
  }
  return { limit, Ratelimit };
});

vi.mock("@upstash/ratelimit", () => ({ Ratelimit }));

vi.mock("@/lib/env", () => ({
  env: { REDIS_URL: "redis://localhost:6379", AUTH_TRUST_PROXY: true },
}));

vi.mock("@/lib/ratelimit", () => ({
  createRedisRateLimitClient: vi.fn(() => ({})),
}));

describe("private preview rate limit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function previewRequest(ip: string) {
    return new Request("http://localhost:3000/p/draft", {
      headers: { "x-forwarded-for": ip },
    });
  }

  it("keys the bucket by IP and session, never the raw user id", async () => {
    limit.mockResolvedValueOnce({ success: true });
    const { isPreviewRequestAllowed, buildPreviewRateLimitKey } =
      await import("@/lib/Modules/Pages/PreviewRateLimit");

    await expect(
      isPreviewRequestAllowed(previewRequest("203.0.113.10"), "user-1"),
    ).resolves.toBe(true);
    expect(limit).toHaveBeenCalledWith(expect.stringMatching(/^preview:/));
    expect(
      buildPreviewRateLimitKey(previewRequest("203.0.113.10"), "user-1"),
    ).not.toContain("user-1");
    expect(
      buildPreviewRateLimitKey(previewRequest("203.0.113.10"), "user-1"),
    ).not.toBe(
      buildPreviewRateLimitKey(previewRequest("203.0.113.11"), "user-1"),
    );
  });

  it("fails closed when Redis cannot evaluate the limit", async () => {
    limit.mockRejectedValueOnce(new Error("redis unavailable"));
    const { isPreviewRequestAllowed } =
      await import("@/lib/Modules/Pages/PreviewRateLimit");

    await expect(
      isPreviewRequestAllowed(previewRequest("203.0.113.10"), "user-1"),
    ).resolves.toBe(false);
  });
});
