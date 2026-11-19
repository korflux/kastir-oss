import { describe, expect, it, vi } from "vitest";

import { cloudflarePurge } from "@/lib/Cdn/cloudflarePurge";
import { encryptCloudflareToken } from "@/lib/Modules/Settings/Crypto";

const secret = "a-stable-test-secret-with-at-least-32-bytes";

describe("Cloudflare purge", () => {
  it("does not call the network without both credentials", async () => {
    const fetcher = vi.fn();
    await expect(
      cloudflarePurge("https://example.com/page", {
        credentials: {
          cloudflareApiTokenEncrypted: null,
          cloudflareZoneId: null,
        },
        fetcher,
      }),
    ).resolves.toEqual({ status: "SKIPPED" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("purges an absolute URL with Bearer credentials", async () => {
    vi.stubEnv("NEXTAUTH_SECRET", secret);
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      );
    const result = await cloudflarePurge("https://example.com/page", {
      credentials: {
        cloudflareApiTokenEncrypted: encryptCloudflareToken(
          "token-never-log",
          secret,
        ),
        cloudflareZoneId: "0123456789abcdef0123456789abcdef",
      },
      fetcher,
    });

    expect(result).toEqual({ status: "PURGED" });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/zones/0123456789abcdef0123456789abcdef/purge_cache",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: expect.stringMatching(/^Bearer /),
        }),
        body: JSON.stringify({ files: ["https://example.com/page"] }),
      }),
    );
  });

  it("purges multiple cache keys in one provider request", async () => {
    vi.stubEnv("NEXTAUTH_SECRET", secret);
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      );

    await expect(
      cloudflarePurge(
        ["https://example.com/", "https://example.com/favicon.webp"],
        {
          credentials: {
            cloudflareApiTokenEncrypted: encryptCloudflareToken(
              "token-never-log",
              secret,
            ),
            cloudflareZoneId: "zone-id",
          },
          fetcher,
        },
      ),
    ).resolves.toEqual({ status: "PURGED" });

    expect(fetcher.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({
          files: ["https://example.com/", "https://example.com/favicon.webp"],
        }),
      }),
    );
  });

  it("turns provider errors into a non-fatal result without exposing the token", async () => {
    vi.stubEnv("NEXTAUTH_SECRET", secret);
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response("nope", { status: 500 }));
    await expect(
      cloudflarePurge("https://example.com/page", {
        credentials: {
          cloudflareApiTokenEncrypted: encryptCloudflareToken(
            "token-never-log",
            secret,
          ),
          cloudflareZoneId: "0123456789abcdef0123456789abcdef",
        },
        fetcher,
      }),
    ).resolves.toEqual({
      status: "FAILED",
      message: "Cloudflare purge returned HTTP 500",
    });
  });
});
