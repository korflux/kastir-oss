import { describe, expect, it, vi } from "vitest";

import { PagesDomainError } from "@/lib/Modules/Pages/Types";
import { RevisionsDomainError } from "@/lib/Modules/Revisions/Types";

const updatePage = vi.hoisted(() => vi.fn());
const getPage = vi.hoisted(() => vi.fn());
const restorePageRevision = vi.hoisted(() => vi.fn());
const publishPage = vi.hoisted(() => vi.fn());
const unpublishPage = vi.hoisted(() => vi.fn());
const listPageRevisions = vi.hoisted(() => vi.fn());
const getPageRevisionForPage = vi.hoisted(() => vi.fn());
const diffPageRevision = vi.hoisted(() => vi.fn());

vi.mock("@/lib/Modules/Pages/Service", () => ({
  pageService: {
    updatePage,
    getPage,
    restorePageRevision,
    publishPage,
    unpublishPage,
  },
}));

vi.mock("@/lib/Modules/Pages/FolderService", () => ({ folderService: {} }));

vi.mock("@/lib/Modules/Settings/Service", () => ({
  settingsService: { getSettings: vi.fn() },
}));

vi.mock("@/lib/Modules/Revisions/Api", () => ({
  revisionService: () => ({
    listPageRevisions,
    getPageRevisionForPage,
    diffPageRevision,
  }),
}));

const writeContext = {
  actor: { id: "user-1", name: "Admin", email: "admin@example.test" },
  userId: "user-1",
  role: "ADMIN" as const,
  scopes: [
    "cms:read",
    "cms:pages:write",
    "cms:pages:publish",
    "cms:pages:unpublish",
  ] as const,
  clientId: "client-1",
  resource: "https://public.example/api/mcp",
  requestId: "request-1",
};

const readContext = {
  ...writeContext,
  scopes: ["cms:read"] as const,
};

const publishedSnapshot = {
  title: "Home live",
  slug: "home",
  content: "<p>published secret html</p>",
  seoTitle: null,
  seoDescription: null,
  seoKeyword: null,
  folderId: "folder-1",
};

const page = {
  id: "page-1",
  title: "Home draft",
  slug: "home-draft",
  content: "<p>draft html</p>",
  status: "PUBLISHED" as const,
  folderId: "folder-1",
  authorId: "user-1",
  seoTitle: null,
  seoDescription: null,
  seoKeyword: null,
  publishedAt: new Date("2026-08-01T00:00:00.000Z"),
  deletedAt: null,
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-13T12:00:00.000Z"),
  publishedRevisionId: "rev-live",
  published: publishedSnapshot,
  hasUnpublishedChanges: true,
  activated: true,
};

const revision = {
  id: "rev-old",
  pageId: "page-1",
  authorId: "user-1",
  authorName: "Admin",
  pinned: false,
  createdAt: new Date("2026-08-10T00:00:00.000Z"),
  title: "Home previous",
  slug: "home",
  content: "<p>previous html</p>",
  seoTitle: null,
  seoDescription: null,
  seoKeyword: null,
  folderId: "folder-1",
  fingerprint: "fp-old",
  published: false,
};

