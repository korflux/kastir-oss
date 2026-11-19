import { prisma } from "@/lib/prisma";
import {
  assertPublishableSlug,
  createPageSchema,
  pageObjectLabel,
  patchPageSchema,
  updatePageSchema,
} from "@/lib/Modules/Pages/Schema";
import {
  PagesDomainError,
  type PageRecord,
  type PageWithLifecycle,
} from "@/lib/Modules/Pages/Types";
import {
  PageLifecycle,
  availableSlug,
  mapSlugConflict,
  normalizeSeo,
  pageNotFound,
  validationError,
  type PageDatabase,
  type PageListWhere,
} from "@/lib/Modules/Pages/lifecycle";
import type { PageRevisionRecord } from "@/lib/Modules/Revisions/Types";
import { logEvent } from "@/lib/Logging/logEvent";
import type { LogEventContext } from "@/lib/Logging/logEvent";
import { cloudflarePurge } from "@/lib/Cdn/cloudflarePurge";
import {
  createMediaStorage,
  type MediaStorage,
} from "@/lib/Processing/mediaStorage";
import {
  createPageCompiler,
  type PageCompiler,
} from "@/lib/Publishing/pageCompiler";
import {
  createPageFileStore,
  getPublicDir,
  type PageFileStore,
} from "@/lib/Publishing/fileStore";
import { regeneratePublicArtifacts } from "@/lib/Publishing/publicSiteArtifacts";
import { rebuildSettings } from "@/lib/Publishing/settingsRebuild";
import {
  PAGE_TRASH_EXPIRE_BATCH_SIZE,
  PAGE_TRASH_RETENTION_MS,
} from "@/lib/Modules/Pages/Retention";
import { onHomePageRemoved } from "@/lib/SideEffects/onHomePageRemoved";
import { onPageRemovedFromScope } from "@/lib/SideEffects/onPageRemovedFromScope";
import type { PageRemovalContext } from "@/lib/SideEffects/Types";
import { SYSTEM_PAGE_RETENTION_ACTOR_ID } from "@/lib/SideEffects/Types";

// Contrato de banco definido junto do ciclo de vida; reexportado porque testes
// e chamadores injetam bancos parciais tipados por este caminho.
export type { PageDatabase } from "@/lib/Modules/Pages/lifecycle";

function parseOrThrow<T>(
  result: { success: true; data: T } | { success: false },
): T {
  if (!result.success) {
    throw validationError("Invalid page data");
  }
  return result.data;
}

const notFound = pageNotFound;

/**
 * Serviço de páginas: fronteira de domínio usada por rotas, MCP e jobs.
 * Valida a entrada, carrega a página, aplica listagem, lixeira, remoção e
 * duplicação. Save, Patch de conteúdo, Publish, Ativar, Desativar e Restaurar
 * versão (tudo que grava o rascunho ou move a página entre rascunho e no ar)
 * vivem em `PageLifecycle`, que este
 * Service constrói e usa como único ponto de escrita do site público.
 */
export class PageService {
  /** Ciclo de vida e ferramentas de site público (purge, artefatos, arquivo). */
  private readonly lifecycle: PageLifecycle;

  constructor(
    private readonly database: PageDatabase = prisma as unknown as PageDatabase,
    private readonly fileStore: PageFileStore = createPageFileStore(),
    compiler: PageCompiler = createPageCompiler(database),
    mediaStorage: MediaStorage = createMediaStorage(),
    // Threaded through explicitly so the public artifacts are regenerated next
    // to whatever fileStore this instance was given, instead of independently
    // resolving getPublicDir() again and drifting from it (e.g. in tests
    // that inject a fileStore backed by a temp directory).
    publicDir: string = getPublicDir(),
  ) {
    this.lifecycle = new PageLifecycle({
      database,
      fileStore,
      compiler,
      mediaStorage,
      regenerateArtifacts: () =>
        regeneratePublicArtifacts(
          database as unknown as Parameters<
            typeof regeneratePublicArtifacts
          >[0],
          publicDir,
        ),
    });
  }

  private transaction<T>(
    callback: (tx: PageDatabase) => Promise<T>,
  ): Promise<T> {
    return this.database.$transaction(callback) as Promise<T>;
  }

  /** Bloqueia o publish quando o HTML aponta para mídia ausente ou não pronta. */
  assertPublishableMediaReferences(content: string): Promise<void> {
    return this.lifecycle.assertPublishableMediaReferences(content);
  }

