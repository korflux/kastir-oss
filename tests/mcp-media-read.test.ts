import { describe, expect, it, vi } from "vitest";

const listMediaPaginated = vi.hoisted(() => vi.fn());
const getMedia = vi.hoisted(() => vi.fn());
const hasPublicBytes = vi.hoisted(() => vi.fn());
const listFoldersPage = vi.hoisted(() => vi.fn());

vi.mock("@/lib/Modules/Media/Service", () => ({
  mediaService: { listMediaPaginated, getMedia, hasPublicBytes },
}));

vi.mock("@/lib/Modules/Media/FolderService", () => ({
  mediaFolderService: { listFoldersPage },
}));

vi.mock("@/lib/env", () => ({
  env: {
    NEXTAUTH_SECRET: "test-secret-with-at-least-32-characters",
  },
}));

const context = {
  actor: { id: "user-1", name: "Admin", email: "admin@example.test" },
  userId: "user-1",
  role: "ADMIN" as const,
  scopes: ["cms:read" as const],
  clientId: "client-1",
  resource: "https://public.example/api/mcp",
  requestId: "request-1",
};

const media = {
  id: "media-1",
  name: "logo",
  fileName: "logo.png",
  url: "/uploads/media-1/logo.png",
  mimeType: "image/png",
  category: "IMAGE_RASTER" as const,
  sizeBytes: 42,
  alt: "Logo",
  description: null,
  folderId: "folder-1",
  processingStatus: "READY" as const,
  processingToken: "secret-processing-token",
  createdAt: new Date("2026-07-20T10:00:00.000Z"),
  updatedAt: new Date("2026-07-22T10:00:00.000Z"),
};

describe("MCP Media read tools", () => {
  it("returns paginated safe metadata without processing tokens", async () => {
    listMediaPaginated.mockResolvedValueOnce({
      items: [media],
      total: 4,
      page: 1,
      pageSize: 2,
    });
    const { listMcpMedia } = await import("@/lib/Modules/Mcp/Tools/Media");
    const result = await listMcpMedia(context, {
      page: 1,
      pageSize: 2,
      category: "IMAGE_RASTER",
    });

    expect(result.items[0]).toMatchObject({
      id: "media-1",
      fileName: "logo.png",
      processingStatus: "READY",
    });
    expect(result.items[0]).not.toHaveProperty("processingToken");
    expect(result.items[0]).not.toHaveProperty("createdAt");
    expect(result.items[0]).not.toHaveProperty("updatedAt");
    expect(result.pagination).toMatchObject({
      totalItems: 4,
      hasNextPage: true,
    });
    expect(listMediaPaginated).toHaveBeenCalledWith({
      page: 1,
      pageSize: 2,
      category: "IMAGE_RASTER",
    });
  });

  it("keeps timestamps on the media detail even though the list drops them", async () => {
    getMedia.mockResolvedValueOnce(media);
    const { getMcpMedia } = await import("@/lib/Modules/Mcp/Tools/Media");
    const result = await getMcpMedia(context, { mediaId: "media-1" });

    expect(result).toMatchObject({
      id: "media-1",
      createdAt: media.createdAt,
      updatedAt: media.updatedAt,
    });
    expect(result).not.toHaveProperty("processingToken");
  });

  it("returns a short-lived signed download URL only for available bytes", async () => {
    getMedia.mockResolvedValueOnce(media);
    hasPublicBytes.mockResolvedValueOnce(true);
    const { downloadMcpMedia } = await import("@/lib/Modules/Mcp/Tools/Media");
    const result = await downloadMcpMedia(context, { mediaId: "media-1" });

    expect(result.mediaId).toBe("media-1");
    expect(result.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(result.url).toMatch(
      /^https:\/\/public\.example\/api\/mcp\/media\/media-1\/download\?/,
    );
    expect(result.url).not.toContain("processing-token");
  });

  it("requires cms:read before touching Media", async () => {
    listMediaPaginated.mockClear();
    const { listMcpMedia } = await import("@/lib/Modules/Mcp/Tools/Media");
    await expect(
      listMcpMedia({ ...context, scopes: [] }, {}),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(listMediaPaginated).not.toHaveBeenCalled();
  });

  it("uses the common pagination envelope for media folders", async () => {
    listFoldersPage.mockResolvedValueOnce({
      items: [
        {
          id: "folder-1",
          name: "Images",
          parentId: "base",
          color: "blue",
          isBase: false,
        },
      ],
      total: 1,
    });
    const { listMcpMediaFolders } =
      await import("@/lib/Modules/Mcp/Tools/Media");
    await expect(
      listMcpMediaFolders(context, { parentId: "base" }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ id: "folder-1" })],
      pagination: { totalItems: 1, hasNextPage: false },
    });
    expect(listFoldersPage).toHaveBeenCalledWith({
      parentId: "base",
      skip: 0,
      take: 20,
    });
  });
});
