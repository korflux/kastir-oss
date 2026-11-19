import { describe, expect, it, vi } from "vitest";

const { limit } = vi.hoisted(() => ({
  limit: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  env: {
    REDIS_URL: "redis://:kastir@localhost:6379",
    AUTH_TRUST_PROXY: false,
  },
}));

vi.mock("@/lib/ratelimit", () => ({
  createRedisRateLimitClient: vi.fn(() => ({})),
}));

vi.mock("@upstash/ratelimit", () => {
  class RatelimitMock {
    limit = limit;

    static fixedWindow(requests: number, window: string) {
      return { requests, window };
    }
  }

  return { Ratelimit: RatelimitMock };
});

import { isUserTokenRequestAllowed } from "@/lib/Modules/Users/RateLimit";

describe("phase 13 user-token rate limit", () => {
  it("fails closed when Redis is unavailable and never logs the raw token", async () => {
    limit.mockRejectedValueOnce(new Error("redis unavailable"));

    const request = new Request(
      "https://panel.example.test/admin/invite/raw-token",
    );
    await expect(isUserTokenRequestAllowed(request, "raw-token")).resolves.toBe(
      false,
    );

    expect(limit).toHaveBeenCalledWith(
      expect.stringMatching(/^user-token:[a-f0-9]{64}$/),
    );
    expect(limit.mock.calls[0]?.[0]).not.toContain("raw-token");
  });
});
