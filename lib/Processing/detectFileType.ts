import { fileTypeFromBuffer } from "file-type";

import type { MediaCategory } from "@/lib/Modules/Media/Types";

export const MEDIA_UPLOAD_LIMITS = {
  image: 20 * 1024 * 1024,
  svg: 20 * 1024 * 1024,
  pdf: 20 * 1024 * 1024,
  video: 200 * 1024 * 1024,
} as const;

type DeclaredMediaType = {
  category: MediaCategory;
  mimeType: string;
  extension: string;
  limit: number;
};

const DECLARED_TYPES: Record<string, DeclaredMediaType> = {
  jpg: {
    category: "IMAGE_RASTER",
    mimeType: "image/jpeg",
    extension: "jpg",
    limit: MEDIA_UPLOAD_LIMITS.image,
  },
  jpeg: {
    category: "IMAGE_RASTER",
    mimeType: "image/jpeg",
    extension: "jpeg",
    limit: MEDIA_UPLOAD_LIMITS.image,
  },
  png: {
    category: "IMAGE_RASTER",
    mimeType: "image/png",
    extension: "png",
    limit: MEDIA_UPLOAD_LIMITS.image,
  },
  webp: {
    category: "IMAGE_RASTER",
    mimeType: "image/webp",
    extension: "webp",
    limit: MEDIA_UPLOAD_LIMITS.image,
  },
  gif: {
    category: "IMAGE_RASTER",
    mimeType: "image/gif",
    extension: "gif",
    limit: MEDIA_UPLOAD_LIMITS.image,
  },
  svg: {
    category: "IMAGE_SVG",
    mimeType: "image/svg+xml",
    extension: "svg",
    limit: MEDIA_UPLOAD_LIMITS.svg,
  },
  pdf: {
    category: "DOCUMENT_PDF",
    mimeType: "application/pdf",
    extension: "pdf",
    limit: MEDIA_UPLOAD_LIMITS.pdf,
  },
  mp4: {
    category: "VIDEO_MP4",
    mimeType: "video/mp4",
    extension: "mp4",
    limit: MEDIA_UPLOAD_LIMITS.video,
  },
};

const SIGNATURE_MIME_TYPES: Record<string, string> = {
  "image/jpeg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
  "image/gif": "image/gif",
  "application/pdf": "application/pdf",
  "video/mp4": "video/mp4",
};

function assertSafeFileName(fileName: string): string {
  const trimmed = fileName.trim();
  if (
    !trimmed ||
    trimmed.includes("\0") ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed === "." ||
    trimmed === ".."
  ) {
    throw new Error("File name is not safe");
  }

  return trimmed;
}

export function getMediaExtension(fileName: string): string {
  const safeName = assertSafeFileName(fileName);
  const dot = safeName.lastIndexOf(".");
  if (dot <= 0 || dot === safeName.length - 1) {
    throw new Error("File extension is not allowed");
  }

  return safeName.slice(dot + 1).toLowerCase();
}

function getDeclaredType(fileName: string): DeclaredMediaType {
  const type = DECLARED_TYPES[getMediaExtension(fileName)];
  if (!type) {
    throw new Error("File extension is not allowed");
  }

  return type;
}

export function getMediaUploadLimit(fileName: string): number {
  return getDeclaredType(fileName).limit;
}

export function assertMediaSize(fileName: string, sizeBytes: number): void {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw new Error("File size is invalid");
  }

  if (sizeBytes > getMediaUploadLimit(fileName)) {
    throw new Error("File is too large");
  }
}

export async function detectMediaType(
  buffer: Buffer,
  fileName: string,
): Promise<DeclaredMediaType> {
  const declared = getDeclaredType(fileName);
  assertMediaSize(fileName, buffer.byteLength);

  if (declared.category === "IMAGE_SVG") {
    return declared;
  }

  const detected = await fileTypeFromBuffer(buffer);
  const detectedMime = detected
    ? SIGNATURE_MIME_TYPES[detected.mime]
    : undefined;
  if (!detectedMime) {
    throw new Error("File signature is not allowed");
  }

  if (detectedMime !== declared.mimeType) {
    throw new Error("File signature does not match its extension");
  }

  return declared;
}
