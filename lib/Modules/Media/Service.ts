import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/Logging/logEvent";
import type { LogEventContext } from "@/lib/Logging/logEvent";
import { cloudflarePurge } from "@/lib/Cdn/cloudflarePurge";
import { getPublicOrigin } from "@/lib/Modules/Settings/publicOrigin";
import {
  getPublishingQueue,
  TRACKED_JOB_RETENTION,
  type PublishingQueue,
} from "@/lib/Publishing/queue";
import {
  assertMediaSize,
  detectMediaType,
  getMediaExtension,
} from "@/lib/Processing/detectFileType";
import {
  createMediaStorage,
  type MediaStorage,
} from "@/lib/Processing/mediaStorage";
import { sanitizeSvg } from "@/lib/Processing/sanitizeSvg";
import { updateMediaMetadataSchema } from "@/lib/Modules/Media/Schema";
import {
  MediaDomainError,
  type MediaFileRecord,
  type MediaCategory,
} from "@/lib/Modules/Media/Types";
import { isPublicMediaUrlReady } from "@/lib/Modules/Media/publicUrl";
import {
  markMediaProcessingFailed,
  type MediaFailureDatabase,
} from "@/lib/Processing/convertToWebp";
import { SYSTEM_MEDIA_STUCK_RECONCILE_ACTOR_ID } from "@/lib/SideEffects/Types";

export type MediaUploadInput = {
  folderId: string;
  fileName: string;
  buffer: Buffer;
  sizeBytes?: number;
  alt?: string | null;
  description?: string | null;
};

type MediaWhere = {
  id?: string;
  folderId?: string | { in: string[] };
  category?: MediaFileRecord["category"];
  processingStatus?: MediaFileRecord["processingStatus"];
  OR?: Array<{
    name?: { contains: string; mode: "insensitive" };
    url?: { contains: string; mode: "insensitive" };
    alt?: { contains: string; mode: "insensitive" };
    description?: { contains: string; mode: "insensitive" };
  }>;
};

export type MediaDatabase = {
  mediaFolder: {
    findUnique(args: { where: { id: string } }): Promise<{ id: string } | null>;
    findMany?(args?: {
      where?: { id?: string; parentId?: string | null };
    }): Promise<Array<{ id: string; parentId: string | null }>>;
  };
  mediaFile: {
    findUnique(args: {
      where: { id: string };
    }): Promise<MediaFileRecord | null>;
    findMany(args?: {
      where?: MediaWhere;
      orderBy?: { createdAt: "asc" | "desc" };
      skip?: number;
      take?: number;
    }): Promise<MediaFileRecord[]>;
    count?(args?: { where?: MediaWhere }): Promise<number>;
    aggregate?(args: {
      _sum: { sizeBytes: true };
    }): Promise<{ _sum: { sizeBytes: number | null } }>;
    create(args: { data: MediaFileRecord }): Promise<MediaFileRecord>;
    update(args: {
      where: { id: string };
      data: Partial<MediaFileRecord>;
    }): Promise<MediaFileRecord>;
    updateMany?(args: {
      where: {
        id: string;
        processingStatus?: MediaFileRecord["processingStatus"];
        processingToken?: string | null;
      };
      data: Partial<MediaFileRecord>;
    }): Promise<{ count: number }>;
    delete(args: { where: { id: string } }): Promise<MediaFileRecord>;
  };
  siteSettings?: {
    findUnique(args: { where: { id: string } }): Promise<{
      siteUrl: string | null;
      webpConversionEnabled: boolean;
    } | null>;
  };
  logEntry: {
    create(args: {
      data: {
        userId: string;
        action: string;
        objectType: "MEDIA";
        objectLabel: string;
      };
    }): Promise<unknown>;
  };
  $transaction(
    callback: (tx: MediaDatabase) => Promise<unknown>,
  ): Promise<unknown>;
};