  private async captureRemovalContext(
    page: PageRecord,
    actorId: string,
  ): Promise<PageRemovalContext> {
    const [scopes, settings] = await Promise.all([
      this.database.snippetPageScope
        ? this.database.snippetPageScope.findMany({
            where: { pageId: page.id },
            select: { snippetId: true },
          })
        : Promise.resolve([]),
      this.database.siteSettings
        ? this.database.siteSettings.findUnique({ where: { id: "singleton" } })
        : Promise.resolve(null),
    ]);

    return {
      pageId: page.id,
      title: page.title,
      slug: page.slug,
      snippetIds: scopes.map((scope) => scope.snippetId),
      isHome: settings?.homePageId === page.id,
      actorId,
    };
  }

  private async runRemovalListeners(
    context: PageRemovalContext,
  ): Promise<boolean> {
    try {
      await onPageRemovedFromScope(context, {
        database: this.database as never,
      });
      return await onHomePageRemoved(context, {
        database: this.database as never,
        rebuild: (scope, pageIds) =>
          rebuildSettings(scope, [...pageIds], {
            database: this.database as never,
            fileStore: this.fileStore,
          }),
      });
    } catch (error) {
      console.error(
        "[Kastir] Page removal side effect failed",
        { pageId: context.pageId },
        error instanceof Error ? error.message : "unknown error",
      );
      throw error;
    }
  }

  private async finalizeRemovalInfrastructure(
    page: PageRecord,
    homeArtifactsDone: boolean,
  ): Promise<void> {
    await cloudflarePurge(await this.lifecycle.purgeUrl(page.slug)).catch(
      () => undefined,
    );
    if (!homeArtifactsDone) {
      await this.lifecycle.refreshArtifacts().catch(() => undefined);
    }
  }

