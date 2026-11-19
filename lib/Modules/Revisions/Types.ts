/**
 * Tipos do módulo de revisões — snapshots imutáveis de Page e Snippet.
 * Adaptadores são tipados; a entrada externa nunca escolhe o tipo do recurso.
 */
import type {
  InjectionPoint,
  ScopeType,
  TriggerConfig,
  TriggerType,
} from "@/lib/Modules/CustomCode/Types";

export type RevisionDomainErrorCode =
  "VALIDATION_ERROR" | "NOT_FOUND" | "CONFLICT" | "FORBIDDEN";

export class RevisionsDomainError extends Error {
  constructor(
    public readonly code: RevisionDomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RevisionsDomainError";
  }
}

/** Campos editáveis da página que entram no snapshot — sem status nem ponteiro. */
export type PageSnapshot = {
  title: string;
  slug: string;
  content: string;
  seoTitle: string | null;
  seoDescription: string | null;
  seoKeyword: string | null;
  folderId: string;
};

/** Campos editáveis do script, inclusive escopo e trigger persistidos no snapshot. */
export type SnippetSnapshot = {
  name: string;
  location: InjectionPoint;
  content: string;
  priority: number | null;
  scopeType: ScopeType;
  pageIds: string[];
  triggerType: TriggerType | null;
  triggerConfig: TriggerConfig | null;
  maxDisplays: number | null;
  displayResetDays: number | null;
};

/**
 * Campos de ciclo de vida que Page e Snippet devolvem junto do registro: o
 * que está no ar (`published`), se o rascunho diverge dele e se o recurso está
 * ativado. `PageWithLifecycle` e `SnippetWithLifecycle` são o registro mais
 * estes campos, cada um com o seu snapshot.
 */
export type RevisionLifecycleFields<S> = {
  published: S | null;
  hasUnpublishedChanges: boolean;
  draftFingerprint: string;
  activated: boolean;
  activatedDuringPublish?: boolean;
};

/**
 * Fábrica de erro de domínio injetada pelo módulo dono do recurso (Pages ou
 * Custom Code), para que as guardas compartilhadas lancem o erro tipado do
 * próprio módulo, convertido em código público só na borda.
 */
export type RevisionLifecycleFailure = (
  code: "CONFLICT" | "INVALID_STATE",
  message: string,
) => Error;

export type PageRevisionRecord = PageSnapshot & {
  id: string;
  pageId: string;
  authorId: string;
  fingerprint: string;
  pinned: boolean;
  createdAt: Date;
};

export type SnippetRevisionRecord = SnippetSnapshot & {
  id: string;
  snippetId: string;
  authorId: string;
  fingerprint: string;
  pinned: boolean;
  createdAt: Date;
};

export type PersistRevisionResult<T> = {
  revision: T;
  reused: boolean;
};

export type PersistPageSnapshotInput = {
  pageId: string;
  authorId: string;
  snapshot: unknown;
};

export type PersistSnippetSnapshotInput = {
  snippetId: string;
  authorId: string;
  snapshot: unknown;
};

export type PageRevisionListItem = Pick<
  PageRevisionRecord,
  | "id"
  | "pageId"
  | "authorId"
  | "fingerprint"
  | "pinned"
  | "createdAt"
  | "title"
  | "slug"
> & {
  published: boolean;
  authorName?: string;
};

export type SnippetRevisionListItem = Pick<
  SnippetRevisionRecord,
  | "id"
  | "snippetId"
  | "authorId"
  | "fingerprint"
  | "pinned"
  | "createdAt"
  | "name"
> & {
  published: boolean;
  authorName?: string;
};

export type RevisionListResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type RevisionDiffTarget =
  | { kind: "draft"; snapshot: PageSnapshot | SnippetSnapshot }
  | { kind: "revision"; revisionId: string };

export type RevisionRetentionCandidate = {
  id: string;
  createdAt: Date;
  pinned: boolean;
};
