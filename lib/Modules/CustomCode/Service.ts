/**
 * Serviço de Custom Code (scripts): fronteira de domínio usada por rotas, MCP
 * e jobs. Valida a entrada, carrega o script e aplica listagem, criação,
 * duplicação, lixeira e remoção. Save, patch de conteúdo, Publish, Ativar,
 * Desativar e Restaurar versão (tudo que move o script entre rascunho e no ar,
 * com o rebuild das páginas afetadas) vivem em `CustomCodeLifecycle`, que este
 * Service constrói.
 */
import { randomUUID } from "node:crypto";

import type { ZodError } from "zod";

import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/Logging/logEvent";
import type { LogEventContext } from "@/lib/Logging/logEvent";
import {
  getPublishingQueue,
  TRACKED_JOB_RETENTION,
  type PublishingQueue,
} from "@/lib/Publishing/queue";
import {
  SCOPE_PAGE_IDS_INVALID_MESSAGE,
  createSnippetSchema,
  patchSnippetContentSchema,
  updateSnippetSchema,
  type CreateSnippetInput,
} from "@/lib/Modules/CustomCode/Schema";
import {
  CustomCodeDomainError,
  type InjectionPoint,
  type ScopeType,
  type SnippetRecord,
  type SnippetListItem,
  type SnippetStatus,
  type SnippetWithLifecycle,
} from "@/lib/Modules/CustomCode/Types";
import {
  CustomCodeLifecycle,
  NULL_TRIGGER_FIELDS,
  resolveTriggerFields,
  snippetInclude,
  snippetNotFound,
  snippetObjectLabel,
  snippetPageIds,
  uniqueIds,
  type CustomCodeMutationOptions,
  type SnippetDatabase,
} from "@/lib/Modules/CustomCode/lifecycle";
import type { SnippetRevisionRecord } from "@/lib/Modules/Revisions/Types";
import {
  PAGE_TRASH_EXPIRE_BATCH_SIZE,
  PAGE_TRASH_RETENTION_MS,
} from "@/lib/Modules/Pages/Retention";
import { SYSTEM_PAGE_RETENTION_ACTOR_ID } from "@/lib/SideEffects/Types";

// Opções de confirmação MCP definidas junto do ciclo de vida; reexportadas
// porque chamadores e testes as importam por este caminho.
export type { CustomCodeMutationOptions } from "@/lib/Modules/CustomCode/lifecycle";

/** Só o `add` da fila: é tudo que o rebuild precisa e facilita injetar dublê. */
export type CustomCodeQueue = Pick<PublishingQueue, "add">;

/**
 * Converte o resultado do `safeParse` de criação/edição em `VALIDATION_ERROR`. Recusa de
 * `pageIds` (id fora do cuid, tipo errado ou acima do teto) é checada antes e devolve a
 * mensagem fixa do escopo, para o painel e o chamador saberem qual campo corrigir; qualquer
 * outra recusa mantém o erro genérico. Nenhuma das mensagens ecoa o payload.
 */
function parseOrThrow<T>(
  result: { success: true; data: T } | { success: false; error: ZodError },
): T {
  if (!result.success) {
    const scopeRefused = result.error.issues.some(
      (issue) => issue.path[0] === "pageIds",
    );
    throw new CustomCodeDomainError(
      "VALIDATION_ERROR",
      scopeRefused ? SCOPE_PAGE_IDS_INVALID_MESSAGE : "Invalid snippet data",
    );
  }
  return result.data;
}

const notFound = snippetNotFound;

function boundedInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  return Number.isInteger(value) && value !== undefined
    ? Math.min(maximum, Math.max(1, value))
    : fallback;
}