describe("MCP Pages revisions and draft-only update", () => {
  it("saves a draft without publishing and reports dirty/published state", async () => {
    updatePage.mockResolvedValueOnce(page);
    const { updateMcpPage } = await import("@/lib/Modules/Mcp/Tools/Pages");

    const result = await updateMcpPage(writeContext, {
      id: "page-1",
      title: "Home draft",
    });

    expect(updatePage).toHaveBeenCalledWith(
      "user-1",
      { id: "page-1", title: "Home draft" },
      expect.objectContaining({ tool: "kastir_pages_update" }),
    );
    expect(publishPage).not.toHaveBeenCalled();
    expect(result.summary).toMatch(/draft/i);
    expect(result.summary).toContain("kastir_pages_publish");
    expect(result.data).toMatchObject({
      id: "page-1",
      status: "PUBLISHED",
      publishedRevisionId: "rev-live",
      hasUnpublishedChanges: true,
      activated: true,
      published: { title: "Home live", slug: "home" },
    });
    expect(JSON.stringify(result)).not.toContain("published secret html");
    expect(JSON.stringify(result)).not.toContain("draft html");
  });

  it("lists and gets revisions for a readable page and hides full content by default", async () => {
    getPage.mockResolvedValue(page);
    listPageRevisions.mockResolvedValueOnce({
      items: [
        {
          id: "rev-old",
          pageId: "page-1",
          authorId: "user-1",
          authorName: "Admin",
          pinned: false,
          createdAt: revision.createdAt,
          title: "Home previous",
          slug: "home",
          published: false,
          fingerprint: "fp-old",
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    getPageRevisionForPage.mockResolvedValueOnce(revision);
    const { listMcpPageRevisions, getMcpPageRevision } =
      await import("@/lib/Modules/Mcp/Tools/Pages");

    const listed = await listMcpPageRevisions(readContext, {
      pageId: "page-1",
    });
    const detail = await getMcpPageRevision(readContext, {
      pageId: "page-1",
      revisionId: "rev-old",
    });

    expect(listPageRevisions).toHaveBeenCalledWith({
      pageId: "page-1",
      publishedRevisionId: "rev-live",
      page: 1,
      pageSize: 20,
    });
    expect(listed.items[0]).toMatchObject({
      id: "rev-old",
      published: false,
      pinned: false,
      fingerprint: "fp-old",
    });
    expect(listed.items[0]).not.toHaveProperty("content");
    expect(detail).toMatchObject({
      id: "rev-old",
      pageId: "page-1",
      contentTotal: revision.content.length,
    });
    expect(detail).not.toHaveProperty("content");
  });

  it("diffs a revision against the draft and restores without publishing", async () => {
    getPage.mockResolvedValue(page);
    diffPageRevision.mockResolvedValueOnce({
      lines: [{ type: "-", text: "published secret html" }],
    });
    restorePageRevision.mockResolvedValueOnce({
      ...page,
      title: "Home previous",
      hasUnpublishedChanges: true,
    });
    const { diffMcpPageRevisions, restoreMcpPageRevision } =
      await import("@/lib/Modules/Mcp/Tools/Pages");

    const diff = await diffMcpPageRevisions(readContext, {
      pageId: "page-1",
      from: "rev-old",
      to: "draft",
    });
    const restored = await restoreMcpPageRevision(writeContext, {
      pageId: "page-1",
      revisionId: "rev-old",
      expectedUpdatedAt: "2026-08-13T12:00:00.000Z",
    });

    expect(diffPageRevision).toHaveBeenCalledWith({
      pageId: "page-1",
      fromRevisionId: "rev-old",
      to: {
        kind: "draft",
        snapshot: expect.objectContaining({
          title: "Home draft",
          content: "<p>draft html</p>",
        }),
      },
    });
    expect(diff.lines).toEqual([{ type: "-", text: "published secret html" }]);
    expect(restorePageRevision).toHaveBeenCalledWith(
      "user-1",
      "page-1",
      "rev-old",
      new Date("2026-08-13T12:00:00.000Z"),
      expect.objectContaining({
        source: "MCP",
        tool: "kastir_pages_revisions_restore",
        resource: writeContext.resource,
        requestId: "request-1",
      }),
    );
    expect(publishPage).not.toHaveBeenCalled();
    expect(restored.summary).toMatch(/draft/i);
    expect(restored.summary).toContain("kastir_pages_publish");
    expect(restored.data).toMatchObject({
      id: "page-1",
      hasUnpublishedChanges: true,
    });
    expect(JSON.stringify(restored)).not.toContain("sk-");
    expect(JSON.stringify(restored)).not.toContain("token");
  });

  it("runs update → list → get → diff → restore → publish as an explicit chain", async () => {
    updatePage.mockResolvedValueOnce(page);
    getPage.mockResolvedValue(page);
    listPageRevisions.mockResolvedValueOnce({
      items: [{ ...revision, content: undefined }],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    getPageRevisionForPage.mockResolvedValueOnce(revision);
    diffPageRevision.mockResolvedValueOnce({ lines: [] });
    restorePageRevision.mockResolvedValueOnce(page);
    publishPage.mockResolvedValueOnce({
      ...page,
      hasUnpublishedChanges: false,
    });
    const {
      updateMcpPage,
      listMcpPageRevisions,
      getMcpPageRevision,
      diffMcpPageRevisions,
      restoreMcpPageRevision,
      publishMcpPage,
    } = await import("@/lib/Modules/Mcp/Tools/Pages");

    await updateMcpPage(writeContext, { id: "page-1", title: "Home draft" });
    await listMcpPageRevisions(writeContext, { pageId: "page-1" });
    await getMcpPageRevision(writeContext, {
      pageId: "page-1",
      revisionId: "rev-old",
    });
    await diffMcpPageRevisions(writeContext, {
      pageId: "page-1",
      from: "rev-old",
      to: "rev-live",
    });
    await restoreMcpPageRevision(writeContext, {
      pageId: "page-1",
      revisionId: "rev-old",
      expectedUpdatedAt: "2026-08-13T12:00:00.000Z",
    });
    const published = await publishMcpPage(writeContext, { pageId: "page-1" });

    expect(publishPage).toHaveBeenCalledTimes(1);
    expect(published.summary).toBe("Page page-1 published.");
    expect(restorePageRevision.mock.invocationCallOrder[0]).toBeLessThan(
      publishPage.mock.invocationCallOrder[0],
    );
  });

  it("rejects read tools without cms:read and restore without write", async () => {
    getPage.mockClear();
    restorePageRevision.mockClear();
    const {
      listMcpPageRevisions,
      getMcpPageRevision,
      diffMcpPageRevisions,
      restoreMcpPageRevision,
    } = await import("@/lib/Modules/Mcp/Tools/Pages");

    await expect(
      listMcpPageRevisions(
        { ...readContext, scopes: [] },
        { pageId: "page-1" },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expect(
      getMcpPageRevision(
        { ...readContext, scopes: [] },
        { pageId: "page-1", revisionId: "rev-old" },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      diffMcpPageRevisions(
        { ...readContext, scopes: [] },
        { pageId: "page-1", from: "rev-old", to: "draft" },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      restoreMcpPageRevision(readContext, {
        pageId: "page-1",
        revisionId: "rev-old",
        expectedUpdatedAt: "2026-08-13T12:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getPage).not.toHaveBeenCalled();
    expect(restorePageRevision).not.toHaveBeenCalled();
  });

  it("rejects crossed revision ids, extra fields and missing expectedUpdatedAt", async () => {
    restorePageRevision.mockClear();
    getPage.mockResolvedValue(page);
    getPageRevisionForPage.mockRejectedValueOnce(
      new RevisionsDomainError("NOT_FOUND", "Revision was not found"),
    );
    const { getMcpPageRevision, restoreMcpPageRevision, listMcpPageRevisions } =
      await import("@/lib/Modules/Mcp/Tools/Pages");

    await expect(
      getMcpPageRevision(readContext, {
        pageId: "page-1",
        revisionId: "rev-other-page",
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Revision was not found",
    });
    await expect(
      restoreMcpPageRevision(writeContext, {
        pageId: "page-1",
        revisionId: "rev-old",
        expectedUpdatedAt: "2026-08-13T12:00:00.000Z",
        publishedRevisionId: "forged",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      restoreMcpPageRevision(writeContext, {
        pageId: "page-1",
        revisionId: "rev-old",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      listMcpPageRevisions(readContext, {
        pageId: "page-1",
        pageSize: 51,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(restorePageRevision).not.toHaveBeenCalled();
  });

  it("returns a generic MCP error without page HTML when restore fails internally", async () => {
    restorePageRevision.mockRejectedValueOnce(
      new Error("<script>alert(1)</script> stack"),
    );
    const { restoreMcpPageRevision } =
      await import("@/lib/Modules/Mcp/Tools/Pages");
    const { runMcpScopedTool } = await import("@/lib/Modules/Mcp/Tools/Shared");

    const result = await runMcpScopedTool(writeContext, "cms:pages:write", () =>
      restoreMcpPageRevision(writeContext, {
        pageId: "page-1",
        revisionId: "rev-old",
        expectedUpdatedAt: "2026-08-13T12:00:00.000Z",
      }),
    );

    // McpToolResult é uma união: só o ramo de erro declara isError.
    expect(result).toMatchObject({ isError: true });
    const payload = JSON.parse(
      (result.content as { text: string }[])[0]!.text,
    ) as { error: { code: string; message: string } };
    expect(payload.error.code).toBe("INTERNAL_ERROR");
    expect(payload.error.message).toBe("MCP tool failed");
    expect(JSON.stringify(result)).not.toContain("<script>");
    expect(JSON.stringify(result)).not.toContain("stack");
  });

  it("deactivates via unpublish without asking the service to clear the pointer", async () => {
    unpublishPage.mockResolvedValueOnce({
      ...page,
      status: "DRAFT",
      activated: false,
      hasUnpublishedChanges: true,
    });
    const { unpublishMcpPage } = await import("@/lib/Modules/Mcp/Tools/Pages");

    const result = await unpublishMcpPage(writeContext, { pageId: "page-1" });

    expect(unpublishPage).toHaveBeenCalledWith(
      "user-1",
      "page-1",
      expect.objectContaining({ tool: "kastir_pages_unpublish" }),
    );
    expect(result.summary).toMatch(/deactivat/i);
    expect(result.data).toMatchObject({
      publishedRevisionId: "rev-live",
      activated: false,
    });
  });

  it("surfaces a generic domain conflict without leaking draft HTML", async () => {
    restorePageRevision.mockRejectedValueOnce(
      new PagesDomainError("CONFLICT", "Page was updated by another request"),
    );
    const { restoreMcpPageRevision } =
      await import("@/lib/Modules/Mcp/Tools/Pages");

    await expect(
      restoreMcpPageRevision(writeContext, {
        pageId: "page-1",
        revisionId: "rev-old",
        expectedUpdatedAt: "2026-08-13T12:00:00.000Z",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Page was updated by another request",
    });
  });
});
