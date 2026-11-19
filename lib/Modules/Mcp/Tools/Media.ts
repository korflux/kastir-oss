import { randomUUID } from "node:crypto";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { mediaFolderService } from "@/lib/Modules/Media/FolderService";
import { mediaService } from "@/lib/Modules/Media/Service";
import {
  createMediaFolderSchema,
  MEDIA_ALT_MAX_LENGTH,
  MEDIA_DESCRIPTION_MAX_LENGTH,
  updateMediaFolderSchema,
  updateMediaMetadataSchema,
} from "@/lib/Modules/Media/Schema";
import type {
  MediaFileRecord,
  MediaFolderRecord,
} from "@/lib/Modules/Media/Types";
import {
  paginationInputSchema,
  normalizeMcpPagination,
  toMcpPageResult,
  type McpPageResult,
} from "@/lib/Modules/Mcp/Schema";
import { createMcpMediaDownloadUrl } from "@/lib/Modules/Mcp/MediaDownload";
import type { McpToolContext } from "@/lib/Modules/Mcp/Types";
import { mcpAuditContext } from "@/lib/Modules/Mcp/Audit";
import { McpValidationError } from "@/lib/Modules/Mcp/Errors";
import { requireMcpScope } from "@/lib/Modules/Mcp/Policy";
import {
  canMcp,
  mcpConfirmationInputSchema,
  requireReadScope,
  requireMcpConfirmation,
  runMcpReadTool,
  runMcpScopedTool,
  toMcpSuccess,
} from "@/lib/Modules/Mcp/Tools/Shared";

const MCP_MEDIA_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
const MCP_MEDIA_BASE64_MAX_CHARS =
  4 * Math.ceil(MCP_MEDIA_UPLOAD_MAX_BYTES / 3);

const mcpMediaFileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      !value.includes("..") &&
      !value.includes("/") &&
      !value.includes("\\") &&
      !value.includes("\0"),
  );

const mcpMediaUploadInputSchema = z
  .object({
    folderId: z.string().trim().min(1).max(200),
    fileName: mcpMediaFileNameSchema,
    contentBase64: z.string().min(4).max(MCP_MEDIA_BASE64_MAX_CHARS),
    alt: z.string().trim().max(MEDIA_ALT_MAX_LENGTH).optional(),
    description: z.string().trim().max(MEDIA_DESCRIPTION_MAX_LENGTH).optional(),
  })
  .strict();

const mcpMediaReplaceInputSchema = z
  .object({
    mediaId: z.string().trim().min(1).max(200),
    fileName: mcpMediaFileNameSchema,
    contentBase64: z.string().min(4).max(MCP_MEDIA_BASE64_MAX_CHARS),
    confirmation: mcpConfirmationInputSchema,
  })
  .strict();

const mediaListInputSchema = z
  .object({
    ...paginationInputSchema,
    folderId: z.string().trim().min(1).optional(),
    search: z.string().trim().max(200).optional(),
    category: z
      .enum(["IMAGE_RASTER", "IMAGE_SVG", "DOCUMENT_PDF", "VIDEO_MP4"])
      .optional(),
    processingStatus: z.enum(["PROCESSING", "READY", "FAILED"]).optional(),
  })
  .strict();

const mediaIdInputSchema = z
  .object({
    mediaId: z.string().trim().min(1),
  })
  .strict();

const mediaFolderListInputSchema = z
  .object({
    ...paginationInputSchema,
    parentId: z.string().trim().min(1).optional(),
  })
  .strict();

type MediaListInput = z.infer<typeof mediaListInputSchema>;
type MediaIdInput = z.infer<typeof mediaIdInputSchema>;
type MediaFolderListInput = z.infer<typeof mediaFolderListInputSchema>;
type McpMediaUploadInput = z.infer<typeof mcpMediaUploadInputSchema>;
type McpMediaReplaceInput = z.infer<typeof mcpMediaReplaceInputSchema>;

/** Valida o shape externo com erro MCP estável antes de qualquer alocação. */
function parseMcpMediaInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new McpValidationError();
  return parsed.data;
}

/** Decodifica somente base64 padrão e confirma o teto após a alocação exata. */
function decodeMcpMediaBase64(contentBase64: string): Buffer {
  const buffer = Buffer.from(contentBase64, "base64");
  if (
    buffer.byteLength > MCP_MEDIA_UPLOAD_MAX_BYTES ||
    buffer.toString("base64") !== contentBase64
  ) {
    throw new McpValidationError();
  }
  return buffer;
}

function mediaItem(media: MediaFileRecord): Record<string, unknown> {
  return {
    id: media.id,
    name: media.name,
    fileName: media.fileName,
    url: media.url,
    mimeType: media.mimeType,
    category: media.category,
    sizeBytes: media.sizeBytes,
    alt: media.alt,
    description: media.description,
    folderId: media.folderId,
    processingStatus: media.processingStatus,
  };
}

