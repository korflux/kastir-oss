import type { PageSnapshot } from "@/lib/Modules/Revisions/Types";

export type PageStatus = "DRAFT" | "PUBLISHED";

export type PageAction =
  | "PAGE_CREATED"
  | "PAGE_UPDATED"
  | "PAGE_DUPLICATED"
  | "PAGE_PUBLISHED"
  | "PAGE_UNPUBLISHED"
  | "PAGE_TRASHED"
  | "PAGE_RESTORED"
  | "PAGE_REVISION_RESTORED"
  | "PAGE_REVISION_PINNED"
  | "PAGE_REVISION_UNPINNED"
  | "PAGE_REVISION_PURGED"
  | "PAGE_PERMANENTLY_DELETED"
  | "FOLDER_CREATED"
  | "FOLDER_RENAMED"
  | "FOLDER_RECOLORED"
  | "FOLDER_MOVED"
  | "FOLDER_DELETED";

export type PageDomainErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "FORBIDDEN"
  | "INVALID_STATE"
  | "BASE_FOLDER_PROTECTED"
  | "FOLDER_DEPTH_EXCEEDED";

export class PagesDomainError extends Error {
  constructor(
    public readonly code: PageDomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PagesDomainError";
  }
}

export type PageAuthorSummary = {
  id: string;
  name: string;
};

export type PageRecord = {
  id: string;
  title: string;
  slug: string;
  content: string;
  seoTitle: string | null;
  seoDescription: string | null;
  seoKeyword: string | null;
  status: PageStatus;
  folderId: string;
  authorId: string;
  publishedRevisionId?: string | null;
  author?: PageAuthorSummary | null;
  /** Quem moveu pra lixeira (último PAGE_TRASHED no audit log). */
  deletedBy?: PageAuthorSummary | null;
  activeSnippetCount?: number;
  publishedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Resposta de mutação/GET: rascunho, live, dirty e Ativado/Desativado. */
export type PageWithLifecycle = PageRecord & {
  published: PageSnapshot | null;
  hasUnpublishedChanges: boolean;
  draftFingerprint: string;
  activated: boolean;
  activatedDuringPublish?: boolean;
};

export type PageFolderRecord = {
  id: string;
  name: string;
  color: string | null;
  parentId: string | null;
  isBase: boolean;
  createdAt?: Date;
  updatedAt?: Date;
};