export type MediaQueue = Pick<PublishingQueue, "add">;

export type MediaReplaceInput = {
  fileName: string;
  buffer: Buffer;
  sizeBytes?: number;
};

function normalizeNullable(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeStem(fileName: string): string {
  const extension = getMediaExtension(fileName);
  const rawStem = fileName.slice(0, -(extension.length + 1));
  const stem = rawStem
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 180);

  return stem || "file";
}

function outputExtension(category: MediaCategory): string {
  switch (category) {
    case "IMAGE_RASTER":
      return "webp";
    case "IMAGE_SVG":
      return "svg";
    case "DOCUMENT_PDF":
      return "pdf";
    case "VIDEO_MP4":
      return "mp4";
  }
}

async function nextFileName(
  database: MediaDatabase,
  folderId: string,
  stem: string,
  extension: string,
): Promise<string> {
  const existing = await database.mediaFile.findMany({ where: { folderId } });
  const names = new Set(existing.map((file) => file.fileName.toLowerCase()));
  const base = `${stem}.${extension}`;
  if (!names.has(base.toLowerCase())) return base;

  let suffix = 1;
  while (names.has(`${stem}-${suffix}.${extension}`.toLowerCase())) {
    suffix += 1;
  }
  return `${stem}-${suffix}.${extension}`;
}