// Detail keeps the timestamps the list projection drops (same split as
// scriptListItem/scriptDetailMeta): they are noise per row, context after open.
function mediaDetail(media: MediaFileRecord): Record<string, unknown> {
  return {
    ...mediaItem(media),
    createdAt: media.createdAt,
    updatedAt: media.updatedAt,
  };
}

function mediaFolder(folder: MediaFolderRecord): Record<string, unknown> {
  return {
    id: folder.id,
    name: folder.name,
    color: folder.color,
    parentId: folder.parentId,
    isBase: folder.isBase,
  };
}

function mediaMutationData(media: MediaFileRecord): Record<string, unknown> {
  return {
    id: media.id,
    name: media.name,
    processingStatus: media.processingStatus,
    updatedAt: media.updatedAt,
  };
}

/** Projeção de mutations de bytes; exclui URL, path e processingToken. */
function mediaBytesMutationData(
  media: MediaFileRecord,
): Record<string, unknown> {
  return {
    id: media.id,
    name: media.name,
    fileName: media.fileName,
    processingStatus: media.processingStatus,
    sizeBytes: media.sizeBytes,
    updatedAt: media.updatedAt,
  };
}

function mediaFolderMutationData(
  folder: MediaFolderRecord,
): Record<string, unknown> {
  return {
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId,
    updatedAt: folder.updatedAt,
  };
}

export async function listMcpMedia(
  context: McpToolContext,
  input: MediaListInput,
): Promise<McpPageResult<Record<string, unknown>>> {
  requireReadScope(context);
  const result = await mediaService.listMediaPaginated(input);
  return toMcpPageResult(result.items.map(mediaItem), result.total, {
    page: result.page,
    pageSize: result.pageSize,
  });
}

export async function getMcpMedia(
  context: McpToolContext,
  input: MediaIdInput,
): Promise<Record<string, unknown>> {
  requireReadScope(context);
  return mediaDetail(await mediaService.getMedia(input.mediaId));
}

export async function downloadMcpMedia(
  context: McpToolContext,
  input: MediaIdInput,
): Promise<{ mediaId: string; url: string; expiresAt: number }> {
  requireReadScope(context);
  const media = await mediaService.getMedia(input.mediaId);
  if (!(await mediaService.hasPublicBytes(media))) {
    throw new Error("Media bytes are not available");
  }
  const download = createMcpMediaDownloadUrl({
    baseUrl: context.resource,
    mediaId: media.id,
  });
  return { mediaId: media.id, ...download };
}

