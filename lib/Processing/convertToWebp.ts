import type { Job } from "bullmq";
import sharp from "sharp";

import { cloudflarePurge } from "@/lib/Cdn/cloudflarePurge";
import { getPublicOrigin } from "@/lib/Modules/Settings/publicOrigin";
import { logEvent } from "@/lib/Logging/logEvent";
import { prisma } from "@/lib/prisma";
import type {
  PublishingAuditContext,
  PublishingJob,
} from "@/lib/Publishing/queue";
import {
  createMediaStorage,
  type MediaStorage,
} from "@/lib/Processing/mediaStorage";

export type MediaWebpJob = Extract<PublishingJob, { type: "media-webp" }>;

export type MediaProcessingDatabase = {
  mediaFile: {
    findUnique(args: { where: { id: string } }): Promise<{
      id: string;
      name: string;
      fileName: string;
      url: string;
      processingStatus: "PROCESSING" | "READY" | "FAILED";
      processingToken: string | null;
    } | null>;
    updateMany(args: {
      where: {
        id: string;
        processingStatus?: "PROCESSING" | "READY" | "FAILED";
        processingToken?: string | null;
      };
      data: {
        fileName?: string;
        url?: string;
        mimeType?: string;
        sizeBytes?: number;
        processingStatus?: "PROCESSING" | "READY" | "FAILED";
        processingToken?: string | null;
      };
    }): Promise<{ count: number }>;
  };
  siteSettings?: {
    findUnique(args: {
      where: { id: string };
    }): Promise<{ siteUrl: string | null } | null>;
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
};

export type MediaProcessingDependencies = {
  database: MediaProcessingDatabase;
  storage: MediaStorage;
};

function defaultDependencies(): MediaProcessingDependencies {
  return {
    database: prisma as unknown as MediaProcessingDatabase,
    storage: createMediaStorage(),
  };
}

function isCurrentToken(
  record: {
    processingStatus: "PROCESSING" | "READY" | "FAILED";
    processingToken: string | null;
  } | null,
  token: string,
): boolean {
  return (
    record?.processingStatus === "PROCESSING" &&
    record.processingToken === token
  );
}

function pendingFileName(processingToken: string): string {
  return `pending-${processingToken}.webp`;
}

/** Narrow surface markMediaProcessingFailed needs — a reconcile sweep has no findUnique to satisfy. */
export type MediaFailureDatabase = {
  mediaFile: Pick<MediaProcessingDatabase["mediaFile"], "updateMany">;
  logEntry: MediaProcessingDatabase["logEntry"];
};

export type MarkMediaProcessingFailedInput = {
  media: { id: string; name: string; url: string };
  processingToken: string;
  userId: string;
  audit?: PublishingAuditContext;
  /** Present when reverting a replace/conversion that changed these fields; omitted when no prior value is known (e.g. a reconcile sweep, which never saw the original job payload). */
  previousFileName?: string;
  previousUrl?: string;
  previousMimeType?: string;
  previousSizeBytes?: number;
};

/**
 * Marks a PROCESSING media record FAILED under the same optimistic lock
 * (processingToken) the worker uses, reverting replace fields when known and
 * writing the MEDIA_PROCESSING_FAILED audit entry. Shared by the synchronous
 * catch below and by reconcileStuckMediaProcessing (lib/Modules/Media/Service.ts),
 * so a stuck upload fails the same way whether the worker or a sweep catches it.
 */
export async function markMediaProcessingFailed(
  database: MediaFailureDatabase,
  input: MarkMediaProcessingFailedInput,
): Promise<boolean> {
  const {
    media,
    processingToken,
    userId,
    audit,
    previousFileName,
    previousUrl,
    previousMimeType,
    previousSizeBytes,
  } = input;

  const failed = await database.mediaFile.updateMany({
    where: {
      id: media.id,
      processingStatus: "PROCESSING",
      processingToken,
    },
    data: {
      ...(previousFileName ? { fileName: previousFileName } : {}),
      ...(previousUrl ? { url: previousUrl } : {}),
      ...(previousMimeType ? { mimeType: previousMimeType } : {}),
      ...(previousSizeBytes !== undefined
        ? { sizeBytes: previousSizeBytes }
        : {}),
      processingStatus: "FAILED",
      processingToken: null,
    },
  });

  if (failed.count === 1) {
    await logEvent(database, {
      userId,
      action: "MEDIA_PROCESSING_FAILED",
      objectType: "MEDIA",
      objectLabel: `${media.name} (${media.url})`,
      objectId: audit?.objectId ?? media.id,
      ...audit,
    });
  }

  return failed.count === 1;
}

export async function processMediaWebpJob(
  job: Job<MediaWebpJob>,
  dependencies: MediaProcessingDependencies = defaultDependencies(),
): Promise<void> {
  const { database, storage } = dependencies;
  const {
    mediaFileId,
    processingToken,
    stagingKey,
    userId,
    audit,
    previousFileName,
    previousUrl,
    previousMimeType,
    previousSizeBytes,
  } = job.data;
  const pendingName = pendingFileName(processingToken);

  const current = await database.mediaFile.findUnique({
    where: { id: mediaFileId },
  });

  if (!isCurrentToken(current, processingToken) || !current) {
    await storage.removeStaging(stagingKey);
    return;
  }

  try {
    const source = await storage.readStaging(stagingKey);
    const output = await sharp(source)
      .webp({
        quality: 82,
        effort: 6,
        smartSubsample: true,
      })
      .toBuffer();

    // Write to a pending path first so a stale job never replaces the live public file
    // before the token check below (and so replace keeps serving the previous WebP).
    await storage.writePublic(current.id, pendingName, output);

    const claimed = await database.mediaFile.updateMany({
      where: {
        id: current.id,
        processingStatus: "PROCESSING",
        processingToken,
      },
      data: {
        mimeType: "image/webp",
        sizeBytes: output.byteLength,
        processingStatus: "READY",
        processingToken: null,
      },
    });

    if (claimed.count !== 1) {
      await storage.removePublic(current.id, pendingName);
      return;
    }

    await storage.promotePublic(current.id, pendingName, current.fileName);
    if (previousFileName && previousFileName !== current.fileName) {
      await storage
        .removePublic(current.id, previousFileName)
        .catch(() => undefined);
    }
    const siteSettings = database.siteSettings
      ? await database.siteSettings.findUnique({ where: { id: "singleton" } })
      : null;
    const origin = siteSettings
      ? getPublicOrigin({ siteUrl: siteSettings.siteUrl })
      : null;
    const publicUrl = origin
      ? `${origin}/${current.url.replace(/^\/+/, "")}`
      : current.url;
    const previousPublicUrl =
      previousUrl && origin
        ? `${origin}/${previousUrl.replace(/^\/+/, "")}`
        : null;
    await cloudflarePurge(
      previousPublicUrl ? [publicUrl, previousPublicUrl] : publicUrl,
    );
  } catch (error) {
    await storage.removePublic(current.id, pendingName).catch(() => undefined);

    await markMediaProcessingFailed(database, {
      media: current,
      processingToken,
      userId,
      audit,
      previousFileName,
      previousUrl,
      previousMimeType,
      previousSizeBytes,
    });

    throw error;
  } finally {
    await storage.removeStaging(stagingKey);
  }
}
