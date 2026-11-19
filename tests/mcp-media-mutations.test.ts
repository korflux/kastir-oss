import { describe, expect, it, vi } from "vitest";

const upload = vi.hoisted(() => vi.fn());
const replace = vi.hoisted(() => vi.fn());

vi.mock("@/lib/Modules/Media/Service", () => ({
  mediaService: { upload, replace },
}));
vi.mock("@/lib/Modules/Media/FolderService", () => ({
  mediaFolderService: {},
}));
vi.mock("@/lib/env", () => ({
  env: { NEXTAUTH_SECRET: "test-secret-with-at-least-32-characters" },
}));

const context = {
  actor: { id: "user-1", name: "Admin", email: "admin@example.test" },
  userId: "user-1",
  role: "ADMIN" as const,
  scopes: ["cms:read", "cms:media:write"] as const,
  clientId: "client-1",
  resource: "https://public.example/api/mcp",
  requestId: "request-1",
};

const updatedAt = new Date("2026-08-09T12:00:00.000Z");
const media = {
  id: "media-1",
  name: "asset",
  fileName: "asset.pdf",
  url: "/uploads/media-1/asset.pdf",
  mimeType: "application/pdf",
  category: "DOCUMENT_PDF",
  sizeBytes: 5,
  alt: null,
  description: null,
  folderId: "folder-1",
  processingStatus: "READY",
  processingToken: "must-not-leak",
  createdAt: updatedAt,
  updatedAt,
};

describe("MCP media mutation tools", () => {
  it("uploads decoded bytes with audit and returns only allowlisted fields", async () => {
    upload.mockResolvedValueOnce(media);
    const { uploadMcpMedia } = await import("@/lib/Modules/Mcp/Tools/Media");

    const result = await uploadMcpMedia(context, {
      folderId: "folder-1",
      fileName: "asset.pdf",
      contentBase64: Buffer.from("hello").toString("base64"),
      alt: "Asset",
    });

    expect(upload).toHaveBeenCalledWith(
      "user-1",
      {
        folderId: "folder-1",
        fileName: "asset.pdf",
        buffer: Buffer.from("hello"),
        alt: "Asset",
        description: undefined,
      },
      {
        source: "MCP",
        tool: "kastir_media_upload",
        resource: context.resource,
        requestId: context.requestId,
      },
    );
    expect(result).toEqual({
      ok: true,
      summary: "Media media-1 uploaded.",
      data: {
        id: "media-1",
        name: "asset",
        fileName: "asset.pdf",
        processingStatus: "READY",
        sizeBytes: 5,
        updatedAt,
      },
    });
  });

  it("requires the replace confirmation before calling the service", async () => {
    replace.mockClear();
    const { replaceMcpMedia } = await import("@/lib/Modules/Mcp/Tools/Media");

    await expect(
      replaceMcpMedia(context, {
        mediaId: "media-1",
        fileName: "asset.pdf",
        contentBase64: Buffer.from("hello").toString("base64"),
      }),
    ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    expect(replace).not.toHaveBeenCalled();
  });

  it("replaces decoded bytes with audit and a minimal response", async () => {
    replace.mockResolvedValueOnce(media);
    const { replaceMcpMedia } = await import("@/lib/Modules/Mcp/Tools/Media");

    const result = await replaceMcpMedia(context, {
      mediaId: "media-1",
      fileName: "asset.pdf",
      contentBase64: Buffer.from("hello").toString("base64"),
      confirmation: "REPLACE_MEDIA",
    });

    expect(replace).toHaveBeenCalledWith(
      "user-1",
      "media-1",
      { fileName: "asset.pdf", buffer: Buffer.from("hello") },
      expect.objectContaining({ tool: "kastir_media_replace" }),
    );
    expect(result.data).toEqual({
      id: "media-1",
      name: "asset",
      fileName: "asset.pdf",
      processingStatus: "READY",
      sizeBytes: 5,
      updatedAt,
    });
  });

  it.each([
    { fileName: "../asset.pdf", contentBase64: "aGVsbG8=" },
    { fileName: "asset.pdf", contentBase64: "data:text/plain;base64,aGVsbG8=" },
    { fileName: "asset.pdf", contentBase64: "%%%%" },
  ])("rejects unsafe input before the upload service", async (input) => {
    upload.mockClear();
    const { uploadMcpMedia } = await import("@/lib/Modules/Mcp/Tools/Media");

    await expect(
      uploadMcpMedia(context, { folderId: "folder-1", ...input }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(upload).not.toHaveBeenCalled();
  });

  it("rejects encoded overflow before decoding and decoded overflow after it", async () => {
    upload.mockClear();
    const { uploadMcpMedia } = await import("@/lib/Modules/Mcp/Tools/Media");
    const maxEncodedLength = 4 * Math.ceil((20 * 1024 * 1024) / 3);
    const from = vi.spyOn(Buffer, "from");

    await expect(
      uploadMcpMedia(context, {
        folderId: "folder-1",
        fileName: "asset.pdf",
        contentBase64: "A".repeat(maxEncodedLength + 4),
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(from).not.toHaveBeenCalled();

    await expect(
      uploadMcpMedia(context, {
        folderId: "folder-1",
        fileName: "asset.pdf",
        contentBase64: "A".repeat(maxEncodedLength),
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(from).toHaveBeenCalledTimes(1);
    expect(upload).not.toHaveBeenCalled();
    from.mockRestore();
  });

  it("registers upload/replace as strict mutations and no media delete", async () => {
    const server = { registerTool: vi.fn() };
    const { registerMediaTools } =
      await import("@/lib/Modules/Mcp/Tools/Media");

    registerMediaTools(server as never, context);
    const registrations = new Map(
      server.registerTool.mock.calls.map(([name, definition]) => [
        name,
        definition,
      ]),
    );
    for (const name of ["kastir_media_upload", "kastir_media_replace"]) {
      const definition = registrations.get(name) as {
        annotations: Record<string, boolean>;
        inputSchema: { safeParse: (input: unknown) => { success: boolean } };
      };
      expect(definition.annotations.readOnlyHint).toBe(false);
      expect(
        definition.inputSchema.safeParse({ unexpected: true }).success,
      ).toBe(false);
    }
    expect(registrations.has("kastir_media_delete")).toBe(false);
    expect(registrations.has("kastir_media_bulk_delete")).toBe(false);
  });
});
