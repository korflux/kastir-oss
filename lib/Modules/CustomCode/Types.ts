import type { SnippetSnapshot } from "@/lib/Modules/Revisions/Types";

export type InjectionPoint = "HEADER" | "BODY_START" | "BODY_END";

export type ScopeType = "ALL_PAGES" | "SPECIFIC_PAGES";

export type TriggerType =
  "SELECTOR_EVENT" | "PAGE_LOAD" | "SCROLL" | "REFERRER";

export type SelectorEventTriggerConfig = {
  selector: string;
  event: "click" | "submit";
};
export type PageLoadTriggerConfig = { delaySeconds: number };
export type ScrollTriggerConfig = { percentage: number };
export type ReferrerTriggerConfig = { matches: string };

export type TriggerConfig =
  | SelectorEventTriggerConfig
  | PageLoadTriggerConfig
  | ScrollTriggerConfig
  | ReferrerTriggerConfig;

export type SnippetStatus = "DRAFT" | "PUBLISHED";

export type CustomCodeAction =
  | "SCRIPT_CREATED"
  | "SCRIPT_UPDATED"
  | "SCRIPT_PUBLISHED"
  | "SCRIPT_UNPUBLISHED"
  | "SCRIPT_DUPLICATED"
  | "SCRIPT_TRASHED"
  | "SCRIPT_RESTORED"
  | "SCRIPT_REVISION_RESTORED"
  | "SCRIPT_REVISION_PINNED"
  | "SCRIPT_REVISION_UNPINNED"
  | "SCRIPT_REVISION_PURGED"
  | "SCRIPT_PERMANENTLY_DELETED"
  | "SCRIPT_DELETED";

export type CustomCodeDomainErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_STATE"
  | "FORBIDDEN"
  | "CONFIRMATION_REQUIRED"
  | "QUEUE_FAILED";

export class CustomCodeDomainError extends Error {
  constructor(
    public readonly code: CustomCodeDomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CustomCodeDomainError";
  }
}

export type SnippetScopeRecord = {
  pageId: string;
};

export type SnippetAuthorSummary = {
  id: string;
  name: string;
};

export type SnippetRecord = {
  id: string;
  name: string;
  location: InjectionPoint;
  content: string;
  status: SnippetStatus;
  priority: number | null;
  scopeType: ScopeType;
  scopedPages?: SnippetScopeRecord[];
  triggerType: TriggerType | null;
  triggerConfig: TriggerConfig | null;
  maxDisplays: number | null;
  displayResetDays: number | null;
  publishedRevisionId?: string | null;
  deletedAt: Date | null;
  /** Quem moveu pra lixeira (último SCRIPT_TRASHED no audit). */
  deletedBy?: SnippetAuthorSummary | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Resposta de mutação/GET: rascunho, live, dirty e Ativado/Desativado. */
export type SnippetWithLifecycle = SnippetRecord & {
  published: SnippetSnapshot | null;
  hasUnpublishedChanges: boolean;
  draftFingerprint: string;
  activated: boolean;
  activatedDuringPublish?: boolean;
};

export type SnippetListItem = Omit<SnippetRecord, "content">;

export type SnippetListOptions = {
  search?: string;
  status?: SnippetStatus;
  location?: InjectionPoint;
  page?: number;
  pageSize?: number;
};
