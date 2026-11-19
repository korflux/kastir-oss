import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getSession,
  listMedia,
  listMediaPaginated,
  listFolders,
  uploadMany,
  updateMetadata,
  convertToWebp,
  createFolder,
} = vi.hoisted(() => ({
  getSession: vi.fn(),
  listMedia: vi.fn(),
  listMediaPaginated: vi.fn(),
  listFolders: vi.fn(),
  uploadMany: vi.fn(),
  updateMetadata: vi.fn(),
  convertToWebp: vi.fn(),
  createFolder: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));
vi.mock("@/lib/Modules/Media/Service", () => ({
  mediaService: {
    listMedia,
    listMediaPaginated,
    uploadMany,
    updateMetadata,
    convertToWebp,
  },
}));
vi.mock("@/lib/Modules/Media/FolderService", () => ({
  mediaFolderService: {
    listFolders,
    createFolder,
  },
}));

import { GET, POST } from "@/app/api/admin/media/route";
import { PATCH } from "@/app/api/admin/media/[mediaId]/route";
import { POST as convertPost } from "@/app/api/admin/media/[mediaId]/convert/route";
import { POST as createFolderPost } from "@/app/api/admin/media/folders/route";

const routeContext = (mediaId: string) => ({
  params: Promise.resolve({ mediaId }),
});

describe("admin media API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost");
    listMedia.mockResolvedValue([]);
    listMediaPaginated.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 8,
    });
    listFolders.mockResolvedValue([]);
    uploadMany.mockResolvedValue({ items: [], errors: [] });
    updateMetadata.mockResolvedValue({ id: "media-id", name: "Updated" });
    convertToWebp.mockResolvedValue({
      id: "media-id",
      processingStatus: "PROCESSING",
    });
    createFolder.mockResolvedValue({ id: "folder-id", name: "Assets" });
  });

  it("requires an authenticated session", async () => {
    getSession.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/admin/media"));

    expect(response.status).toBe(401);
  });

  it("lists media and folders with safe query filters", async () => {
    getSession.mockResolvedValue({ user: { id: "user-id", role: "EDITOR" } });

    const response = await GET(
      new Request(
        "http://localhost/api/admin/media?folderId=folder-id&q=logo&status=READY",
      ),
    );

    expect(response.status).toBe(200);
    expect(listMedia).toHaveBeenCalledWith({
      folderId: "folder-id",
      includeDescendants: true,
      search: "logo",
      processingStatus: "READY",
    });
    await expect(response.json()).resolves.toEqual({ media: [], folders: [] });
  });

  it("paginates media when page/pageSize are provided", async () => {
    getSession.mockResolvedValue({ user: { id: "user-id", role: "EDITOR" } });
    listMediaPaginated.mockResolvedValueOnce({
      items: [{ id: "m1" }],
      total: 9,
      page: 1,
      pageSize: 8,
    });

    const response = await GET(
      new Request("http://localhost/api/admin/media?page=1&pageSize=8"),
    );

    expect(response.status).toBe(200);
    expect(listMediaPaginated).toHaveBeenCalledWith({
      folderId: undefined,
      includeDescendants: false,
      search: undefined,
      processingStatus: undefined,
      page: 1,
      pageSize: 8,
    });
    await expect(response.json()).resolves.toEqual({
      media: [{ id: "m1" }],
      folders: [],
      total: 9,
      page: 1,
      pageSize: 8,
    });
    expect(listMedia).not.toHaveBeenCalled();
  });

  it("accepts multiple multipart files and uses the authenticated user", async () => {
    getSession.mockResolvedValue({ user: { id: "user-id", role: "ADMIN" } });
    const form = new FormData();
    form.set("folderId", "folder-id");
    form.append(
      "files",
      new File(["pdf"], "brief.pdf", { type: "application/pdf" }),
    );
    form.append(
      "files",
      new File(["svg"], "logo.svg", { type: "image/svg+xml" }),
    );

    const response = await POST(
      new Request("http://localhost/api/admin/media", {
        method: "POST",
        headers: { origin: "http://localhost", "content-length": "4096" },
        body: form,
      }),
    );

    expect(response.status).toBe(201);
    expect(uploadMany).toHaveBeenCalledWith("user-id", [
      expect.objectContaining({ folderId: "folder-id", fileName: "brief.pdf" }),
      expect.objectContaining({ folderId: "folder-id", fileName: "logo.svg" }),
    ]);
  });

  it("does not trust client-controlled identity fields for metadata", async () => {
    getSession.mockResolvedValue({ user: { id: "user-id", role: "EDITOR" } });

    const response = await PATCH(
      new Request("http://localhost/api/admin/media/media-id", {
        method: "PATCH",
        body: JSON.stringify({
          name: "Updated",
          userId: "attacker",
          role: "MASTER",
        }),
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
        },
      }),
      routeContext("media-id"),
    );

    expect(response.status).toBe(200);
    expect(updateMetadata).toHaveBeenCalledWith("user-id", {
      name: "Updated",
      id: "media-id",
    });
  });

  it("accepts a folder-only media move without changing the actor", async () => {
    getSession.mockResolvedValue({ user: { id: "user-id", role: "EDITOR" } });

    const response = await PATCH(
      new Request("http://localhost/api/admin/media/media-id", {
        method: "PATCH",
        body: JSON.stringify({ folderId: "target-folder" }),
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
        },
      }),
      routeContext("media-id"),
    );

    expect(response.status).toBe(200);
    expect(updateMetadata).toHaveBeenCalledWith("user-id", {
      folderId: "target-folder",
      id: "media-id",
    });
  });

  it("queues manual WebP conversion for the authenticated user", async () => {
    getSession.mockResolvedValue({ user: { id: "user-id", role: "EDITOR" } });

    const response = await convertPost(
      new Request("http://localhost/api/admin/media/media-id/convert", {
        method: "POST",
        headers: { origin: "http://localhost" },
      }),
      routeContext("media-id"),
    );

    expect(response.status).toBe(202);
    expect(convertToWebp).toHaveBeenCalledWith("user-id", "media-id");
  });

  it("creates folders only from sanitized JSON payloads", async () => {
    getSession.mockResolvedValue({ user: { id: "user-id", role: "ADMIN" } });

    const response = await createFolderPost(
      new Request("http://localhost/api/admin/media/folders", {
        method: "POST",
        body: JSON.stringify({
          name: "Assets",
          userId: "attacker",
          role: "MASTER",
        }),
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
        },
      }),
    );

    expect(response.status).toBe(201);
    expect(createFolder).toHaveBeenCalledWith("user-id", { name: "Assets" });
  });
});
