import { describe, expect, it, vi } from "vitest";

import { RevisionsDomainError } from "@/lib/Modules/Revisions/Types";

const updateSnippet = vi.hoisted(() => vi.fn());
const getSnippet = vi.hoisted(() => vi.fn());
const restoreSnippetRevision = vi.hoisted(() => vi.fn());
const publishSnippet = vi.hoisted(() => vi.fn());
const unpublishSnippet = vi.hoisted(() => vi.fn());
const listSnippetRevisions = vi.hoisted(() => vi.fn());
const getSnippetRevisionForSnippet = vi.hoisted(() => vi.fn());
const diffSnippetRevision = vi.hoisted(() => vi.fn());

vi.mock("@/lib/Modules/CustomCode/Service", () => ({
  customCodeService: {
    updateSnippet,
    getSnippet,
    restoreSnippetRevision,
    publishSnippet,
    unpublishSnippet,
  },
}));

vi.mock("@/lib/Modules/Revisions/Api", () => ({
  revisionService: () => ({
    listSnippetRevisions,
    getSnippetRevisionForSnippet,
    diffSnippetRevision,
  }),
}));

const writeContext = {
  actor: { id: "user-1", name: "Admin", email: "admin@example.test" },
  userId: "user-1",
  role: "ADMIN" as const,
  scopes: [
    "cms:read",
    "cms:scripts:write",
    "cms:scripts:publish",
    "cms:scripts:unpublish",
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
  name: "Analytics live",
  location: "BODY_END" as const,
  content: "<script>window.live = true;</script>",
  priority: 10,
  scopeType: "ALL_PAGES" as const,
  pageIds: [],
  triggerType: null,
  triggerConfig: null,
  maxDisplays: null,
  displayResetDays: null,
};

const script = {
  id: "script-1",
  name: "Analytics draft",
  location: "BODY_END" as const,
  content: "<script>window.draft = true;</script>",
  status: "PUBLISHED" as const,
  priority: 10,
  scopeType: "ALL_PAGES" as const,
  scopedPages: [],
  triggerType: null,
  triggerConfig: null,
  maxDisplays: null,
  displayResetDays: null,
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-13T12:00:00.000Z"),
  deletedAt: null,
  publishedRevisionId: "srev-live",
  published: publishedSnapshot,
  hasUnpublishedChanges: true,
  activated: true,
};

const revision = {
  id: "srev-old",
  snippetId: "script-1",
  authorId: "user-1",
  authorName: "Admin",
  pinned: false,
  createdAt: new Date("2026-08-10T00:00:00.000Z"),
  name: "Analytics previous",
  location: "BODY_END" as const,
  content: "<script>window.previous = true;</script>",
  priority: 10,
  scopeType: "ALL_PAGES" as const,
  pageIds: [],
  triggerType: null,
  triggerConfig: null,
  maxDisplays: null,
  displayResetDays: null,
  fingerprint: "fp-old",
  published: false,
};

describe("MCP Scripts revisions and draft-only update", () => {
  it("saves a script draft without publishing and reports dirty/published state", async () => {
    updateSnippet.mockResolvedValueOnce(script);
    const { updateMcpScript } = await import("@/lib/Modules/Mcp/Tools/Scripts");

    const result = await updateMcpScript(writeContext, {
      id: "script-1",
      content: script.content,
    });

    expect(updateSnippet).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ id: "script-1" }),
      expect.objectContaining({ tool: "kastir_scripts_update" }),
    );
    expect(publishSnippet).not.toHaveBeenCalled();
    expect(result.summary).toMatch(/draft/i);
    expect(result.summary).toContain("kastir_scripts_publish");
    expect(result.data).toMatchObject({
      id: "script-1",
      publishedRevisionId: "srev-live",
      hasUnpublishedChanges: true,
      activated: true,
    });
    expect(JSON.stringify(result)).not.toContain("window.live");
    expect(JSON.stringify(result)).not.toContain("window.draft");
  });

  it("lists and gets snippet revisions without executing or dumping content", async () => {
    getSnippet.mockResolvedValue(script);
    listSnippetRevisions.mockResolvedValueOnce({
      items: [
        {
          id: "srev-old",
          snippetId: "script-1",
          authorId: "user-1",
          authorName: "Admin",
          pinned: false,
          createdAt: revision.createdAt,
          name: "Analytics previous",
          published: false,
          fingerprint: "fp-old",
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    getSnippetRevisionForSnippet.mockResolvedValueOnce(revision);
    const { listMcpScriptRevisions, getMcpScriptRevision } =
      await import("@/lib/Modules/Mcp/Tools/Scripts");

    const listed = await listMcpScriptRevisions(readContext, {
      scriptId: "script-1",
    });
    const detail = await getMcpScriptRevision(readContext, {
      scriptId: "script-1",
      revisionId: "srev-old",
    });

    expect(listed.items[0]).toMatchObject({
      id: "srev-old",
      published: false,
      fingerprint: "fp-old",
    });
    expect(listed.items[0]).not.toHaveProperty("content");
    expect(detail).toMatchObject({
      id: "srev-old",
      contentTotal: revision.content.length,
    });
    expect(detail).not.toHaveProperty("content");
  });

  it("diffs, restores without publishing, then publishes explicitly", async () => {
    getSnippet.mockResolvedValue(script);
    updateSnippet.mockResolvedValueOnce(script);
    listSnippetRevisions.mockResolvedValueOnce({
      items: [{ id: "srev-old", published: false }],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    getSnippetRevisionForSnippet.mockResolvedValueOnce(revision);
    diffSnippetRevision.mockResolvedValueOnce({ lines: [] });
    restoreSnippetRevision.mockResolvedValueOnce({
      ...script,
      hasUnpublishedChanges: true,
    });
    publishSnippet.mockResolvedValueOnce({
      ...script,
      hasUnpublishedChanges: false,
    });
    const {
      updateMcpScript,
      listMcpScriptRevisions,
      getMcpScriptRevision,
      diffMcpScriptRevisions,
      restoreMcpScriptRevision,
      publishMcpScript,
    } = await import("@/lib/Modules/Mcp/Tools/Scripts");

    await updateMcpScript(writeContext, { id: "script-1", name: "Analytics" });
    await listMcpScriptRevisions(writeContext, { scriptId: "script-1" });
    await getMcpScriptRevision(writeContext, {
      scriptId: "script-1",
      revisionId: "srev-old",
    });
    await diffMcpScriptRevisions(writeContext, {
      scriptId: "script-1",
      from: "srev-old",
      to: "draft",
    });
    const restored = await restoreMcpScriptRevision(writeContext, {
      scriptId: "script-1",
      revisionId: "srev-old",
      expectedUpdatedAt: "2026-08-13T12:00:00.000Z",
    });
    await publishMcpScript(writeContext, {
      scriptId: "script-1",
      confirmation: "PUBLISH_SCRIPT",
    });

    expect(restoreSnippetRevision).toHaveBeenCalledWith(
      "user-1",
      "script-1",
      "srev-old",
      new Date("2026-08-13T12:00:00.000Z"),
      expect.objectContaining({
        tool: "kastir_scripts_revisions_restore",
        source: "MCP",
      }),
    );
    expect(restored.summary).toContain("kastir_scripts_publish");
    expect(publishSnippet).toHaveBeenCalledTimes(1);
  });

  it("rejects restore without write and crossed revision ids", async () => {
    getSnippet.mockResolvedValue(script);
    getSnippetRevisionForSnippet.mockRejectedValueOnce(
      new RevisionsDomainError("NOT_FOUND", "Revision was not found"),
    );
    const { restoreMcpScriptRevision, getMcpScriptRevision } =
      await import("@/lib/Modules/Mcp/Tools/Scripts");

    await expect(
      restoreMcpScriptRevision(readContext, {
        scriptId: "script-1",
        revisionId: "srev-old",
        expectedUpdatedAt: "2026-08-13T12:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      getMcpScriptRevision(readContext, {
        scriptId: "script-1",
        revisionId: "srev-other",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects extra control fields and oversize list pages", async () => {
    restoreSnippetRevision.mockClear();
    const { restoreMcpScriptRevision, listMcpScriptRevisions } =
      await import("@/lib/Modules/Mcp/Tools/Scripts");

    await expect(
      restoreMcpScriptRevision(writeContext, {
        scriptId: "script-1",
        revisionId: "srev-old",
        expectedUpdatedAt: "2026-08-13T12:00:00.000Z",
        publishedRevisionId: "forged",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      listMcpScriptRevisions(readContext, {
        scriptId: "script-1",
        pageSize: 51,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(restoreSnippetRevision).not.toHaveBeenCalled();
  });

  it("deactivates via unpublish and keeps the published revision pointer", async () => {
    unpublishSnippet.mockResolvedValueOnce({
      ...script,
      status: "DRAFT",
      activated: false,
    });
    const { unpublishMcpScript } =
      await import("@/lib/Modules/Mcp/Tools/Scripts");

    const result = await unpublishMcpScript(writeContext, {
      scriptId: "script-1",
      confirmation: "UNPUBLISH_SCRIPT",
    });

    expect(result.summary).toMatch(/deactivat/i);
    expect(result.data).toMatchObject({
      publishedRevisionId: "srev-live",
      activated: false,
    });
  });

  it("returns a generic error without script source when restore fails internally", async () => {
    restoreSnippetRevision.mockRejectedValueOnce(
      new Error("<script>token=sk-secret</script>"),
    );
    const { restoreMcpScriptRevision } =
      await import("@/lib/Modules/Mcp/Tools/Scripts");
    const { runMcpScopedTool } = await import("@/lib/Modules/Mcp/Tools/Shared");

    const result = await runMcpScopedTool(
      writeContext,
      "cms:scripts:write",
      () =>
        restoreMcpScriptRevision(writeContext, {
          scriptId: "script-1",
          revisionId: "srev-old",
          expectedUpdatedAt: "2026-08-13T12:00:00.000Z",
        }),
    );

    // McpToolResult é uma união: só o ramo de erro declara isError.
    expect(result).toMatchObject({ isError: true });
    expect(JSON.stringify(result)).toContain("MCP tool failed");
    expect(JSON.stringify(result)).not.toContain("sk-secret");
    expect(JSON.stringify(result)).not.toContain("<script>");
  });
});
