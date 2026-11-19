import { describe, expect, it, vi } from "vitest";

const getMedia = vi.hoisted(() => vi.fn());
const hasPublicBytes = vi.hoisted(() => vi.fn());
const readPublic = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));

vi.mock("@/lib/env", () => ({
  env: { NEXTAUTH_SECRET: "test-secret-with-at-least-32-characters" },
}));

vi.mock("@/lib/Modules/Media/Service", () => ({
  mediaService: { getMedia, hasPublicBytes },
}));

vi.mock("@/lib/Processing/mediaStorage", () => ({
  createMediaStorage: () => ({ readPublic }),
}));

const media = {
  id: "media-1",
  fileName: "logo.png",
  mimeType: "image/png",
  processingStatus: "READY",
};

describe("MCP signed media download", () => {
  it("rejects invalid signatures before reading the database or filesystem", async () => {
    const { GET } =
      await import("@/app/api/mcp/media/[mediaId]/download/route");
    const response = await GET(
      new Request(
        "https://public.example/api/mcp/media/media-1/download?expires=9999999999&sig=bad",
      ),
      { params: Promise.resolve({ mediaId: "media-1" }) },
    );

    expect(response.status).toBe(404);
    expect(getMedia).not.toHaveBeenCalled();
    expect(readPublic).not.toHaveBeenCalled();
  });

  it("reads only the signed media record and returns bytes with safe headers", async () => {
    getMedia.mockResolvedValueOnce(media);
    hasPublicBytes.mockResolvedValueOnce(true);
    readPublic.mockResolvedValueOnce(Buffer.from("image-bytes"));
    const { createMcpMediaDownloadUrl } =
      await import("@/lib/Modules/Mcp/MediaDownload");
    const signed = createMcpMediaDownloadUrl({
      baseUrl: "https://public.example/api/mcp",
      mediaId: "media-1",
      now: Math.floor(Date.now() / 1000),
      ttlSeconds: 300,
    });
    const { GET } =
      await import("@/app/api/mcp/media/[mediaId]/download/route");
    const response = await GET(new Request(signed.url), {
      params: Promise.resolve({ mediaId: "media-1" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-disposition")).toContain("logo.png");
    await expect(response.text()).resolves.toBe("image-bytes");
    expect(readPublic).toHaveBeenCalledWith("media-1", "logo.png");
  });
});