function objectLabel(file: Pick<MediaFileRecord, "name" | "url">): string {
  return `${file.name} (${file.url})`;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function inspectUpload(
  fileName: string,
  buffer: Buffer,
  sizeBytes = buffer.byteLength,
): Promise<{
  category: MediaCategory;
  mimeType: string;
  buffer: Buffer;
}> {
  return (async () => {
    try {
      assertMediaSize(fileName, sizeBytes);
      const detected = await detectMediaType(buffer, fileName);
      const sanitizedBuffer =
        detected.category === "IMAGE_SVG"
          ? Buffer.from(sanitizeSvg(buffer.toString("utf8")), "utf8")
          : buffer;
      return { ...detected, buffer: sanitizedBuffer };
    } catch (error) {
      if (error instanceof MediaDomainError) throw error;
      throw new MediaDomainError(
        "VALIDATION_ERROR",
        error instanceof Error ? error.message : "Invalid media file",
      );
    }
  })();
}

export class MediaService {
  private queue?: MediaQueue;

  constructor(
    private readonly database: MediaDatabase = prisma as unknown as MediaDatabase,
    private readonly storage: MediaStorage = createMediaStorage(),
    queue?: MediaQueue,
  ) {
    this.queue = queue;
  }

  private getQueue(): MediaQueue {
    this.queue ??= getPublishingQueue();
    return this.queue;
  }

  private transaction<T>(
    callback: (tx: MediaDatabase) => Promise<T>,
  ): Promise<T> {
    return this.database.$transaction(callback) as Promise<T>;
  }

  private async publicPurgeUrl(path: string): Promise<string> {
    if (!this.database.siteSettings) return path;
    const settings = await this.database.siteSettings.findUnique({
      where: { id: "singleton" },
    });
    const origin = getPublicOrigin({ siteUrl: settings?.siteUrl });
    return `${origin}/${path.replace(/^\/+/, "")}`;
  }

  private async shouldConvertToWebp(): Promise<boolean> {
    if (!this.database.siteSettings) return true;
    const settings = await this.database.siteSettings.findUnique({
      where: { id: "singleton" },
    });
    return settings?.webpConversionEnabled !== false;
  }

  async upload(
    userId: string,
    input: MediaUploadInput,
    audit?: LogEventContext,
  ): Promise<MediaFileRecord> {
    const folder = await this.database.mediaFolder.findUnique({
      where: { id: input.folderId },
    });
    if (!folder)
      throw new MediaDomainError("NOT_FOUND", "Media folder was not found");

    const inspected = await inspectUpload(
      input.fileName,
      input.buffer,
      input.sizeBytes,
    );
    const { category, mimeType, buffer: sanitizedBuffer } = inspected;
    const convertToWebp =
      category === "IMAGE_RASTER" && (await this.shouldConvertToWebp());
    const finalFileName = await nextFileName(
      this.database,
      input.folderId,
      normalizeStem(input.fileName),
      convertToWebp
        ? outputExtension(category)
        : getMediaExtension(input.fileName),
    );
    const id = randomUUID();
    const url = `/uploads/${id}/${finalFileName}`;
    const processingToken = convertToWebp ? randomUUID() : null;
    const processingStatus = processingToken ? "PROCESSING" : "READY";
    const record = {
      id,
      name: normalizeStem(input.fileName),
      fileName: finalFileName,
      url,
      mimeType: processingToken ? "image/webp" : mimeType,
      category,
      sizeBytes: sanitizedBuffer.byteLength,
      alt: normalizeNullable(input.alt),
      description: normalizeNullable(input.description),
      folderId: input.folderId,
      processingStatus,
      processingToken,
      createdAt: new Date(),
      updatedAt: new Date(),
    } satisfies MediaFileRecord;

    if (processingToken) {
      const stagingKey = `${id}-${processingToken}`;
      await this.storage.writeStaging(stagingKey, sanitizedBuffer);
      let created: MediaFileRecord;
      try {
        created = await this.transaction(async (tx) => {
          const persisted = await tx.mediaFile.create({ data: record });
          await logEvent(tx, {
            userId,
            action: "MEDIA_CREATED",
            objectType: "MEDIA",
            objectLabel: objectLabel(persisted),
            ...audit,
            objectId: persisted.id,
          });
          return persisted;
        });
      } catch (error) {
        await this.storage.removeStaging(stagingKey);
        if (isUniqueConstraintError(error)) {
          throw new MediaDomainError(
            "CONFLICT",
            "Media file URL is already in use",
          );
        }
        throw error;
      }

      try {
        await this.getQueue().add(
          `media-webp-${id}`,
          {
            type: "media-webp",
            mediaFileId: id,
            processingToken,
            stagingKey,
            userId,
            ...(audit ? { audit } : {}),
          },
          { jobId: `media-webp:${id}:${processingToken}` },
        );
      } catch {
        await this.storage.removeStaging(stagingKey);
        return this.transaction(async (tx) => {
          const failed = await tx.mediaFile.update({
            where: { id },
            data: { processingStatus: "FAILED" },
          });
          await logEvent(tx, {
            userId,
            action: "MEDIA_PROCESSING_FAILED",
            objectType: "MEDIA",
            objectLabel: objectLabel(failed),
            ...audit,
            objectId: failed.id,
          });
          return failed;
        });
      }

      return created;
    }

    try {
      await this.storage.writePublic(id, finalFileName, sanitizedBuffer);
      return await this.transaction(async (tx) => {
        const persisted = await tx.mediaFile.create({ data: record });
        await logEvent(tx, {
          userId,
          action: "MEDIA_CREATED",
          objectType: "MEDIA",
          objectLabel: objectLabel(persisted),
          ...audit,
          objectId: persisted.id,
        });
        return persisted;
      });
    } catch (error) {
      await this.storage.removePublic(id, finalFileName);
      if (isUniqueConstraintError(error)) {
        throw new MediaDomainError(
          "CONFLICT",
          "Media file URL is already in use",
        );
      }
      throw error;
    }
  }

  async uploadMany(
    userId: string,
    inputs: MediaUploadInput[],
  ): Promise<{
    items: MediaFileRecord[];
    errors: Array<{ fileName: string; message: string }>;
  }> {
    const items: MediaFileRecord[] = [];
    const errors: Array<{ fileName: string; message: string }> = [];
    for (const input of inputs) {
      try {
        items.push(await this.upload(userId, input));
      } catch (error) {
        errors.push({
          fileName: input.fileName,
          message:
            error instanceof Error ? error.message : "Unable to upload file",
        });
      }
    }
    return { items, errors };
  }

  async listMedia(
    options: {
      folderId?: string;
      search?: string;
      category?: MediaFileRecord["category"];
      processingStatus?: MediaFileRecord["processingStatus"];
      /** Scope 3 — pasta-mãe agrega itens da subtree. */
      includeDescendants?: boolean;
    } = {},
  ): Promise<MediaFileRecord[]> {
    const search = options.search?.trim();
    const searchClause = search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { url: { contains: search, mode: "insensitive" as const } },
            { alt: { contains: search, mode: "insensitive" as const } },
            { description: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {};

    const folderFilter = await this.resolveFolderFilter(
      options.folderId,
      options.includeDescendants === true,
    );

    // Mais recente no topo (mesmo critério do grid / listMediaPaginated).
    const media = await this.database.mediaFile.findMany({
      where: {
        folderId: folderFilter,
        category: options.category,
        processingStatus: options.processingStatus,
        ...searchClause,
      },
      orderBy: { createdAt: "desc" },
    });
    return Promise.all(
      media.map((item) => this.reconcilePublicReadiness(item)),
    );
  }

  /** Resolve folderId exato ou `{ in: subtree }` quando includeDescendants. */
  private async resolveFolderFilter(
    folderId: string | undefined,
    includeDescendants: boolean,
  ): Promise<string | { in: string[] } | undefined> {
    if (!folderId) return folderId;
    if (!includeDescendants) return folderId;
    if (!this.database.mediaFolder.findMany) return folderId;

    const folders = await this.database.mediaFolder.findMany();
    const subtree = new Set([folderId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const folder of folders) {
        if (
          folder.parentId &&
          subtree.has(folder.parentId) &&
          !subtree.has(folder.id)
        ) {
          subtree.add(folder.id);
          changed = true;
        }
      }
    }
    return { in: [...subtree] };
  }

  async listMediaPaginated(
    options: {
      folderId?: string;
      search?: string;
      category?: MediaFileRecord["category"];
      processingStatus?: MediaFileRecord["processingStatus"];
      includeDescendants?: boolean;
      page?: number;
      pageSize?: number;
    } = {},
  ): Promise<{
    items: MediaFileRecord[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page =
      Number.isInteger(options.page) && options.page && options.page > 0
        ? options.page
        : 1;
    const pageSize =
      Number.isInteger(options.pageSize) &&
      options.pageSize &&
      options.pageSize > 0
        ? Math.min(options.pageSize, 100)
        : 20;
    const search = options.search?.trim();
    const searchClause = search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { url: { contains: search, mode: "insensitive" as const } },
            { alt: { contains: search, mode: "insensitive" as const } },
            { description: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {};
    const folderFilter = await this.resolveFolderFilter(
      options.folderId,
      options.includeDescendants === true,
    );
    const where: MediaWhere = {
      folderId: folderFilter,
      category: options.category,
      processingStatus: options.processingStatus,
      ...searchClause,
    };

    if (!this.database.mediaFile.count) {
      const all = await this.listMedia(options);
      return {
        items: all.slice((page - 1) * pageSize, page * pageSize),
        total: all.length,
        page,
        pageSize,
      };
    }

    const [media, total] = await Promise.all([
      this.database.mediaFile.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.database.mediaFile.count({ where }),
    ]);
    return {
      items: await Promise.all(
        media.map((item) => this.reconcilePublicReadiness(item)),
      ),
      total,
      page,
      pageSize,
    };
  }

  async getMedia(mediaId: string): Promise<MediaFileRecord> {
    const media = await this.database.mediaFile.findUnique({
      where: { id: mediaId },
    });
    if (!media)
      throw new MediaDomainError("NOT_FOUND", "Media file was not found");
    return media;
  }

  /**
   * READY in the database is not enough: public pages need bytes under
   * public/uploads. Returns false for PROCESSING/FAILED or missing disk file.
   */
  async hasPublicBytes(
    media: Pick<MediaFileRecord, "id" | "fileName" | "processingStatus">,
  ): Promise<boolean> {
    if (!isPublicMediaUrlReady(media.processingStatus)) return false;
    return this.storage.existsPublic(media.id, media.fileName);
  }

  /**
   * If a record claims READY but the public file is gone (volume wipe, manual
   * delete), flip to FAILED so the library and publish validation do not lie.
   */
  async reconcilePublicReadiness(
    media: MediaFileRecord,
  ): Promise<MediaFileRecord> {
    if (media.processingStatus !== "READY") return media;
    if (await this.hasPublicBytes(media)) return media;

    return this.database.mediaFile.update({
      where: { id: media.id },
      data: {
        processingStatus: "FAILED",
        processingToken: null,
      },
    });
  }

  async updateMetadata(
    userId: string,
    input: unknown,
    audit?: LogEventContext,
  ): Promise<MediaFileRecord> {
    const parsed = updateMediaMetadataSchema.safeParse(input);
    if (!parsed.success) {
      throw new MediaDomainError("VALIDATION_ERROR", "Invalid media metadata");
    }

    const existing = await this.getMedia(parsed.data.id);
    const data: Partial<MediaFileRecord> = {};
    if (
      parsed.data.folderId !== undefined &&
      parsed.data.folderId !== existing.folderId
    ) {
      const folder = await this.database.mediaFolder.findUnique({
        where: { id: parsed.data.folderId },
      });
      if (!folder)
        throw new MediaDomainError("NOT_FOUND", "Media folder was not found");
      data.folderId = parsed.data.folderId;
    }
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.alt !== undefined)
      data.alt = normalizeNullable(parsed.data.alt);
    if (parsed.data.description !== undefined) {
      data.description = normalizeNullable(parsed.data.description);
    }
    if (!Object.keys(data).length) return existing;

    return this.transaction(async (tx) => {
      const updated = await tx.mediaFile.update({
        where: { id: existing.id },
        data,
      });
      await logEvent(tx, {
        userId,
        action: "MEDIA_UPDATED",
        objectType: "MEDIA",
        objectLabel: objectLabel(updated),
        ...audit,
        objectId: updated.id,
      });
      return updated;
    });
  }

  async convertToWebp(
    userId: string,
    mediaId: string,
    audit?: LogEventContext,
    operationId?: string,
  ): Promise<MediaFileRecord & { operationId?: string }> {
    const existing = await this.getMedia(mediaId);
    const previous = {
      fileName: existing.fileName,
      url: existing.url,
      mimeType: existing.mimeType,
      sizeBytes: existing.sizeBytes,
    };
    if (existing.category !== "IMAGE_RASTER") {
      throw new MediaDomainError(
        "VALIDATION_ERROR",
        "Only raster images can be converted to WebP",
      );
    }
    if (existing.processingStatus === "PROCESSING") {
      throw new MediaDomainError(
        "INVALID_STATE",
        "Media conversion is already processing",
      );
    }
    if (existing.processingStatus !== "READY") {
      throw new MediaDomainError(
        "INVALID_STATE",
        "Only ready media can be converted",
      );
    }
    if (existing.fileName.toLowerCase().endsWith(".webp")) {
      throw new MediaDomainError(
        "INVALID_STATE",
        "Media is already in WebP format",
      );
    }

    const source = await this.storage.readPublic(
      existing.id,
      existing.fileName,
    );
    if (!source)
      throw new MediaDomainError(
        "NOT_FOUND",
        "Media file content was not found",
      );

    const targetFileName = await nextFileName(
      this.database,
      existing.folderId,
      normalizeStem(existing.fileName),
      "webp",
    );
    const processingToken = randomUUID();
    const stagingKey = `${existing.id}-${processingToken}`;
    const targetUrl = `/uploads/${existing.id}/${targetFileName}`;
    await this.storage.writeStaging(stagingKey, source);

    let updated: MediaFileRecord;
    try {
      updated = await this.transaction(async (tx) => {
        const data = {
          fileName: targetFileName,
          url: targetUrl,
          mimeType: "image/webp",
          processingStatus: "PROCESSING" as const,
          processingToken,
        };
        let result: MediaFileRecord;
        if (tx.mediaFile.updateMany) {
          const claimed = await tx.mediaFile.updateMany({
            where: {
              id: existing.id,
              processingStatus: "READY",
              processingToken: null,
            },
            data,
          });
          if (claimed.count !== 1) {
            throw new MediaDomainError(
              "INVALID_STATE",
              "Media conversion is already processing",
            );
          }
          result = (await tx.mediaFile.findUnique({
            where: { id: existing.id },
          })) as MediaFileRecord;
        } else {
          result = await tx.mediaFile.update({
            where: { id: existing.id },
            data,
          });
        }
        await logEvent(tx, {
          userId,
          action: "MEDIA_CONVERSION_REQUESTED",
          objectType: "MEDIA",
          objectLabel: objectLabel(result),
          ...audit,
          objectId: result.id,
        });
        return result;
      });
    } catch (error) {
      await this.storage.removeStaging(stagingKey);
      throw error;
    }

    try {
      await this.getQueue().add(
        `media-webp-${existing.id}`,
        {
          type: "media-webp",
          mediaFileId: existing.id,
          processingToken,
          stagingKey,
          userId,
          previousFileName: previous.fileName,
          previousUrl: previous.url,
          previousMimeType: previous.mimeType,
          previousSizeBytes: previous.sizeBytes,
          ...(audit ? { audit } : {}),
        },
        {
          jobId: operationId ?? `media-webp:${existing.id}:${processingToken}`,
          ...(operationId ? { removeOnComplete: TRACKED_JOB_RETENTION } : {}),
        },
      );
    } catch {
      await this.storage.removeStaging(stagingKey);
      const failed = await this.transaction(async (tx) => {
        const failed = await tx.mediaFile.update({
          where: { id: existing.id },
          data: {
            fileName: previous.fileName,
            url: previous.url,
            mimeType: previous.mimeType,
            sizeBytes: previous.sizeBytes,
            processingStatus: "FAILED",
            processingToken: null,
          },
        });
        await logEvent(tx, {
          userId,
          action: "MEDIA_PROCESSING_FAILED",
          objectType: "MEDIA",
          objectLabel: objectLabel(failed),
          ...audit,
          objectId: failed.id,
        });
        return failed;
      });
      return operationId ? { ...failed, operationId } : failed;
    }

    return operationId ? { ...updated, operationId } : updated;
  }

  async replace(
    userId: string,
    mediaId: string,
    input: MediaReplaceInput,
    audit?: LogEventContext,
  ): Promise<MediaFileRecord> {
    const existing = await this.getMedia(mediaId);
    const inspected = await inspectUpload(
      input.fileName,
      input.buffer,
      input.sizeBytes,
    );
    const { category, mimeType, buffer: sanitizedBuffer } = inspected;
    const convertToWebp =
      category === "IMAGE_RASTER" && (await this.shouldConvertToWebp());

    if (category !== existing.category) {
      throw new MediaDomainError(
        "VALIDATION_ERROR",
        "Replacement must keep the existing media category",
      );
    }

    if (category === "IMAGE_RASTER" && convertToWebp) {
      const previous = {
        fileName: existing.fileName,
        url: existing.url,
        mimeType: existing.mimeType,
        sizeBytes: existing.sizeBytes,
      };
      // Reserve the WebP identity before queueing so READY never exposes
      // WebP bytes through a raster extension; the old bytes stay in storage
      // until the worker promotes the replacement.
      const targetFileName = existing.fileName.toLowerCase().endsWith(".webp")
        ? existing.fileName
        : await nextFileName(
            this.database,
            existing.folderId,
            normalizeStem(existing.fileName),
            "webp",
          );
      const targetUrl = `/uploads/${existing.id}/${targetFileName}`;
      const processingToken = randomUUID();
      const stagingKey = `${existing.id}-${processingToken}`;
      await this.storage.writeStaging(stagingKey, sanitizedBuffer);

      let updated: MediaFileRecord;
      try {
        updated = await this.transaction(async (tx) => {
          const result = await tx.mediaFile.update({
            where: { id: existing.id },
            data: {
              category: "IMAGE_RASTER",
              fileName: targetFileName,
              url: targetUrl,
              mimeType: "image/webp",
              sizeBytes: sanitizedBuffer.byteLength,
              processingStatus: "PROCESSING",
              processingToken,
            },
          });
          await logEvent(tx, {
            userId,
            action: "MEDIA_REPLACED",
            objectType: "MEDIA",
            objectLabel: objectLabel(result),
            ...audit,
            objectId: result.id,
          });
          return result;
        });
      } catch (error) {
        await this.storage.removeStaging(stagingKey);
        throw error;
      }

      try {
        await this.getQueue().add(
          `media-webp-${existing.id}`,
          {
            type: "media-webp",
            mediaFileId: existing.id,
            processingToken,
            stagingKey,
            userId,
            previousFileName: previous.fileName,
            previousUrl: previous.url,
            previousMimeType: previous.mimeType,
            previousSizeBytes: previous.sizeBytes,
            ...(audit ? { audit } : {}),
          },
          { jobId: `media-webp:${existing.id}:${processingToken}` },
        );
      } catch {
        await this.storage.removeStaging(stagingKey);
        return this.transaction(async (tx) => {
          const failed = await tx.mediaFile.update({
            where: { id: existing.id },
            data: {
              fileName: previous.fileName,
              url: previous.url,
              mimeType: previous.mimeType,
              sizeBytes: previous.sizeBytes,
              processingStatus: "FAILED",
              processingToken: null,
            },
          });
          await logEvent(tx, {
            userId,
            action: "MEDIA_PROCESSING_FAILED",
            objectType: "MEDIA",
            objectLabel: objectLabel(failed),
            objectId: failed.id,
            ...audit,
          });
          return failed;
        });
      }

      return updated;
    }

    const previous = await this.storage.readPublic(
      existing.id,
      existing.fileName,
    );
    await this.storage.writePublic(
      existing.id,
      existing.fileName,
      sanitizedBuffer,
    );

    try {
      const updated = await this.transaction(async (tx) => {
        const result = await tx.mediaFile.update({
          where: { id: existing.id },
          data: {
            mimeType,
            category,
            sizeBytes: sanitizedBuffer.byteLength,
            processingStatus: "READY",
            processingToken: null,
          },
        });
        await logEvent(tx, {
          userId,
          action: "MEDIA_REPLACED",
          objectType: "MEDIA",
          objectLabel: objectLabel(result),
          ...audit,
          objectId: result.id,
        });
        return result;
      });
      await cloudflarePurge(await this.publicPurgeUrl(existing.url));
      return updated;
    } catch (error) {
      if (previous) {
        await this.storage.writePublic(
          existing.id,
          existing.fileName,
          previous,
        );
      } else {
        await this.storage.removePublic(existing.id, existing.fileName);
      }
      throw error;
    }
  }

  async delete(
    userId: string,
    mediaId: string,
    audit?: LogEventContext,
  ): Promise<void> {
    const existing = await this.getMedia(mediaId);
    const previous = await this.storage.readPublic(
      existing.id,
      existing.fileName,
    );
    if (existing.processingToken) {
      await this.storage.removeStaging(
        `${existing.id}-${existing.processingToken}`,
      );
    }
    await this.storage.removePublic(existing.id, existing.fileName);

    try {
      await this.transaction(async (tx) => {
        await tx.mediaFile.delete({ where: { id: existing.id } });
        await logEvent(tx, {
          userId,
          action: "MEDIA_DELETED",
          objectType: "MEDIA",
          objectLabel: objectLabel(existing),
          ...audit,
          objectId: existing.id,
        });
      });
      await cloudflarePurge(await this.publicPurgeUrl(existing.url));
    } catch (error) {
      if (previous) {
        await this.storage.writePublic(
          existing.id,
          existing.fileName,
          previous,
        );
      }
      throw error;
    }
  }

  /** Overview da Home: total de arquivos + soma de bytes. */
  async countOverview(): Promise<MediaOverview> {
    if (this.database.mediaFile.count && this.database.mediaFile.aggregate) {
      const [total, sum] = await Promise.all([
        this.database.mediaFile.count(),
        this.database.mediaFile.aggregate({ _sum: { sizeBytes: true } }),
      ]);
      return { total, totalSizeBytes: sum._sum.sizeBytes ?? 0 };
    }
    const all = await this.database.mediaFile.findMany();
    return {
      total: all.length,
      totalSizeBytes: all.reduce((acc, file) => acc + (file.sizeBytes ?? 0), 0),
    };
  }
}

export type MediaOverview = {
  total: number;
  totalSizeBytes: number;
};

export const mediaService = new MediaService();

export type MediaStuckRecord = {
  id: string;
  name: string;
  url: string;
  processingToken: string | null;
};

export type MediaStuckReconcileDatabase = MediaFailureDatabase & {
  mediaFile: MediaFailureDatabase["mediaFile"] & {
    findMany(args: {
      where: { processingStatus: "PROCESSING"; updatedAt: { lt: Date } };
    }): Promise<MediaStuckRecord[]>;
  };
};

export type MediaStuckReconcileDependencies = {
  database: MediaStuckReconcileDatabase;
  storage: Pick<MediaStorage, "removeStaging">;
};

function defaultStuckReconcileDependencies(): MediaStuckReconcileDependencies {
  return {
    database: prisma as unknown as MediaStuckReconcileDatabase,
    storage: createMediaStorage(),
  };
}

/**
 * A media-webp job can vanish without ever reaching convertToWebp.ts's catch
 * (native crash, Redis evicting the BullMQ job under memory pressure), leaving
 * the record PROCESSING forever with no error logged anywhere. Sweep records
 * stale past staleAfterMs and mark them FAILED through the same optimistic-lock
 * path the catch uses, so a stuck upload self-heals without a manual restart
 * or delete. Unlike the catch, this never has the original job payload, so it
 * cannot revert replace fields (fileName/url/mimeType/sizeBytes) — only a live
 * job knows the prior values.
 */
export async function reconcileStuckMediaProcessing(
  dependencies: MediaStuckReconcileDependencies = defaultStuckReconcileDependencies(),
  staleAfterMs = 5 * 60 * 1000,
): Promise<{ checked: number; failed: number }> {
  const { database, storage } = dependencies;
  const cutoff = new Date(Date.now() - staleAfterMs);
  const stuck = await database.mediaFile.findMany({
    where: { processingStatus: "PROCESSING", updatedAt: { lt: cutoff } },
  });

  let failed = 0;
  for (const media of stuck) {
    if (!media.processingToken) continue;

    const marked = await markMediaProcessingFailed(database, {
      media,
      processingToken: media.processingToken,
      userId: SYSTEM_MEDIA_STUCK_RECONCILE_ACTOR_ID,
    });
    if (!marked) continue;

    failed += 1;
    await storage.removeStaging(`${media.id}-${media.processingToken}`);
  }

  return { checked: stuck.length, failed };
}
