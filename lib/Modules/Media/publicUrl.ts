import type { MediaProcessingStatus } from "@/lib/Modules/Media/Types";

/**
 * A media URL is only safe to paste into a published page when processing is
 * READY (bytes are on the public volume). PROCESSING reserves the path but
 * does not write public/uploads yet.
 */
export function isPublicMediaUrlReady(status: MediaProcessingStatus): boolean {
  return status === "READY";
}

export type InternalUploadsRef = {
  mediaId: string;
  fileName: string;
};

/**
 * Parse an internal media path. Accepts `/uploads/{id}/{file}` or an absolute
 * URL whose pathname matches that shape. Does not decide same-origin — callers
 * that care about external hosts should check origin separately.
 */
export function parseInternalUploadsPath(
  raw: string,
): InternalUploadsRef | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let pathname = trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      pathname = new URL(trimmed).pathname;
    } catch {
      return null;
    }
  }

  pathname = pathname.split("?")[0]?.split("#")[0] ?? pathname;
  const match = pathname.match(/^\/uploads\/([^/]+)\/([^/]+)$/);
  if (!match) return null;

  const mediaId = match[1];
  const fileName = match[2];
  if (
    !mediaId ||
    !fileName ||
    mediaId === "." ||
    mediaId === ".." ||
    fileName === "." ||
    fileName === ".." ||
    mediaId.includes("\\") ||
    fileName.includes("\\")
  ) {
    return null;
  }

  return { mediaId, fileName };
}

export function buildPublicMediaUrl(mediaId: string, fileName: string): string {
  return `/uploads/${mediaId}/${fileName}`;
}