const OPEN_TAG_PATTERN = /<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
const ID_ATTRIBUTE_PATTERN = /\bid\s*=\s*(["'])([^"']*)\1/i;
const CLASS_ATTRIBUTE_PATTERN = /\bclass\s*=\s*(["'])([^"']*)\1/i;

function isClickableTag(tagName: string, attrs: string): boolean {
  const tag = tagName.toLowerCase();
  if (tag === "button" || tag === "a") return true;
  if (tag === "input" && /\btype\s*=\s*["']?(submit|button)\b/i.test(attrs))
    return true;
  if (/\brole\s*=\s*["']button["']/i.test(attrs)) return true;
  if (/\bonclick\s*=/i.test(attrs)) return true;
  return false;
}

function collectSelectors(
  attrs: string,
  target: string[],
  seen: Set<string>,
): void {
  const id = attrs.match(ID_ATTRIBUTE_PATTERN)?.[2]?.trim();
  if (id && !seen.has(`#${id}`)) {
    seen.add(`#${id}`);
    target.push(`#${id}`);
  }

  const classValue = attrs.match(CLASS_ATTRIBUTE_PATTERN)?.[2];
  for (const token of classValue?.split(/\s+/).filter(Boolean) ?? []) {
    const selector = `.${token}`;
    if (!seen.has(selector)) {
      seen.add(selector);
      target.push(selector);
    }
  }
}

/**
 * Candidate `id`/`class` selectors for a Custom Code trigger, extracted from
 * raw page HTML with regex (same style as compile.ts — no HTML parser
 * dependency). Clickable elements (button, a, input[type=submit|button],
 * [role="button"], [onclick]) are listed first regardless of document order;
 * the rest follow, deduplicated across the whole input (so callers can join
 * several pages' content into one string to dedupe across pages too).
 */
export function extractSelectorCandidates(html: string): string[] {
  const tags = [...html.matchAll(OPEN_TAG_PATTERN)];
  const clickableSelectors: string[] = [];
  const otherSelectors: string[] = [];
  const seen = new Set<string>();

  for (const [, tagName, attrs] of tags) {
    if (isClickableTag(tagName, attrs))
      collectSelectors(attrs, clickableSelectors, seen);
  }
  for (const [, tagName, attrs] of tags) {
    if (!isClickableTag(tagName, attrs))
      collectSelectors(attrs, otherSelectors, seen);
  }

  return [...clickableSelectors, ...otherSelectors];
}

function mapSnippetData(
  input: CreateSnippetInput,
  status: SnippetStatus = "DRAFT",
): Record<string, unknown> {
  return {
    name: input.name,
    location: input.location,
    content: input.content,
    status,
    priority: input.priority ?? null,
    scopeType: input.scopeType,
    ...resolveTriggerFields(NULL_TRIGGER_FIELDS, input),
  };
}

export class CustomCodeService {
  private readonly databaseOverride?: SnippetDatabase;
  private queue?: CustomCodeQueue;
  /** Ciclo de vida do script; recebe o banco resolvido de forma preguiçosa e o rebuild. */
  private readonly lifecycle: CustomCodeLifecycle;

  constructor(database?: SnippetDatabase, queue?: CustomCodeQueue) {
    this.databaseOverride = database;
    this.queue = queue;
    this.lifecycle = new CustomCodeLifecycle({
      database: () => this.database,
      completeMutation: (mutation, compensate) =>
        this.completeMutation(mutation, compensate),
    });
  }

  /** Resolve Prisma lazily so hot reloads / post-generate clients are picked up. */
  private get database(): SnippetDatabase {
    return this.databaseOverride ?? (prisma as unknown as SnippetDatabase);
  }

  private getQueue(): CustomCodeQueue {
    this.queue ??= getPublishingQueue();
    return this.queue;
  }

  private transaction<T>(
    callback: (tx: SnippetDatabase) => Promise<T>,
  ): Promise<T> {
    return this.database.$transaction(callback);
  }

  /**
   * Enqueue page rebuilds one-by-one so a mid-batch failure still leaves
   * earlier jobs queued (idempotent handlers re-read DB after compensation).
   * Also refreshes public artifacts (best-effort): page-rebuild only rewrites
   * `public/<slug>/index.html`, but the home page is additionally served from
   * `public/index.html`, which only regeneratePublicArtifacts() touches — see
   * PageLifecycle.refreshArtifacts and BackupService's post-restore
   * settings-rebuild for the same pattern.
   */
  private async enqueueRebuilds(
    affectedPageIds: string[],
    operationId: string,
  ): Promise<void> {
    const pageIds = uniqueIds(affectedPageIds);
    if (pageIds.length === 0) return;

    const failures: string[] = [];
    for (const pageId of pageIds) {
      try {
        await this.getQueue().add(
          `page-rebuild-${pageId}`,
          { type: "page-rebuild", pageId },
          {
            jobId: `page-rebuild:${pageId}:${operationId}`,
            attempts: 3,
            backoff: { type: "exponential", delay: 1000 },
          },
        );
      } catch {
        failures.push(pageId);
      }
    }

    if (failures.length > 0) {
      throw new CustomCodeDomainError(
        "QUEUE_FAILED",
        "The snippet changed, but its page rebuild could not be queued",
      );
    }

    try {
      await this.getQueue().add(
        `settings-rebuild-${operationId}`,
        {
          type: "settings-rebuild",
          operationId,
          scope: "ARTIFACTS",
          pageIds: [],
        },
        {
          jobId: `settings-rebuild-${operationId}`,
          attempts: 3,
          backoff: { type: "exponential", delay: 60_000 },
          removeOnComplete: TRACKED_JOB_RETENTION,
          removeOnFail: false,
        },
      );
    } catch (error) {
      console.error(
        "[Kastir] Unable to enqueue artifact rebuild after snippet change",
        error instanceof Error ? error.message : "unknown error",
      );
    }
  }

  /**
   * After a successful DB mutation, enqueue rebuilds. On queue failure, run
   * compensation so we never leave "published in DB, static HTML never rebuilt".
   * Compensation is best-effort and conditioned on the post-mutation snapshot.
   * Também é o `completeMutation` entregue ao `CustomCodeLifecycle`.
   */
  private async completeMutation(
    mutation: { affectedPageIds: string[]; operationId: string },
    compensate?: () => Promise<void>,
  ): Promise<void> {
    try {
      await this.enqueueRebuilds(
        mutation.affectedPageIds,
        mutation.operationId,
      );
    } catch (error) {
      if (compensate) {
        try {
          await compensate();
        } catch {
          // Best-effort only; surface the original queue failure.
        }
      }
      if (error instanceof CustomCodeDomainError) throw error;
      throw new CustomCodeDomainError(
        "QUEUE_FAILED",
        "The snippet changed, but its page rebuild could not be queued",
      );
    }
  }

  private async getSnippetRecord(
    snippetId: string,
    options: { includeDeleted?: boolean } = {},
  ): Promise<SnippetRecord> {
    const snippet = await this.database.snippet.findUnique({
      where: { id: snippetId },
      include: snippetInclude,
    });
    if (!snippet || (snippet.deletedAt && !options.includeDeleted)) {
      throw notFound();
    }
    return { ...snippet, scopedPages: snippet.scopedPages ?? [] };
  }

  async listSnippets(
    options: {
      search?: string;
      status?: SnippetStatus;
      location?: InjectionPoint;
      scopeType?: ScopeType;
      includeDeleted?: boolean;
      page?: number;
      pageSize?: number;
    } = {},
  ): Promise<{
    items: SnippetListItem[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = boundedInteger(options.page, 1, Number.MAX_SAFE_INTEGER);
    const pageSize = boundedInteger(options.pageSize, 20, 100);
    const search = options.search?.trim();
    const where: Record<string, unknown> = {
      deletedAt: options.includeDeleted ? { not: null } : null,
    };
    if (options.status) where.status = options.status;
    if (options.location) where.location = options.location;
    if (options.scopeType) where.scopeType = options.scopeType;
    if (search) where.name = { contains: search, mode: "insensitive" };
    const [items, total] = await Promise.all([
      this.database.snippet.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: snippetInclude,
      }),
      this.database.snippet.count({ where }),
    ]);
    const mapped = items.map(
      (item) =>
        ({
          ...Object.fromEntries(
            Object.entries(item).filter(([key]) => key !== "content"),
          ),
          scopedPages: item.scopedPages ?? [],
        }) as SnippetListItem,
    );
    const withActors = options.includeDeleted
      ? await this.attachDeletedByActors(mapped)
      : mapped;
    return {
      items: withActors,
      total,
      page,
      pageSize,
    };
  }

  /** Resolve deletedBy via último LogEntry SCRIPT_TRASHED. */
  private async attachDeletedByActors(
    items: SnippetListItem[],
  ): Promise<SnippetListItem[]> {
    if (items.length === 0) return items;
    const findMany = this.database.logEntry.findMany;
    if (!findMany) {
      return items.map((item) => ({
        ...item,
        deletedBy: item.deletedBy ?? null,
      }));
    }
    const entries = await findMany({
      where: {
        action: "SCRIPT_TRASHED",
        objectType: "SCRIPT",
        objectId: { in: items.map((item) => item.id) },
      },
      orderBy: { createdAt: "desc" },
      select: { objectId: true, userId: true },
    });
    const actorById = new Map<string, string>();
    for (const entry of entries) {
      if (entry.objectId && !actorById.has(entry.objectId)) {
        actorById.set(entry.objectId, entry.userId);
      }
    }
    const userIds = [...new Set(actorById.values())];
    const users =
      userIds.length > 0 && this.database.user?.findMany
        ? await this.database.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true },
          })
        : [];
    const userById = new Map(users.map((user) => [user.id, user]));
    return items.map((item) => {
      const userId = actorById.get(item.id);
      const user = userId ? userById.get(userId) : undefined;
      return {
        ...item,
        deletedBy: user ? { id: user.id, name: user.name } : null,
      };
    });
  }

  /**
   * Páginas (não excluídas) no DTO mínimo `{ id, title, slug }` para o seletor de escopo.
   * Duas formas: busca paginada (`search`, `page`, `pageSize`) ou resolução por `ids`, que
   * devolve só as páginas pedidas que existem fora da lixeira (id sem página some do
   * resultado; o cliente mostra um rótulo legível) e ignora `search`/`page`/`pageSize`.
   * O limite de quantidade de `ids` é validado na borda (`listScopePagesQuerySchema`).
   */
  async listScopePages(
    options: {
      search?: string;
      ids?: string[];
      page?: number;
      pageSize?: number;
    } = {},
  ): Promise<{
    items: Array<{ id: string; title: string; slug: string }>;
    total: number;
    page: number;
    pageSize: number;
  }> {
    if (options.ids) {
      const ids = uniqueIds(options.ids);
      const items = ids.length
        ? await this.database.page.findMany({
            where: { id: { in: ids }, deletedAt: null },
            select: { id: true, title: true, slug: true },
            take: ids.length,
          })
        : [];
      return {
        items: items.map((item) => ({
          id: item.id,
          title: item.title ?? item.id,
          slug: item.slug ?? item.id,
        })),
        total: items.length,
        page: 1,
        pageSize: ids.length,
      };
    }
    const page = boundedInteger(options.page, 1, Number.MAX_SAFE_INTEGER);
    const pageSize = boundedInteger(options.pageSize, 20, 100);
    const search = options.search?.trim();
    const where = {
      deletedAt: null,
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: "insensitive" } },
              { slug: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.database.page.findMany({
        where,
        select: { id: true, title: true, slug: true },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.database.page.count({ where }),
    ]);
    return {
      items: items.map((item) => ({
        id: item.id,
        title: item.title ?? item.id,
        slug: item.slug ?? item.id,
      })),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Candidate trigger selectors aggregated from every page in the snippet's
   * own scope (same source `ScopePageSelector` reads) — ALL_PAGES reads every
   * non-deleted page, SPECIFIC_PAGES only the scoped ones. Concatenating all
   * pages' content before extraction dedupes selectors across pages for free.
   */
  async getScopeSelectors(snippetId: string): Promise<string[]> {
    const snippet = await this.getSnippetRecord(snippetId);
    const where =
      snippet.scopeType === "ALL_PAGES"
        ? { deletedAt: null }
        : { id: { in: uniqueIds(snippetPageIds(snippet)) }, deletedAt: null };
    const pages = await this.database.page.findMany({
      where,
      select: { content: true },
    });
    const html = pages
      .map((page) => (page as { content?: string }).content ?? "")
      .join("\n");
    return extractSelectorCandidates(html);
  }

  async getSnippet(snippetId: string): Promise<SnippetWithLifecycle> {
    const snippet = await this.getSnippetRecord(snippetId);
    return this.lifecycle.withLifecycle(this.database, snippet);
  }

  /**
   * EDITOR pode criar/editar/publicar JS no site público (stored XSS
   * intencional: o papel opera Scripts; só hard delete é bloqueado).
   */
  async createSnippet(
    userId: string,
    input: unknown,
    audit?: LogEventContext,
  ): Promise<SnippetRecord> {
    const parsed = parseOrThrow(createSnippetSchema.safeParse(input));
    const pageIds = await this.lifecycle.validateScope(
      parsed.scopeType,
      parsed.pageIds,
    );
    const snippet = await this.transaction(async (tx) => {
      const created = await tx.snippet.create({ data: mapSnippetData(parsed) });
      if (parsed.scopeType === "SPECIFIC_PAGES" && pageIds.length) {
        await tx.snippetPageScope.createMany({
          data: pageIds.map((pageId) => ({ snippetId: created.id, pageId })),
        });
      }
      await logEvent(tx, {
        userId,
        action: "SCRIPT_CREATED",
        objectType: "SCRIPT",
        objectLabel: snippetObjectLabel(created),
        ...audit,
        objectId: created.id,
      });
      return { ...created, scopedPages: pageIds.map((pageId) => ({ pageId })) };
    });
    return snippet as SnippetRecord;
  }

  /**
   * Save: grava o rascunho; nunca fotografa, publica nem enfileira rebuild
   * (ver `CustomCodeLifecycle.save`). Não carrega o script antes: o Save lê a
   * linha depois de travá-la, e é dessa leitura que sai a versão conferida e o
   * snapshot gravado. A confirmação MCP no 4º arg segue aceita por
   * compatibilidade e só vale em Publish/Ativar/Desativar.
   */
  async updateSnippet(
    userId: string,
    input: unknown,
    audit?: LogEventContext,
    options: CustomCodeMutationOptions = {},
  ): Promise<SnippetWithLifecycle> {
    void options;
    const parsed = parseOrThrow(updateSnippetSchema.safeParse(input));
    return this.lifecycle.save(userId, parsed, audit);
  }

  /**
   * Patch de conteúdo por busca e troca exata, com o hash do rascunho lido como
   * versão esperada (ver `CustomCodeLifecycle.patchContent`). Altera só o
   * conteúdo; grava pelo mesmo Save do update.
   */
  async patchSnippetContent(
    userId: string,
    input: unknown,
    audit?: LogEventContext,
  ): Promise<SnippetWithLifecycle> {
    const parsed = parseOrThrow(patchSnippetContentSchema.safeParse(input));
    const existing = await this.getSnippetRecord(parsed.id);
    return this.lifecycle.patchContent(userId, existing, parsed, audit);
  }

  /** Copia a revisão para o rascunho (ver `CustomCodeLifecycle.restoreRevision`). */
  async restoreSnippetRevision(
    userId: string,
    snippetId: string,
    revisionId: string,
    expectedUpdatedAt: Date,
    audit?: LogEventContext,
  ): Promise<SnippetWithLifecycle> {
    const existing = await this.getSnippetRecord(snippetId);
    return this.lifecycle.restoreRevision(
      userId,
      existing,
      revisionId,
      expectedUpdatedAt,
      audit,
    );
  }

  async setSnippetRevisionPinned(
    userId: string,
    snippetId: string,
    revisionId: string,
    pinned: boolean,
    audit?: LogEventContext,
  ): Promise<SnippetRevisionRecord> {
    const snippet = await this.getSnippetRecord(snippetId);
    const revision = await this.lifecycle
      .revisionsOf(this.database)
      .setSnippetRevisionPinned({
        snippetId: snippet.id,
        revisionId,
        pinned,
      });
    await logEvent(this.database, {
      userId,
      action: pinned ? "SCRIPT_REVISION_PINNED" : "SCRIPT_REVISION_UNPINNED",
      objectType: "SCRIPT",
      objectLabel: snippetObjectLabel(snippet),
      objectId: snippet.id,
      ...audit,
    });
    return revision;
  }

  /** Publish: revisão nova, ponteiro e rebuild (ver `CustomCodeLifecycle.publish`). */
  async publishSnippet(
    userId: string,
    snippetId: string,
    audit?: LogEventContext,
    options: CustomCodeMutationOptions = {},
  ): Promise<SnippetWithLifecycle> {
    const existing = await this.getSnippetRecord(snippetId);
    return this.lifecycle.publish(userId, existing, audit, options);
  }

  /** Liga só a revisão já publicada (ver `CustomCodeLifecycle.activate`). */
  async activateSnippet(
    userId: string,
    snippetId: string,
    audit?: LogEventContext,
    options: CustomCodeMutationOptions = {},
  ): Promise<SnippetWithLifecycle> {
    const existing = await this.getSnippetRecord(snippetId);
    return this.lifecycle.activate(userId, existing, audit, options);
  }

  /** Tira do ar mantendo a revisão publicada (ver `CustomCodeLifecycle.unpublish`). */
  async unpublishSnippet(
    userId: string,
    snippetId: string,
    audit?: LogEventContext,
    options: CustomCodeMutationOptions = {},
  ): Promise<SnippetWithLifecycle> {
    const existing = await this.getSnippetRecord(snippetId);
    return this.lifecycle.unpublish(userId, existing, audit, options);
  }

  async duplicateSnippet(
    userId: string,
    snippetId: string,
    audit?: LogEventContext,
  ): Promise<SnippetRecord> {
    const source = await this.getSnippetRecord(snippetId);
    // Só nomes — evita carregar content de todos os snippets.
    const named = await this.database.snippet.findMany({
      select: { name: true },
    });
    const names = new Set(
      named.map((snippet) => snippet.name.toLocaleLowerCase()),
    );
    const base = `${source.name}-copia`;
    let name = base;
    let suffix = 2;
    while (names.has(name.toLocaleLowerCase())) {
      name = `${base}-${suffix}`;
      suffix += 1;
    }
    const pageIds = snippetPageIds(source);
    const duplicate = await this.transaction(async (tx) => {
      const created = await tx.snippet.create({
        data: {
          name,
          location: source.location,
          content: source.content,
          status: "DRAFT",
          priority: source.priority,
          scopeType: source.scopeType,
          triggerType: source.triggerType,
          triggerConfig: source.triggerConfig,
          maxDisplays: source.maxDisplays,
          displayResetDays: source.displayResetDays,
        },
      });
      if (source.scopeType === "SPECIFIC_PAGES" && pageIds.length) {
        await tx.snippetPageScope.createMany({
          data: pageIds.map((pageId) => ({ snippetId: created.id, pageId })),
        });
      }
      await logEvent(tx, {
        userId,
        action: "SCRIPT_DUPLICATED",
        objectType: "SCRIPT",
        objectLabel: snippetObjectLabel(created),
        ...audit,
        objectId: created.id,
      });
      return { ...created, scopedPages: pageIds.map((pageId) => ({ pageId })) };
    });
    return duplicate as SnippetRecord;
  }

  /**
   * Soft delete (lixeira). Despublica se necessário e seta deletedAt.
   * DELETE da API admin chama isto (igual Pages).
   */
  async trashSnippet(
    userId: string,
    snippetId: string,
    audit?: LogEventContext,
  ): Promise<SnippetRecord> {
    const existing = await this.getSnippetRecord(snippetId);
    if (existing.deletedAt) {
      throw new CustomCodeDomainError(
        "INVALID_STATE",
        "Snippet is already in the trash",
      );
    }
    const affectedPageIds =
      existing.status === "PUBLISHED"
        ? await this.lifecycle.publishedPageIds(
            existing.scopeType,
            snippetPageIds(existing),
          )
        : [];
    const operationId = randomUUID();
    const trashed = await this.transaction(async (tx) => {
      const updated = await tx.snippet.update({
        where: { id: existing.id },
        data: { status: "DRAFT", deletedAt: new Date() },
      });
      await logEvent(tx, {
        userId,
        action: "SCRIPT_TRASHED",
        objectType: "SCRIPT",
        objectLabel: snippetObjectLabel(existing),
        ...audit,
        objectId: existing.id,
      });
      return { ...updated, scopedPages: existing.scopedPages ?? [] };
    });
    await this.completeMutation({ affectedPageIds, operationId });
    return trashed as SnippetRecord;
  }

  async restoreSnippet(
    userId: string,
    snippetId: string,
    audit?: LogEventContext,
  ): Promise<SnippetRecord> {
    const existing = await this.getSnippetRecord(snippetId, {
      includeDeleted: true,
    });
    if (!existing.deletedAt) {
      throw new CustomCodeDomainError(
        "INVALID_STATE",
        "Snippet is not in the trash",
      );
    }
    return this.transaction(async (tx) => {
      const restored = await tx.snippet.update({
        where: { id: existing.id },
        data: { status: "DRAFT", deletedAt: null },
      });
      await logEvent(tx, {
        userId,
        action: "SCRIPT_RESTORED",
        objectType: "SCRIPT",
        objectLabel: snippetObjectLabel(existing),
        ...audit,
        objectId: existing.id,
      });
      return {
        ...restored,
        scopedPages: existing.scopedPages ?? [],
        deletedAt: null,
      } as SnippetRecord;
    });
  }

  /**
   * Hard delete — só a partir da lixeira. EDITOR bloqueado (paridade Pages).
   */
  async permanentlyDeleteSnippet(
    userId: string,
    snippetId: string,
    role: "MASTER" | "ADMIN" | "EDITOR",
    audit?: LogEventContext,
  ): Promise<void> {
    if (role === "EDITOR") {
      throw new CustomCodeDomainError(
        "FORBIDDEN",
        "Editor cannot permanently delete scripts",
      );
    }
    const existing = await this.getSnippetRecord(snippetId, {
      includeDeleted: true,
    });
    if (!existing.deletedAt) {
      throw new CustomCodeDomainError(
        "INVALID_STATE",
        "Snippet must be in the trash first",
      );
    }
    // Já está DRAFT na lixeira — nada a rebuildar nas páginas publicadas.
    await this.transaction(async (tx) => {
      await tx.snippetPageScope.deleteMany({
        where: { snippetId: existing.id },
      });
      await tx.snippet.delete({ where: { id: existing.id } });
      await logEvent(tx, {
        userId,
        action: "SCRIPT_PERMANENTLY_DELETED",
        objectType: "SCRIPT",
        objectLabel: snippetObjectLabel(existing),
        ...audit,
        objectId: existing.id,
      });
    });
  }

  /** Overview da Home: total de snippets + drafts (ignora lixeira). */
  async countOverview(): Promise<ScriptsOverview> {
    const [total, draftCount] = await Promise.all([
      this.database.snippet.count({ where: { deletedAt: null } }),
      this.database.snippet.count({
        where: { status: "DRAFT", deletedAt: null },
      }),
    ]);
    return { total, draftCount };
  }

  /**
   * Hard-delete scripts na lixeira além da retenção (paridade Pages).
   * Roda no mesmo scheduler diário de expire-trashed-pages.
   */
  async expireTrashedSnippets(
    now = new Date(),
    options: { batchSize?: number; retentionMs?: number } = {},
  ): Promise<number> {
    const retentionMs = options.retentionMs ?? PAGE_TRASH_RETENTION_MS;
    const cutoff = new Date(now.getTime() - retentionMs);
    const batchSize = options.batchSize ?? PAGE_TRASH_EXPIRE_BATCH_SIZE;
    let deleted = 0;
    let failures = 0;
    const seen = new Set<string>();

    for (;;) {
      const candidates = await this.database.snippet.findMany({
        where: { deletedAt: { lt: cutoff } },
        orderBy: { createdAt: "asc" },
        take: batchSize,
      });
      const fresh = candidates.filter((row) => !seen.has(row.id));
      if (fresh.length === 0) break;

      for (const row of fresh) {
        seen.add(row.id);
        try {
          if (!row.deletedAt || row.deletedAt >= cutoff) continue;
          await this.transaction(async (tx) => {
            await tx.snippetPageScope.deleteMany({
              where: { snippetId: row.id },
            });
            await tx.snippet.delete({ where: { id: row.id } });
            await logEvent(tx, {
              userId: SYSTEM_PAGE_RETENTION_ACTOR_ID,
              action: "SCRIPT_PERMANENTLY_DELETED",
              objectType: "SCRIPT",
              objectLabel: snippetObjectLabel(row),
              objectId: row.id,
            });
          });
          deleted += 1;
        } catch (error) {
          failures += 1;
          console.error(
            "[Kastir] Failed to expire trashed script",
            { snippetId: row.id },
            error instanceof Error ? error.message : "unknown error",
          );
        }
      }
    }
    if (failures > 0) {
      throw new Error(
        `Trash expiration completed with ${failures} failure(s); deleted ${deleted}`,
      );
    }
    return deleted;
  }
}

export type ScriptsOverview = {
  total: number;
  draftCount: number;
};

export const customCodeService = new CustomCodeService();
