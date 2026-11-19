import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, listPages, listFolders, createPage, updatePage } =
  vi.hoisted(() => ({
    getSession: vi.fn(),
    listPages: vi.fn(),
    listFolders: vi.fn(),
    createPage: vi.fn(),
    updatePage: vi.fn(),
  }));

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));
vi.mock("@/lib/Modules/Pages/Service", () => ({
  pageService: { listPages, createPage, updatePage },
}));
vi.mock("@/lib/Modules/Pages/FolderService", () => ({
  folderService: { listFolders },
}));

import { GET, POST } from "@/app/api/admin/pages/route";
import { PUT } from "@/app/api/admin/pages/[pageId]/route";

const routeContext = (pageId: string) => ({
  params: Promise.resolve({ pageId }),
});

describe("admin pages collection API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    listPages.mockResolvedValue([]);
    listFolders.mockResolvedValue([]);
    createPage.mockResolvedValue({ id: "page-id", slug: "landing" });
    updatePage.mockResolvedValue({
      id: "page-id",
      folderId: "target-folder",
      slug: "landing",
    });
  });

  it("requires an authenticated session", async () => {
    getSession.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/admin/pages"));

    expect(response.status).toBe(401);
  });

  it("lists active pages and folders for an authenticated panel user", async () => {
    getSession.mockResolvedValue({
      user: { id: "master-id", role: "ADMIN", isMaster: true },
    });
    listPages.mockResolvedValue([{ id: "page-id", title: "Landing" }]);
    listFolders.mockResolvedValue([{ id: "base-id", name: "Base" }]);

    const response = await GET(new Request("http://localhost/api/admin/pages"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      pages: [{ id: "page-id", title: "Landing" }],
      folders: [{ id: "base-id", name: "Base" }],
    });
  });

  it("passes only the authenticated user id into page creation", async () => {
    getSession.mockResolvedValue({
      user: { id: "master-id", role: "ADMIN", isMaster: true },
    });

    const payload = {
      title: "Landing",
      slug: "landing",
      content: "<h1>Landing</h1>",
      folderId: "base-id",
      authorId: "attacker-id",
      role: "MASTER",
    };
    const response = await POST(
      new Request("http://localhost/api/admin/pages", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
        body: JSON.stringify(payload),
      }),
    );

    expect(response.status).toBe(201);
    expect(createPage).toHaveBeenCalledWith("master-id", {
      title: "Landing",
      slug: "landing",
      content: "<h1>Landing</h1>",
      folderId: "base-id",
    });
  });

  it("moves one page by changing only its organizational folder", async () => {
    getSession.mockResolvedValue({
      user: { id: "master-id", role: "ADMIN", isMaster: true },
    });

    const response = await PUT(
      new Request("http://localhost/api/admin/pages/page-id", {
        method: "PUT",
        body: JSON.stringify({ folderId: "target-folder", role: "MASTER" }),
        headers: {
          origin: new URL(
            process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
          ).origin,
        },
      }),
      routeContext("page-id"),
    );

    expect(response.status).toBe(200);
    expect(updatePage).toHaveBeenCalledWith("master-id", {
      folderId: "target-folder",
      id: "page-id",
    });
  });

  it("rejects quick edit with an invalid role or an untrusted origin", async () => {
    getSession.mockResolvedValue({
      user: { id: "owner-id", role: "OWNER", isMaster: false },
    });
    const invalidRoleResponse = await PUT(
      new Request("http://localhost/api/admin/pages/page-id", {
        method: "PUT",
        body: JSON.stringify({ title: "Landing" }),
        headers: { origin: "http://localhost:3000" },
      }),
      routeContext("page-id"),
    );

    expect(invalidRoleResponse.status).toBe(403);

    getSession.mockResolvedValue({
      user: { id: "admin-id", role: "ADMIN", isMaster: false },
    });
    const crossOriginResponse = await PUT(
      new Request("http://localhost/api/admin/pages/page-id", {
        method: "PUT",
        body: JSON.stringify({ title: "Landing" }),
        headers: { origin: "https://attacker.example" },
      }),
      routeContext("page-id"),
    );

    expect(crossOriginResponse.status).toBe(403);
    expect(updatePage).not.toHaveBeenCalled();
  });
});