  async listPages(
    options: {
      folderId?: string;
      includeDeleted?: boolean;
      search?: string;
      /** Scope 3 — pasta-mãe agrega itens da subtree. */
      includeDescendants?: boolean;
    } = {},
  ): Promise<PageRecord[]> {
    const include: NonNullable<
      Parameters<PageDatabase["page"]["findMany"]>[0]
    >["include"] = {
      author: {
        select: { id: true, name: true },
      },
    };
    if (this.database.snippet) {
      include.snippetScopes = {
        where: { snippet: { status: "PUBLISHED" } },
        select: { pageId: true },
      };
    }
    const search = options.search?.trim();
    const folderFilter = await this.resolveFolderFilter(
      options.folderId,
      options.includeDescendants === true,
    );
    const pages = await this.database.page.findMany({
      where: {
        // Active list: deletedAt IS NULL. Trash list: only soft-deleted rows.
        deletedAt: options.includeDeleted ? { not: null } : null,
        folderId: folderFilter,
        // Busca por título/slug (Scope 1) — combina com folderId via AND.
        ...(search
          ? {
              OR: [
                { title: { contains: search, mode: "insensitive" as const } },
                { slug: { contains: search, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      include,
    });
    const withSnippets = this.addActiveSnippetCount(pages);
    if (!options.includeDeleted) return withSnippets;
    return this.attachDeletedByActors(withSnippets);
  }

  /**
   * Resolve quem deletou cada página via último LogEntry PAGE_TRASHED.
   * Sem migration: o audit log já grava o ator no trashPage().
   */
  private async attachDeletedByActors(
    pages: PageRecord[],
  ): Promise<PageRecord[]> {
    if (pages.length === 0) return pages;
    const findMany = this.database.logEntry.findMany;
    if (!findMany) {
      return pages.map((page) => ({
        ...page,
        deletedBy: page.deletedBy ?? null,
      }));
    }

    const entries = await findMany({
      where: {
        action: "PAGE_TRASHED",
        objectType: "PAGE",
        objectId: { in: pages.map((page) => page.id) },
      },
      orderBy: { createdAt: "desc" },
      select: { objectId: true, userId: true },
    });

    // Primeira ocorrência por objectId = lixo mais recente (orderBy desc).
    const actorByPageId = new Map<string, string>();
    for (const entry of entries) {
      if (entry.objectId && !actorByPageId.has(entry.objectId)) {
        actorByPageId.set(entry.objectId, entry.userId);
      }
    }

    const userIds = [...new Set(actorByPageId.values())];
    const users =
      userIds.length > 0 && this.database.user?.findMany
        ? await this.database.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true },
          })
        : [];
    const userById = new Map(users.map((user) => [user.id, user]));

    return pages.map((page) => {
      const userId = actorByPageId.get(page.id);
      const user = userId ? userById.get(userId) : undefined;
      return {
        ...page,
        deletedBy: user ? { id: user.id, name: user.name } : null,
      };
    });
  }

  /** Resolve folderId exato ou `{ in: subtree }` quando includeDescendants. */
  private async resolveFolderFilter(
    folderId: string | undefined,
    includeDescendants: boolean,
  ): Promise<string | { in: string[] } | undefined> {
    if (!folderId) return folderId;
    if (!includeDescendants) return folderId;
    if (!this.database.pageFolder.findMany) return folderId;

    const folders = await this.database.pageFolder.findMany();
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

  private addActiveSnippetCount(pages: PageRecord[]): PageRecord[] {
    return pages.map((page) => {
      const pageWithScopes = page as PageRecord & { snippetScopes?: unknown[] };
      const publicPage = { ...pageWithScopes };
      delete publicPage.snippetScopes;
      return {
        ...publicPage,
        activeSnippetCount: Array.isArray(pageWithScopes.snippetScopes)
          ? pageWithScopes.snippetScopes.length
          : 0,
      };
    });
  }

  async listPagesPaginated(
    options: {
      search?: string;
      folderId?: string;
      status?: PageRecord["status"];
      includeDeleted?: boolean;
      includeDescendants?: boolean;
      page?: number;
      pageSize?: number;
    } = {},
  ): Promise<{
    items: PageRecord[];
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
    const folderFilter = await this.resolveFolderFilter(
      options.folderId,
      options.includeDescendants === true,
    );
    const where: PageListWhere = {
      deletedAt: options.includeDeleted ? { not: null } : null,
      folderId: folderFilter,
      status: options.status,
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: "insensitive" } },
              { slug: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const include: NonNullable<
      Parameters<PageDatabase["page"]["findMany"]>[0]
    >["include"] = {
      author: {
        select: { id: true, name: true },
      },
    };
    if (this.database.snippet) {
      include.snippetScopes = {
        where: { snippet: { status: "PUBLISHED" } },
        select: { pageId: true },
      };
    }
    const [pages, total] = await Promise.all([
      this.database.page.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include,
      }),
      this.database.page.count({ where }),
    ]);

    return {
      items: this.addActiveSnippetCount(pages),
      total,
      page,
      pageSize,
    };
  }

  async getPage(
    pageId: string,
    options: { includeDeleted?: boolean } = {},
  ): Promise<PageWithLifecycle> {
    // Author entra no GET de edição (Details footer do Figma Pages EDIT).
    const page = await this.database.page.findUnique({
      where: { id: pageId },
      include: { author: { select: { id: true, name: true } } },
    });
    if (!page || (page.deletedAt && !options.includeDeleted)) {
      throw notFound();
    }
    return this.lifecycle.withLifecycle(this.database, page);
  }

  /**
   * Lookup for private preview by slug. Trashed pages are not found.
   * Does not write public files or change status.
   */
  async getPreviewBySlug(slug: string): Promise<PageRecord> {
    let canonical: string;
    try {
      canonical = assertPublishableSlug(slug);
    } catch {
      throw notFound();
    }

    const page = await this.database.page.findUnique({
      where: { slug: canonical },
    });
    if (!page || page.deletedAt) {
      throw notFound();
    }
    return page;
  }

  /** Compile saved page HTML for /p/{slug} without admin bar or disk writes. */
  async compilePreviewHtml(page: PageRecord): Promise<string> {
    const previewCompiler = createPageCompiler(this.database, {
      includeAdminBar: false,
    });
    return previewCompiler(page);
  }

  /**
   * Preview só redireciona ao HTML público quando o rascunho é idêntico
   * à revisão publicada — senão /p/{slug} precisa mostrar o draft.
   */
  async shouldRedirectPreviewToPublic(page: PageRecord): Promise<boolean> {
    if (page.status !== "PUBLISHED") return false;
    const live = await this.lifecycle.withLifecycle(this.database, page);
    return !live.hasUnpublishedChanges;
  }

  async createPage(
    userId: string,
    input: unknown,
    audit?: LogEventContext,
  ): Promise<PageRecord> {
    const parsed = parseOrThrow(createPageSchema.safeParse(input));

    try {
      return await this.transaction(async (tx) => {
        const folder = await tx.pageFolder.findUnique({
          where: { id: parsed.folderId },
        });
        if (!folder) {
          throw notFound("Page folder was not found");
        }

        const slug = await availableSlug(
          tx,
          parsed.slug || parsed.title,
          !parsed.slug,
        );
        const page = await tx.page.create({
          data: {
            title: parsed.title,
            slug,
            content: parsed.content,
            seoTitle: normalizeSeo(parsed.seoTitle),
            seoDescription: normalizeSeo(parsed.seoDescription),
            seoKeyword: normalizeSeo(parsed.seoKeyword),
            status: "DRAFT",
            folderId: parsed.folderId,
            authorId: userId,
            publishedAt: null,
            deletedAt: null,
          },
        });

        await logEvent(tx, {
          userId,
          action: "PAGE_CREATED",
          objectType: "PAGE",
          objectLabel: pageObjectLabel(page),
          objectId: page.id,
          ...audit,
        });
        return page;
      });
    } catch (error) {
      throw mapSlugConflict(error);
    }
  }

  /**
   * Save: grava o rascunho; nunca publica nem fotografa (ver
   * `PageLifecycle.save`). Painel e MCP usam o mesmo método: a linha é travada
   * na transação e a versão esperada (`expectedContentSha256`, que vence
   * `expectedUpdatedAt`) é conferida depois da trava.
   */
  async updatePage(
    userId: string,
    input: unknown,
    audit?: LogEventContext,
  ): Promise<PageWithLifecycle> {
    const parsed = parseOrThrow(updatePageSchema.safeParse(input));
    return this.lifecycle.save(userId, parsed, audit);
  }

  /**
   * Edição parcial do conteúdo por busca e troca exata (ver
   * `PageLifecycle.patchContent`): `{id, expectedContentSha256, operations}`.
   * Hash diferente do rascunho atual é `CONFLICT`; operação inválida
   * (`VALIDATION_ERROR` com índice e contagem) não grava nem audita; resultado
   * idêntico ao conteúdo atual termina sem escrita.
   */
  async patchPageContent(
    userId: string,
    input: unknown,
    audit?: LogEventContext,
  ): Promise<PageWithLifecycle> {
    const parsed = parseOrThrow(patchPageSchema.safeParse(input));
    return this.lifecycle.patchContent(userId, parsed, audit);
  }

  /** Copia a revisão para o rascunho (ver `PageLifecycle.restoreRevision`). */
  async restorePageRevision(
    userId: string,
    pageId: string,
    revisionId: string,
    expectedUpdatedAt: Date,
    audit?: LogEventContext,
  ): Promise<PageWithLifecycle> {
    return this.lifecycle.restoreRevision(
      userId,
      pageId,
      revisionId,
      expectedUpdatedAt,
      audit,
    );
  }

  async setPageRevisionPinned(
    userId: string,
    pageId: string,
    revisionId: string,
    pinned: boolean,
    audit?: LogEventContext,
  ): Promise<PageRevisionRecord> {
    const page = await this.getPage(pageId);
    const revision = await this.lifecycle
      .revisionsOf(this.database)
      .setPageRevisionPinned({
        pageId: page.id,
        revisionId,
        pinned,
      });
    await logEvent(this.database, {
      userId,
      action: pinned ? "PAGE_REVISION_PINNED" : "PAGE_REVISION_UNPINNED",
      objectType: "PAGE",
      objectLabel: pageObjectLabel(page),
      objectId: page.id,
      ...audit,
    });
    return revision;
  }

  /** Publish: revisão nova, ponteiro e HTML no ar (ver `PageLifecycle.publish`). */
  async publishPage(
    userId: string,
    pageId: string,
    audit?: LogEventContext,
  ): Promise<PageWithLifecycle> {
    return this.lifecycle.publish(userId, await this.getPage(pageId), audit);
  }

  /** Liga só a revisão já publicada (ver `PageLifecycle.activate`). */
  async activatePage(
    userId: string,
    pageId: string,
    audit?: LogEventContext,
  ): Promise<PageWithLifecycle> {
    return this.lifecycle.activate(userId, await this.getPage(pageId), audit);
  }

  /** Tira o HTML do ar mantendo a revisão publicada (ver `PageLifecycle.unpublish`). */
  async unpublishPage(
    userId: string,
    pageId: string,
    audit?: LogEventContext,
  ): Promise<PageWithLifecycle> {
    return this.lifecycle.unpublish(userId, await this.getPage(pageId), audit);
  }

  async trashPage(
    userId: string,
    pageId: string,
    audit?: LogEventContext,
  ): Promise<PageRecord> {
    const page = await this.getPage(pageId);
    const context = await this.captureRemovalContext(page, userId);
    const published = await this.lifecycle.loadPublished(this.database, page);
    const publicSlug = published?.slug ?? page.slug;
    const previousContent = await this.fileStore.read(publicSlug);
    if (previousContent !== null) {
      await this.fileStore.remove(publicSlug);
    }

    let committed = false;
    let homeArtifactsDone = false;
    try {
      const trashed = await this.transaction(async (tx) => {
        const updated = await tx.page.update({
          where: { id: page.id },
          data: { status: "DRAFT", publishedAt: null, deletedAt: new Date() },
        });
        if (tx.snippetPageScope) {
          await tx.snippetPageScope.deleteMany({ where: { pageId: page.id } });
        }
        await logEvent(tx, {
          userId,
          action: "PAGE_TRASHED",
          objectType: "PAGE",
          objectLabel: pageObjectLabel(updated),
          objectId: updated.id,
          ...audit,
        });
        return updated;
      });
      committed = true;
      try {
        homeArtifactsDone = await this.runRemovalListeners(context);
      } finally {
        // Residual artifacts even when durable listeners fail mid-flight.
        await this.finalizeRemovalInfrastructure(page, homeArtifactsDone);
      }
      return trashed;
    } catch (error) {
      if (!committed && previousContent !== null) {
        await this.lifecycle.restoreFile(publicSlug, previousContent);
      }
      throw error;
    }
  }

  async restorePage(
    userId: string,
    pageId: string,
    audit?: LogEventContext,
  ): Promise<PageRecord> {
    const page = await this.getPage(pageId, { includeDeleted: true });
    if (!page.deletedAt) {
      throw new PagesDomainError("INVALID_STATE", "Page is not in the trash");
    }

    return this.transaction(async (tx) => {
      const restored = await tx.page.update({
        where: { id: page.id },
        data: { status: "DRAFT", publishedAt: null, deletedAt: null },
      });
      await logEvent(tx, {
        userId,
        action: "PAGE_RESTORED",
        objectType: "PAGE",
        objectLabel: pageObjectLabel(restored),
        objectId: restored.id,
        ...audit,
      });
      return restored;
    });
  }

  private async permanentlyDeletePageWithActor(
    page: PageRecord,
    actorId: string,
    deletedAtWhere: Date | { lt: Date },
  ): Promise<boolean> {
    // Capture while scopes/home pointer still exist, then reconcile BEFORE hard delete
    // so job retries can re-enter when the row is still present.
    const context = await this.captureRemovalContext(page, actorId);
    if (this.database.snippetPageScope) {
      await this.database.snippetPageScope.deleteMany({
        where: { pageId: page.id },
      });
    }

    let homeArtifactsDone = false;
    try {
      homeArtifactsDone = await this.runRemovalListeners(context);
    } catch (error) {
      await this.finalizeRemovalInfrastructure(page, homeArtifactsDone);
      throw error;
    }

    const previousContent = await this.fileStore.read(page.slug);
    if (previousContent !== null) {
      await this.fileStore.remove(page.slug);
    }

    let committed = false;
    try {
      const deleted = await this.transaction(async (tx) => {
        if (!tx.page.deleteMany) {
          throw new Error(
            "Page database does not support conditional deletion",
          );
        }
        const result = await tx.page.deleteMany({
          where: { id: page.id, deletedAt: deletedAtWhere },
        });
        if (result.count !== 1) return false;

        await logEvent(tx, {
          userId: actorId,
          action: "PAGE_PERMANENTLY_DELETED",
          objectType: "PAGE",
          objectLabel: pageObjectLabel(page),
          objectId: page.id,
        });
        return true;
      });

      if (!deleted) {
        // Lost the race (e.g. restore) — never delete a concurrent publish via null restore.
        if (previousContent !== null) {
          await this.lifecycle.restoreFile(page.slug, previousContent);
        }
        await this.finalizeRemovalInfrastructure(page, homeArtifactsDone);
        return false;
      }

      committed = true;
      await this.finalizeRemovalInfrastructure(page, homeArtifactsDone);
      return true;
    } catch (error) {
      if (!committed && previousContent !== null) {
        await this.lifecycle.restoreFile(page.slug, previousContent);
      }
      throw error;
    }
  }

  async permanentlyDeletePage(
    userId: string,
    pageId: string,
    role: "MASTER" | "ADMIN" | "EDITOR",
  ): Promise<void> {
    if (role === "EDITOR") {
      throw new PagesDomainError(
        "FORBIDDEN",
        "Editor cannot permanently delete pages",
      );
    }

    const page = await this.getPage(pageId, { includeDeleted: true });
    if (!page.deletedAt) {
      throw new PagesDomainError(
        "INVALID_STATE",
        "Page must be in the trash first",
      );
    }

    const deleted = await this.permanentlyDeletePageWithActor(
      page,
      userId,
      page.deletedAt,
    );
    if (!deleted) {
      throw new PagesDomainError(
        "INVALID_STATE",
        "Page is no longer in the trash",
      );
    }
  }

  async permanentlyDeletePageAsSystem(
    pageId: string,
    options: { now?: Date } = {},
  ): Promise<boolean> {
    const page = await this.database.page.findUnique({ where: { id: pageId } });
    if (!page || !page.deletedAt) return false;

    const now = options.now ?? new Date();
    const cutoff = new Date(now.getTime() - PAGE_TRASH_RETENTION_MS);
    if (page.deletedAt >= cutoff) return false;

    return this.permanentlyDeletePageWithActor(
      page,
      SYSTEM_PAGE_RETENTION_ACTOR_ID,
      { lt: cutoff },
    );
  }

  async expireTrashedPages(
    now = new Date(),
    options: { batchSize?: number } = {},
  ): Promise<number> {
    const cutoff = new Date(now.getTime() - PAGE_TRASH_RETENTION_MS);
    const batchSize = options.batchSize ?? PAGE_TRASH_EXPIRE_BATCH_SIZE;
    let deleted = 0;
    let failures = 0;
    const seen = new Set<string>();

    for (;;) {
      const candidates = await this.database.page.findMany({
        where: { deletedAt: { lt: cutoff } },
        orderBy: { createdAt: "asc" },
        take: batchSize,
      });
      const fresh = candidates.filter((page) => !seen.has(page.id));
      if (fresh.length === 0) break;

      for (const page of fresh) {
        seen.add(page.id);
        try {
          if (await this.permanentlyDeletePageAsSystem(page.id, { now })) {
            deleted += 1;
          }
        } catch (error) {
          failures += 1;
          console.error(
            "[Kastir] Failed to expire trashed page",
            { pageId: page.id },
            error instanceof Error ? error.message : "unknown error",
          );
        }
      }

      if (candidates.length < batchSize) break;
    }

    if (failures > 0) {
      throw new Error(
        `Trash expiration completed with ${failures} failure(s); deleted ${deleted}`,
      );
    }
    return deleted;
  }

  async duplicatePage(
    userId: string,
    pageId: string,
    audit?: LogEventContext,
  ): Promise<PageRecord> {
    try {
      return await this.transaction(async (tx) => {
        const source = await tx.page.findUnique({ where: { id: pageId } });
        if (!source || source.deletedAt) {
          throw notFound();
        }

        const slug = await availableSlug(tx, `${source.slug}-copia`, true);
        const copy = await tx.page.create({
          data: {
            title: source.title,
            slug,
            content: source.content,
            seoTitle: source.seoTitle,
            seoDescription: source.seoDescription,
            seoKeyword: source.seoKeyword,
            status: "DRAFT",
            folderId: source.folderId,
            authorId: userId,
            publishedAt: null,
            deletedAt: null,
          },
        });
        await logEvent(tx, {
          userId,
          action: "PAGE_DUPLICATED",
          objectType: "PAGE",
          objectLabel: pageObjectLabel(copy),
          objectId: copy.id,
          ...audit,
        });
        return copy;
      });
    } catch (error) {
      throw mapSlugConflict(error);
    }
  }

  /** Overview da Home: total ativo + publicadas nos últimos 7 dias. */
  async countOverview(): Promise<PagesOverview> {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [total, publishedThisWeek] = await Promise.all([
      this.database.page.count({ where: { deletedAt: null } }),
      this.database.page.count({
        where: { deletedAt: null, publishedAt: { gte: weekAgo } },
      }),
    ]);
    return { total, publishedThisWeek };
  }
}

export type PagesOverview = {
  total: number;
  publishedThisWeek: number;
};

export const pageService = new PageService();