export async function listMcpMediaFolders(
  context: McpToolContext,
  input: MediaFolderListInput,
): Promise<McpPageResult<Record<string, unknown>>> {
  requireReadScope(context);
  const { page, pageSize } = normalizeMcpPagination(input);
  const folders = await mediaFolderService.listFoldersPage({
    parentId: input.parentId,
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  return toMcpPageResult(folders.items.map(mediaFolder), folders.total, {
    page,
    pageSize,
  });
}

export async function updateMcpMedia(context: McpToolContext, input: unknown) {
  requireMcpScope(context, "cms:media:write");
  const media = await mediaService.updateMetadata(
    context.userId,
    input,
    mcpAuditContext(context, "kastir_media_update"),
  );
  return toMcpSuccess(
    `Media ${media.id} metadata updated.`,
    mediaMutationData(media),
  );
}

/** Upload MCP bounded: valida a borda e delega detector/storage ao serviço. */
export async function uploadMcpMedia(
  context: McpToolContext,
  input: McpMediaUploadInput,
) {
  requireMcpScope(context, "cms:media:write");
  const parsed = parseMcpMediaInput(mcpMediaUploadInputSchema, input);
  const media = await mediaService.upload(
    context.userId,
    {
      folderId: parsed.folderId,
      fileName: parsed.fileName,
      buffer: decodeMcpMediaBase64(parsed.contentBase64),
      alt: parsed.alt,
      description: parsed.description,
    },
    mcpAuditContext(context, "kastir_media_upload"),
  );
  return toMcpSuccess(
    `Media ${media.id} uploaded.`,
    mediaBytesMutationData(media),
  );
}

/** Replace MCP: exige confirmação server-side antes de decodificar os bytes. */
export async function replaceMcpMedia(
  context: McpToolContext,
  input: McpMediaReplaceInput,
) {
  requireMcpScope(context, "cms:media:write");
  const parsed = parseMcpMediaInput(mcpMediaReplaceInputSchema, input);
  requireMcpConfirmation(parsed.confirmation, "REPLACE_MEDIA");
  const media = await mediaService.replace(
    context.userId,
    parsed.mediaId,
    {
      fileName: parsed.fileName,
      buffer: decodeMcpMediaBase64(parsed.contentBase64),
    },
    mcpAuditContext(context, "kastir_media_replace"),
  );
  return toMcpSuccess(
    `Media ${media.id} replaced.`,
    mediaBytesMutationData(media),
  );
}

export async function convertMcpMedia(
  context: McpToolContext,
  input: MediaIdInput,
) {
  requireMcpScope(context, "cms:media:write");
  const operationId = randomUUID();
  const result = await mediaService.convertToWebp(
    context.userId,
    input.mediaId,
    mcpAuditContext(context, "kastir_media_convert_to_webp"),
    operationId,
  );
  return toMcpSuccess(`WebP conversion queued for media ${result.id}.`, {
    operationId,
    id: result.id,
    status: result.processingStatus,
  });
}

export async function createMcpMediaFolder(
  context: McpToolContext,
  input: unknown,
) {
  requireMcpScope(context, "cms:media:write");
  const folder = await mediaFolderService.createFolder(
    context.userId,
    input,
    mcpAuditContext(context, "kastir_media_folders_create"),
  );
  return toMcpSuccess(
    `Media folder ${folder.id} created.`,
    mediaFolderMutationData(folder),
  );
}

export async function updateMcpMediaFolder(
  context: McpToolContext,
  input: unknown,
) {
  requireMcpScope(context, "cms:media:write");
  const folder = await mediaFolderService.updateFolder(
    context.userId,
    input,
    mcpAuditContext(context, "kastir_media_folders_update"),
  );
  return toMcpSuccess(
    `Media folder ${folder.id} updated.`,
    mediaFolderMutationData(folder),
  );
}

export function registerMediaTools(
  server: McpServer,
  context: McpToolContext,
): void {
  if (canMcp(context, "media", "read")) {
    server.registerTool(
      "kastir_media_list",
      {
        title: "List Media",
        description:
          "List media metadata with filters and pagination. No processing tokens or delete.",
        inputSchema: mediaListInputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      (input) => runMcpReadTool(context, () => listMcpMedia(context, input)),
    );
    server.registerTool(
      "kastir_media_get",
      {
        title: "Get Media",
        description:
          "Get one media metadata record (no processing tokens or filesystem paths).",
        inputSchema: mediaIdInputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      (input) => runMcpReadTool(context, () => getMcpMedia(context, input)),
    );
    server.registerTool(
      "kastir_media_download",
      {
        title: "Download Media",
        description:
          "Create a short-lived signed download URL for ready public media bytes.",
        inputSchema: mediaIdInputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      (input) =>
        runMcpReadTool(context, () => downloadMcpMedia(context, input)),
    );
    server.registerTool(
      "kastir_media_folders_list",
      {
        title: "List Media Folders",
        description: "List media folders (optional parent + pagination).",
        inputSchema: mediaFolderListInputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      (input) =>
        runMcpReadTool(context, () => listMcpMediaFolders(context, input)),
    );
  }

  if (canMcp(context, "media", "write")) {
    server.registerTool(
      "kastir_media_upload",
      {
        title: "Upload Media",
        description:
          "Upload up to 20 MiB as standard base64; server verifies type and sanitizes SVG.",
        inputSchema: mcpMediaUploadInputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      (input) =>
        runMcpScopedTool(context, "cms:media:write", () =>
          uploadMcpMedia(context, input),
        ),
    );
    server.registerTool(
      "kastir_media_replace",
      {
        title: "Replace Media",
        description:
          "Replace media bytes after REPLACE_MEDIA; keeps identity and category.",
        inputSchema: mcpMediaReplaceInputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      (input) =>
        runMcpScopedTool(context, "cms:media:write", () =>
          replaceMcpMedia(context, input),
        ),
    );
    server.registerTool(
      "kastir_media_update",
      {
        title: "Update Media Metadata",
        description: "Update media metadata only (no upload/bytes).",
        inputSchema: updateMediaMetadataSchema.strict(),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      (input) =>
        runMcpScopedTool(context, "cms:media:write", () =>
          updateMcpMedia(context, input),
        ),
    );
    server.registerTool(
      "kastir_media_convert_to_webp",
      {
        title: "Convert Media to WebP",
        description: "Queue WebP conversion; poll with kastir_operation_get.",
        inputSchema: mediaIdInputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      (input) =>
        runMcpScopedTool(context, "cms:media:write", () =>
          convertMcpMedia(context, input),
        ),
    );
    server.registerTool(
      "kastir_media_folders_create",
      {
        title: "Create Media Folder",
        description: "Create a media folder.",
        inputSchema: createMediaFolderSchema.strict(),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      (input) =>
        runMcpScopedTool(context, "cms:media:write", () =>
          createMcpMediaFolder(context, input),
        ),
    );
    server.registerTool(
      "kastir_media_folders_update",
      {
        title: "Update Media Folder",
        description: "Update a media folder.",
        inputSchema: updateMediaFolderSchema.strict(),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      (input) =>
        runMcpScopedTool(context, "cms:media:write", () =>
          updateMcpMediaFolder(context, input),
        ),
    );
  }
}
