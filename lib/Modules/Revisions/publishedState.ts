/**
 * Único resolvedor do estado no ar: lê o snapshot de publishedRevisionId.
 * Sem ponteiro ou revisão inválida não cai no rascunho.
 */
import type { CompilableSnippet } from "@/lib/Publishing/compile";
import type {
  InjectionPoint,
  ScopeType,
  TriggerConfig,
  TriggerType,
} from "@/lib/Modules/CustomCode/Types";

export type PublishedPageRevisionSource = {
  id: string;
  pageId: string;
  title: string;
  slug: string;
  content: string;
  seoTitle: string | null;
  seoDescription: string | null;
  seoKeyword: string | null;
};

export type PublishedPageSource = {
  id: string;
  status: string;
  deletedAt: Date | null;
  publishedRevisionId?: string | null;
  publishedRevision?: PublishedPageRevisionSource | null;
};

export type PublishedPageState = {
  id: string;
  title: string;
  slug: string;
  content: string;
  seoTitle: string | null;
  seoDescription: string | null;
  seoKeyword: string | null;
};

export type PublishedSnippetRevisionSource = {
  id: string;
  snippetId: string;
  name: string;
  location: InjectionPoint;
  content: string;
  priority: number | null;
  scopeType: ScopeType;
  pageIds: readonly string[];
  triggerType: TriggerType | null;
  triggerConfig: TriggerConfig | Record<string, unknown> | null;
  maxDisplays: number | null;
  displayResetDays: number | null;
  createdAt: Date;
};

export type PublishedSnippetSource = {
  id: string;
  status: string;
  deletedAt: Date | null;
  publishedRevisionId?: string | null;
  publishedRevision?: PublishedSnippetRevisionSource | null;
};

export type PublishedSnippetState = CompilableSnippet & {
  scopeType: ScopeType;
  pageIds: string[];
};

export function resolvePublishedPage(
  page: PublishedPageSource,
): PublishedPageState | null {
  if (page.deletedAt || page.status !== "PUBLISHED") return null;
  const revision = page.publishedRevision;
  if (!page.publishedRevisionId || !revision) return null;
  if (revision.id !== page.publishedRevisionId) return null;
  if (revision.pageId !== page.id) return null;
  return {
    id: page.id,
    title: revision.title,
    slug: revision.slug,
    content: revision.content,
    seoTitle: revision.seoTitle,
    seoDescription: revision.seoDescription,
    seoKeyword: revision.seoKeyword,
  };
}

export function resolvePublishedSnippet(
  snippet: PublishedSnippetSource,
): PublishedSnippetState | null {
  if (snippet.deletedAt || snippet.status !== "PUBLISHED") return null;
  const revision = snippet.publishedRevision;
  if (!snippet.publishedRevisionId || !revision) return null;
  if (revision.id !== snippet.publishedRevisionId) return null;
  if (revision.snippetId !== snippet.id) return null;
  return {
    id: snippet.id,
    location: revision.location,
    content: revision.content,
    priority: revision.priority,
    createdAt: revision.createdAt,
    triggerType: revision.triggerType,
    triggerConfig: revision.triggerConfig,
    maxDisplays: revision.maxDisplays,
    displayResetDays: revision.displayResetDays,
    scopeType: revision.scopeType,
    pageIds: [...revision.pageIds],
  };
}

export function snippetAppliesToPage(
  snippet: PublishedSnippetState,
  pageId?: string,
): boolean {
  if (snippet.scopeType === "ALL_PAGES") return true;
  return Boolean(pageId && snippet.pageIds.includes(pageId));
}

/** Log genérico: só o id do recurso, nunca HTML/JS nem o snapshot. */
export function logUnresolvedPublishedRevision(resourceId: string): void {
  console.error(
    "[Kastir] Published revision could not be resolved",
    resourceId,
  );
}
