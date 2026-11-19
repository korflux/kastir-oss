export type MediaCategory =
  "IMAGE_RASTER" | "IMAGE_SVG" | "DOCUMENT_PDF" | "VIDEO_MP4";

export type MediaProcessingStatus = "PROCESSING" | "READY" | "FAILED";

export type MediaAction =
  | "MEDIA_CREATED"
  | "MEDIA_UPDATED"
  | "MEDIA_REPLACED"
  | "MEDIA_DELETED"
  | "MEDIA_PROCESSING_FAILED"
  | "MEDIA_FOLDER_CREATED"
  | "MEDIA_FOLDER_RENAMED"
  | "MEDIA_FOLDER_RECOLORED"
  | "MEDIA_FOLDER_MOVED"
  | "MEDIA_FOLDER_DELETED";

export type MediaDomainErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_STATE"
  | "BASE_FOLDER_PROTECTED"
  | "FOLDER_DEPTH_EXCEEDED"
  | "UPLOAD_FAILED";

export class MediaDomainError extends Error {
  constructor(
    public readonly code: MediaDomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MediaDomainError";
  }
}

export type MediaFolderRecord = {
  id: string;
  name: string;
  color: string | null;
  parentId: string | null;
  isBase: boolean;
  createdAt?: Date;
  updatedAt?: Date;
};

export type MediaFileRecord = {
  id: string;
  name: string;
  fileName: string;
  url: string;
  mimeType: string;
  category: MediaCategory;
  sizeBytes: number;
  alt: string | null;
  description: string | null;
  folderId: string;
  processingStatus: MediaProcessingStatus;
  processingToken: string | null;
  createdAt: Date;
  updatedAt: Date;
};
