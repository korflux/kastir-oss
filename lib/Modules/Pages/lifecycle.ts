/**
 * Ciclo de vida de uma página: rascunho vs. revisão publicada e as operações
 * que movem um para o outro.
 *
 * Regra central: Save nunca muda o público; só Publish e Ativar escrevem o
 * HTML em disco e só Desativar o remove. Este módulo concentra:
 *  1. o recorte rascunho/publicado e as guardas de concorrência
 *     (`toPageSnapshot`, `assertPage*`, `attachPageLifecycle`), consumidos
 *     também por rotas de diff, MCP e backfill;
 *  2. o contrato de banco do módulo (`PageDatabase`) e a reserva de slug;
 *  3. `PageLifecycle`: Save, Patch de conteúdo, Restaurar versão, Publish,
 *     Ativar e Desativar, mais as ferramentas de site público que a remoção
 *     (lixeira) reutiliza.
 *
 * Save e Patch compartilham um único caminho de gravação do rascunho: a linha
 * da página é travada (`FOR UPDATE`) antes de qualquer leitura, a versão
 * esperada é conferida pela guarda comum (hash do conteúdo ou `updatedAt`) e
 * só então o rascunho é gravado, tudo na mesma transação. É isso que faz duas
 * gravações simultâneas com a mesma versão esperada terminarem em uma vitória
 * e um `CONFLICT`, no painel e no MCP.
 *
 * `PageService` valida a entrada, carrega a página e delega para cá; os erros
 * são exceções de domínio (`PagesDomainError`), convertidas na borda. Este
 * arquivo só importa tipos e helpers leves de infraestrutura: backfill, rotas
 * de diff e ferramentas MCP o carregam só para `toPageSnapshot`, e as
 * dependências pesadas (compilador, disco, artefatos públicos) chegam por
 * injeção em `PageLifecycleDeps`.
 */
import type { PrismaClient } from "@/app/generated/prisma/client";
import { cloudflarePurge } from "@/lib/Cdn/cloudflarePurge";
import { logEvent } from "@/lib/Logging/logEvent";
import type { LogEventContext } from "@/lib/Logging/logEvent";
import { extractInternalUploadsFromHtml } from "@/lib/Modules/Media/references";
import {
  MAX_PAGE_CONTENT_BYTES,
  assertPublishableSlug,
  pageObjectLabel,
  type PatchPageInput,
  type UpdatePageInput,
} from "@/lib/Modules/Pages/Schema";
import {
  PagesDomainError,
  type PageRecord,
  type PageWithLifecycle,
} from "@/lib/Modules/Pages/Types";
import {
  attachRevisionLifecycle,
  createRevisionLifecycleGuards,
  revisionServiceFor,
} from "@/lib/Modules/Revisions/lifecycle";
import type { PublishedSnippetSource } from "@/lib/Modules/Revisions/publishedState";
import type { RevisionService } from "@/lib/Modules/Revisions/Service";
import {
  pageSnapshotFingerprint,
  pageSnapshotsEqual,
} from "@/lib/Modules/Revisions/snapshot";
import type {
  PageRevisionRecord,
  PageSnapshot,
} from "@/lib/Modules/Revisions/Types";
import { getPublicOrigin } from "@/lib/Modules/Settings/publicOrigin";
import {
  ContentPatchError,
  applyContentPatch,
  type ContentPatchOperation,
} from "@/lib/Modules/Shared/ContentPatch";
import { lockRowForUpdate } from "@/lib/Modules/Shared/RowLock";
import type { MediaStorage } from "@/lib/Processing/mediaStorage";
import type { PageFileStore } from "@/lib/Publishing/fileStore";
import type { PageCompiler } from "@/lib/Publishing/pageCompiler";

/* ----------------- recorte rascunho/publicado e guardas ----------------- */

export function toPageSnapshot(page: {
  title: string;
  slug: string;
  content: string;
  seoTitle: string | null;
  seoDescription: string | null;
  seoKeyword: string | null;
  folderId: string;
}): PageSnapshot {
  return {
    title: page.title,
    slug: page.slug,
    content: page.content,
    seoTitle: page.seoTitle,
    seoDescription: page.seoDescription,
    seoKeyword: page.seoKeyword,
    folderId: page.folderId,
  };
}

export function pageNotFound(message = "Page was not found"): PagesDomainError {
  return new PagesDomainError("NOT_FOUND", message);
}

const guards = createRevisionLifecycleGuards({
  resource: "Page",
  fail: (code, message) => new PagesDomainError(code, message),
});

export const assertPageExpectedUpdatedAt = guards.assertExpectedUpdatedAt;

/**
 * Guarda de versão do Save e do Patch: com `contentSha256` confere só o hash do
 * conteúdo lido depois da trava e ignora `updatedAt`; sem ele vale `updatedAt`.
 */
export const assertPageExpectedVersion = guards.assertExpectedVersion;

/** Ativar só liga o ponteiro lido; Publish concorrente não pode trocar o arquivo. */
export const assertPageActivatePointerUnchanged =
  guards.assertActivatePointerUnchanged;

/** Desativar remove o arquivo da revisão lida; ponteiro novo aborta e restaura. */
export const assertPageUnpublishPointerUnchanged =
  guards.assertUnpublishPointerUnchanged;

export function attachPageLifecycle(
  page: PageRecord,
  published: PageSnapshot | null,
  extra: { activatedDuringPublish?: boolean } = {},
): PageWithLifecycle {
  return attachRevisionLifecycle(
    page,
    toPageSnapshot(page),
    published,
    { fingerprint: pageSnapshotFingerprint, equal: pageSnapshotsEqual },
    extra,
  );
}

/* ------------------------- contrato de banco ------------------------- */

type PageWhere = { id?: string; slug?: string };

export type PageListWhere = {
  deletedAt?: Date | null | { not: null } | { lt: Date };
  folderId?: string | { in: string[] };
  status?: PageRecord["status"];
  publishedAt?: { gte: Date } | null;
  OR?: Array<
    | { title: { contains: string; mode: "insensitive" } }
    | { slug: { contains: string; mode: "insensitive" } }
  >;
};

/**
 * O que o módulo de Pages precisa do banco. Definido aqui (e reexportado por
 * `Pages/Service`) porque o ciclo de vida e o Service dependem do mesmo
 * contrato; as lojas opcionais permitem injetar bancos parciais em teste.
 */
export type PageDatabase = {
  page: {
    findUnique(args: {
      where: PageWhere;
      include?: {
        author: { select: { id: true; name: true } };
      };
    }): Promise<PageRecord | null>;
    findFirst?(args: {
      where: {
        id?: { not: string };
        deletedAt?: null;
        publishedRevision?: { slug: string };
      };
    }): Promise<PageRecord | null>;
    findMany(args?: {
      where?: PageListWhere;
      orderBy?: { createdAt: "asc" | "desc" };
      skip?: number;
      take?: number;
      include?: {
        author: { select: { id: true; name: true } };
        snippetScopes?: unknown;
      };
    }): Promise<PageRecord[]>;
    /** Obrigatório: listagem paginada e overview da Home contam no banco, sem fallback em memória. */
    count(args?: { where?: PageListWhere }): Promise<number>;
    create(args: {
      data: {
        title: string;
        slug: string;
        content: string;
        seoTitle: string | null;
        seoDescription: string | null;
        seoKeyword: string | null;
        status: "DRAFT";
        folderId: string;
        authorId: string;
        publishedAt: null;
        deletedAt: null;
      };
    }): Promise<PageRecord>;
    update(args: {
      where: { id: string };
      data: Partial<PageRecord>;
    }): Promise<PageRecord>;
    delete(args: { where: { id: string } }): Promise<PageRecord>;
    deleteMany?(args: {
      where: { id: string; deletedAt?: Date | { lt: Date } };
    }): Promise<{ count: number }>;
  };
  pageFolder: {
    findUnique(args: { where: { id: string } }): Promise<{ id: string } | null>;
    findMany?(args?: {
      where?: { id?: string; parentId?: string | null };
    }): Promise<Array<{ id: string; parentId: string | null }>>;
  };
  pageRevision?: {
    findFirst(args: {
      where: { pageId?: string; fingerprint?: string; slug?: string };
    }): Promise<PageRevisionRecord | null>;
    findUnique(args: {
      where: { id: string };
    }): Promise<PageRevisionRecord | null>;
    findMany?(args: {
      where?: { pageId?: string; slug?: string };
    }): Promise<PageRevisionRecord[]>;
    count?(args: {
      where: { pageId: string; pinned?: boolean };
    }): Promise<number>;
    update?(args: {
      where: { id: string };
      data: { pinned: boolean };
    }): Promise<PageRevisionRecord>;
    create(args: {
      data: {
        pageId: string;
        authorId: string;
        fingerprint: string;
        title: string;
        slug: string;
        content: string;
        seoTitle: string | null;
        seoDescription: string | null;
        seoKeyword: string | null;
        folderId: string;
      };
    }): Promise<PageRevisionRecord>;
  };
  snippet?: {
    findMany(args: {
      where: unknown;
      include?: { publishedRevision: true };
    }): Promise<PublishedSnippetSource[]>;
  };
  snippetPageScope?: {
    findMany(args: {
      where: { pageId: string };
      select: { snippetId: true };
    }): Promise<Array<{ snippetId: string }>>;
    deleteMany(args: { where: { pageId: string } }): Promise<{ count: number }>;
  };
  siteSettings?: {
    findUnique(args: { where: { id: string } }): Promise<{
      homePageId: string | null;
      siteUrl: string | null;
      siteTitle: string;
      seoDescription: string | null;
      siteLanguage: string;
      indexable: boolean;
      faviconMediaId: string | null;
    } | null>;
  };
  mediaFile?: {
    findUnique(args: { where: { id: string } }): Promise<{
      id: string;
      fileName: string;
      url: string;
      processingStatus: "PROCESSING" | "READY" | "FAILED";
    } | null>;
  };
  logEntry: {
    create(args: {
      data: {
        userId: string;
        action: string;
        objectType: "PAGE";
        objectLabel: string;
      };
    }): Promise<unknown>;
    /** Opcional — usado na lista da lixeira pra resolver deletedBy. */
    findMany?(args: {
      where: {
        action: string;
        objectType: "PAGE";
        objectId: { in: string[] };
      };
      orderBy: { createdAt: "desc" };
      select: { objectId: true; userId: true };
    }): Promise<Array<{ objectId: string | null; userId: string }>>;
  };
  user?: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: { id: true; name: true };
    }): Promise<Array<{ id: string; name: string }>>;
  };
  /**
   * Só a trava de linha do Save (`lockRowForUpdate`) usa: tagged template do
   * Prisma, com os valores vinculados como parâmetro. Obrigatório porque todo
   * Save trava; mocks de teste entram com `vi.fn()`.
   */
  $queryRaw: PrismaClient["$queryRaw"];
  $transaction(
    callback: (tx: PageDatabase) => Promise<unknown>,
    options?: { isolationLevel?: "Serializable" },
  ): Promise<unknown>;
};

/* ------------------------ erros e helpers de borda ------------------------ */

/** Recusa de dado inválido; a borda converte em VALIDATION_ERROR. */
export function validationError(message: string): PagesDomainError {
  return new PagesDomainError("VALIDATION_ERROR", message);
}

/** SEO vazio ou só com espaços vira null, como no snapshot. */
export function normalizeSeo(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

/**
 * Aplica as operações do patch pela fonte comum (`Shared/ContentPatch`) com o
 * limite de bytes da página e converte a falha tipada em `VALIDATION_ERROR`.
 * A mensagem do `ContentPatchError` já traz o índice da operação, a contagem
 * ou o limite e nunca repete conteúdo enviado, então segue direto ao agente.
 */
function applyPagePatch(
  content: string,
  operations: readonly ContentPatchOperation[],
): string {
  try {
    return applyContentPatch(content, operations, {
      maxBytes: MAX_PAGE_CONTENT_BYTES,
    });
  } catch (error) {
    if (error instanceof ContentPatchError) {
      throw validationError(error.message);
    }
    throw error;
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Colisão de slug no banco (P2002) vira CONFLICT de domínio; qualquer outro
 * erro segue intacto. Uso: `catch (error) { throw mapSlugConflict(error); }`.
 */
export function mapSlugConflict(error: unknown): unknown {
  return isUniqueConstraintError(error)
    ? new PagesDomainError("CONFLICT", "Page slug is already in use")
    : error;
}

/* ----------------------------- reserva de slug ----------------------------- */

/** Slug no ar de outra página fica reservado contra rascunho e publicação. */
async function slugTakenByPublishedRevision(
  database: PageDatabase,
  slug: string,
  currentId?: string,
): Promise<boolean> {
  if (database.page.findFirst) {
    const occupant = await database.page.findFirst({
      where: {
        ...(currentId ? { id: { not: currentId } } : {}),
        deletedAt: null,
        publishedRevision: { slug },
      },
    });
    return occupant !== null;
  }
  const matches = database.pageRevision?.findMany
    ? await database.pageRevision.findMany({ where: { slug } })
    : [];
  for (const revision of matches) {
    if (revision.pageId === currentId) continue;
    const owner = await database.page.findUnique({
      where: { id: revision.pageId },
    });
    if (
      owner &&
      !owner.deletedAt &&
      owner.publishedRevisionId === revision.id
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Resolve o slug final: `automatic` (derivado do título) acrescenta -2, -3...
 * até achar um livre; slug escolhido pelo usuário em uso é CONFLICT.
 */
export async function availableSlug(
  database: PageDatabase,
  requested: string,
  automatic: boolean,
  currentId?: string,
): Promise<string> {
  let base: string;
  try {
    base = assertPublishableSlug(requested);
  } catch (error) {
    throw validationError(
      error instanceof Error ? error.message : "Invalid page slug",
    );
  }

  let candidate = base;
  let suffix = 2;
  while (true) {
    const existing = await database.page.findUnique({
      where: { slug: candidate },
    });
    const reserved = await slugTakenByPublishedRevision(
      database,
      candidate,
      currentId,
    );
    if ((!existing || existing.id === currentId) && !reserved) {
      return candidate;
    }

    if (!automatic) {
      throw new PagesDomainError("CONFLICT", "Page slug is already in use");
    }

    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}

/* ------------------------------ operações ------------------------------ */

/**
 * Dependências de infraestrutura do ciclo de vida, injetadas pelo
 * `PageService` (que as recebe do chamador ou do default de produção).
 */
export type PageLifecycleDeps = {
  database: PageDatabase;
  fileStore: PageFileStore;
  compiler: PageCompiler;
  mediaStorage: MediaStorage;
  /**
   * Regenera sitemap, robots, llms.txt e a home em `public/`, no mesmo diretório
   * do `fileStore` do Service. Injetado porque depende de Prisma.
   */
  regenerateArtifacts: () => Promise<void>;
};

/**
 * Operações que movem a página entre rascunho e no ar. Ordem comum a
 * Publish/Ativar/Desativar: efeito em disco primeiro, transação com guarda de
 * ponteiro depois, purge de CDN e artefatos por último; qualquer falha
 * restaura o arquivo anterior.
 */
export class PageLifecycle {
  constructor(private readonly deps: PageLifecycleDeps) {}

  private transaction<T>(
    callback: (tx: PageDatabase) => Promise<T>,
  ): Promise<T> {
    return this.deps.database.$transaction(callback) as Promise<T>;
  }

  /* ---- site público: reutilizado também pela remoção (lixeira) ---- */

  /** URL absoluta para purge; sem SiteSettings (teste) devolve o path puro. */
  async purgeUrl(path: string): Promise<string> {
    const { database } = this.deps;
    if (!database.siteSettings) return path;
    const settings = await database.siteSettings.findUnique({
      where: { id: "singleton" },
    });
    const origin = getPublicOrigin({ siteUrl: settings?.siteUrl });
    return `${origin}/${path.replace(/^\/+/, "")}`;
  }

  private async resolvePublicOriginOrNull(): Promise<string | null> {
    const { database } = this.deps;
    if (!database.siteSettings) {
      try {
        return getPublicOrigin();
      } catch {
        return null;
      }
    }
    const settings = await database.siteSettings.findUnique({
      where: { id: "singleton" },
    });
    try {
      return getPublicOrigin({ siteUrl: settings?.siteUrl });
    } catch {
      return null;
    }
  }

  /**
   * Block publish when HTML references /uploads paths that are missing,
   * still processing, or not READY. External absolute URLs are ignored.
   */
  async assertPublishableMediaReferences(content: string): Promise<void> {
    const { database, mediaStorage } = this.deps;
    const origin = await this.resolvePublicOriginOrNull();
    const refs = extractInternalUploadsFromHtml(content, origin);
    if (refs.length === 0) return;

    for (const ref of refs) {
      const label = `/uploads/${ref.mediaId}/${ref.fileName}`;
      const media = database.mediaFile
        ? await database.mediaFile.findUnique({
            where: { id: ref.mediaId },
          })
        : null;

      if (!media) {
        throw validationError(
          `Cannot publish: media ${label} was not found in the library`,
        );
      }
      if (media.fileName !== ref.fileName) {
        throw validationError(
          `Cannot publish: media ${label} does not match the stored file name`,
        );
      }
      if (media.processingStatus === "PROCESSING") {
        throw validationError(
          `Cannot publish: media ${label} is still processing`,
        );
      }
      if (media.processingStatus !== "READY") {
        throw validationError(
          `Cannot publish: media ${label} is not ready for public use`,
        );
      }

      const bytes = await mediaStorage.readPublic(ref.mediaId, ref.fileName);
      if (!bytes) {
        throw validationError(
          `Cannot publish: media ${label} is missing from public storage`,
        );
      }
    }
  }

  /** Regenera os artefatos públicos; sem SiteSettings (teste) não faz nada. */
  async refreshArtifacts(): Promise<void> {
    if (!this.deps.database.siteSettings) return;
    await this.deps.regenerateArtifacts();
  }

  /** Devolve o arquivo ao conteúdo anterior; `null` significa que não existia. */
  async restoreFile(slug: string, content: string | null): Promise<void> {
    if (content === null) {
      await this.deps.fileStore.remove(slug);
    } else {
      await this.deps.fileStore.write(slug, content);
    }
  }

  /* ---- revisões e estado rascunho/publicado ---- */

  /** RevisionService restrito às revisões de página (Custom Code não entra). */
  revisionsOf(database: PageDatabase): RevisionService {
    return revisionServiceFor("pageRevision", database, {
      fail: (code, message) => new PagesDomainError(code, message),
      unavailable: "Page revision store is unavailable",
      unused: "Snippet revisions are not used by Pages",
    });
  }

  /** Revisão no ar da página; sem ponteiro ou com ponteiro quebrado, null. */
  async loadPublished(
    database: PageDatabase,
    page: PageRecord,
  ): Promise<PageRevisionRecord | null> {
    if (!page.publishedRevisionId || !database.pageRevision) return null;
    try {
      return await this.revisionsOf(database).getPageRevisionForPage(
        page.publishedRevisionId,
        page.id,
      );
    } catch {
      return null;
    }
  }

  async withLifecycle(
    database: PageDatabase,
    page: PageRecord,
    extra: { activatedDuringPublish?: boolean } = {},
  ): Promise<PageWithLifecycle> {
    const published = await this.loadPublished(database, page);
    return attachPageLifecycle(
      page,
      published ? toPageSnapshot(published) : null,
      extra,
    );
  }

  /* ---- Save ---- */

  /**
   * Save: grava o rascunho e nunca fotografa nem publica. Sem mudança real no
   * snapshot não escreve nada nem audita. Painel e MCP entram por aqui.
   */
  async save(
    userId: string,
    parsed: UpdatePageInput,
    audit?: LogEventContext,
  ): Promise<PageWithLifecycle> {
    return this.saveDraft(userId, parsed, audit);
  }

  /**
   * Patch de conteúdo: confere o hash esperado, aplica as operações de busca e
   * troca sobre o conteúdo lido e grava pelo mesmo caminho do Save, então herda
   * a trava, o no-op (resultado idêntico não escreve nem audita) e o audit
   * `PAGE_UPDATED`. Altera só `content`; qualquer outro campo segue pelo Save.
   */
  async patchContent(
    userId: string,
    parsed: PatchPageInput,
    audit?: LogEventContext,
  ): Promise<PageWithLifecycle> {
    return this.saveDraft(
      userId,
      { id: parsed.id, expectedContentSha256: parsed.expectedContentSha256 },
      audit,
      parsed.operations,
    );
  }

  /**
   * Caminho único de gravação do rascunho. Ordem dentro da transação, que não
   * deve mudar: (1) trava a linha, antes de qualquer leitura, porque a leitura
   * que decide o conflito e a gravação precisam enxergar o mesmo estado
   * confirmado (a segunda transação espera aqui e lê o valor da vencedora) e
   * porque travar depois de inserir filho (revisão) pode dar deadlock com o
   * `FOR KEY SHARE` do FK; (2) lê a página; (3) confere a versão esperada,
   * em que `expectedContentSha256` vence `expectedUpdatedAt` (publicar, ativar
   * e desativar mudam o `updatedAt` sem mudar o conteúdo); (4) calcula o
   * snapshot seguinte, com o conteúdo vindo do patch quando `patch` existe, e
   * sai sem escrita se nada mudou; (5) grava e audita.
   */
  private async saveDraft(
    userId: string,
    parsed: UpdatePageInput,
    audit?: LogEventContext,
    patch?: readonly ContentPatchOperation[],
  ): Promise<PageWithLifecycle> {
    try {
      return await this.transaction(async (tx) => {
        await lockRowForUpdate(tx, "Page", parsed.id);
        const existing = await tx.page.findUnique({ where: { id: parsed.id } });
        if (!existing || existing.deletedAt) {
          throw pageNotFound();
        }
        assertPageExpectedVersion(
          {
            updatedAt: parsed.expectedUpdatedAt,
            contentSha256: parsed.expectedContentSha256,
          },
          existing,
        );

        const title = parsed.title ?? existing.title;
        let slug = existing.slug;
        if (parsed.slug !== undefined) {
          slug = await availableSlug(
            tx,
            parsed.slug || title,
            !parsed.slug,
            existing.id,
          );
        }

        if (parsed.folderId !== undefined) {
          const folder = await tx.pageFolder.findUnique({
            where: { id: parsed.folderId },
          });
          if (!folder) throw pageNotFound("Page folder was not found");
        }

        const nextSnapshot = {
          title,
          slug,
          content: patch
            ? applyPagePatch(existing.content, patch)
            : (parsed.content ?? existing.content),
          seoTitle:
            parsed.seoTitle !== undefined
              ? normalizeSeo(parsed.seoTitle)
              : existing.seoTitle,
          seoDescription:
            parsed.seoDescription !== undefined
              ? normalizeSeo(parsed.seoDescription)
              : existing.seoDescription,
          seoKeyword:
            parsed.seoKeyword !== undefined
              ? normalizeSeo(parsed.seoKeyword)
              : existing.seoKeyword,
          folderId: parsed.folderId ?? existing.folderId,
        };

        if (pageSnapshotsEqual(toPageSnapshot(existing), nextSnapshot)) {
          return this.withLifecycle(tx, existing);
        }

        // Versão só no Publish — Save grava o rascunho e não fotografa.
        const page = await tx.page.update({
          where: { id: existing.id },
          data: nextSnapshot,
        });
        await logEvent(tx, {
          userId,
          action: "PAGE_UPDATED",
          objectType: "PAGE",
          objectLabel: pageObjectLabel(page),
          objectId: page.id,
          ...audit,
        });
        return this.withLifecycle(tx, page);
      });
    } catch (error) {
      throw mapSlugConflict(error);
    }
  }

  /* ---- Restaurar versão ---- */

  /**
   * Copia a revisão para o rascunho. Ordem: conferir versão esperada,
   * sobrescrever os campos. Não fotografa o draft substituído. Nunca publica.
   *
   * ponytail: confere `expectedUpdatedAt` sem travar a linha (só o Save e o
   * Patch travam), então um Save concorrente ainda pode ser sobrescrito aqui;
   * travar como `saveDraft` se a restauração concorrente virar caso real.
   */
  async restoreRevision(
    userId: string,
    pageId: string,
    revisionId: string,
    expectedUpdatedAt: Date,
    audit?: LogEventContext,
  ): Promise<PageWithLifecycle> {
    try {
      return await this.transaction(async (tx) => {
        const existing = await tx.page.findUnique({ where: { id: pageId } });
        if (!existing || existing.deletedAt) throw pageNotFound();
        assertPageExpectedUpdatedAt(expectedUpdatedAt, existing.updatedAt);

        const target = await this.revisionsOf(tx).getPageRevisionForPage(
          revisionId,
          existing.id,
        );
        if (target.folderId !== existing.folderId) {
          const folder = await tx.pageFolder.findUnique({
            where: { id: target.folderId },
          });
          if (!folder) throw pageNotFound("Page folder was not found");
        }
        if (target.slug !== existing.slug) {
          await availableSlug(tx, target.slug, false, existing.id);
        }

        if (
          !pageSnapshotsEqual(toPageSnapshot(existing), toPageSnapshot(target))
        ) {
          const page = await tx.page.update({
            where: { id: existing.id },
            data: {
              title: target.title,
              slug: target.slug,
              content: target.content,
              seoTitle: target.seoTitle,
              seoDescription: target.seoDescription,
              seoKeyword: target.seoKeyword,
              folderId: target.folderId,
            },
          });
          await logEvent(tx, {
            userId,
            action: "PAGE_REVISION_RESTORED",
            objectType: "PAGE",
            objectLabel: pageObjectLabel(page),
            objectId: page.id,
            ...audit,
          });
          return this.withLifecycle(tx, page);
        }

        await logEvent(tx, {
          userId,
          action: "PAGE_REVISION_RESTORED",
          objectType: "PAGE",
          objectLabel: pageObjectLabel(existing),
          objectId: existing.id,
          ...audit,
        });
        return this.withLifecycle(tx, existing);
      });
    } catch (error) {
      throw mapSlugConflict(error);
    }
  }

  /* ---- Publish / Ativar / Desativar ---- */

  /**
   * Publish: fotografa o rascunho como revisão, liga o ponteiro e escreve o
   * HTML. `page` é o rascunho já carregado por `PageService.getPage`.
   */
  async publish(
    userId: string,
    page: PageWithLifecycle,
    audit?: LogEventContext,
  ): Promise<PageWithLifecycle> {
    const { compiler, fileStore } = this.deps;
    const published = await this.loadPublished(this.deps.database, page);
    if (
      published &&
      pageSnapshotsEqual(toPageSnapshot(page), toPageSnapshot(published))
    ) {
      throw new PagesDomainError(
        "INVALID_STATE",
        "Page has no unpublished changes",
      );
    }

    await this.assertPublishableMediaReferences(page.content);
    const compiled = await compiler({
      id: page.id,
      title: page.title,
      content: page.content,
      seoTitle: page.seoTitle,
      seoDescription: page.seoDescription,
      seoKeyword: page.seoKeyword,
    });

    const nextSlug = page.slug;
    const previousSlug = published?.slug;
    const previousNext = await fileStore.read(nextSlug);
    const previousLive =
      previousSlug && previousSlug !== nextSlug
        ? await fileStore.read(previousSlug)
        : null;

    await fileStore.write(nextSlug, compiled);
    try {
      if (previousSlug && previousSlug !== nextSlug) {
        await fileStore.remove(previousSlug);
      }

      const wasDeactivated =
        Boolean(page.publishedRevisionId) && page.status !== "PUBLISHED";
      const result = await this.transaction(async (tx) => {
        const current = await tx.page.findUnique({ where: { id: page.id } });
        if (!current || current.deletedAt) throw pageNotFound();
        if (
          !pageSnapshotsEqual(toPageSnapshot(current), toPageSnapshot(page))
        ) {
          throw new PagesDomainError(
            "CONFLICT",
            "Page was updated by another request",
          );
        }
        const persisted = await this.revisionsOf(tx).persistPageSnapshot({
          pageId: current.id,
          authorId: userId,
          snapshot: toPageSnapshot(current),
        });
        const updated = await tx.page.update({
          where: { id: current.id },
          data: {
            status: "PUBLISHED",
            publishedAt: new Date(),
            publishedRevisionId: persisted.revision.id,
          },
        });
        await logEvent(tx, {
          userId,
          action: "PAGE_PUBLISHED",
          objectType: "PAGE",
          objectLabel: pageObjectLabel(updated),
          objectId: updated.id,
          ...audit,
        });
        return this.withLifecycle(tx, updated, {
          activatedDuringPublish: wasDeactivated,
        });
      });

      await cloudflarePurge(await this.purgeUrl(nextSlug));
      if (previousSlug && previousSlug !== nextSlug) {
        await cloudflarePurge(await this.purgeUrl(previousSlug));
      }
      await this.refreshArtifacts().catch(() => undefined);
      return result;
    } catch (error) {
      await this.restoreFile(nextSlug, previousNext);
      if (previousSlug && previousSlug !== nextSlug) {
        await this.restoreFile(previousSlug, previousLive);
      }
      throw error;
    }
  }

  /**
   * Liga só a revisão já publicada. Recusa sem ponteiro; não lê o rascunho.
   */
  async activate(
    userId: string,
    page: PageWithLifecycle,
    audit?: LogEventContext,
  ): Promise<PageWithLifecycle> {
    const { compiler, fileStore, database } = this.deps;
    if (!page.publishedRevisionId) {
      throw new PagesDomainError(
        "INVALID_STATE",
        "Page has no published revision",
      );
    }
    if (page.status === "PUBLISHED") {
      return this.withLifecycle(database, page);
    }

    const revision = await this.revisionsOf(database).getPageRevisionForPage(
      page.publishedRevisionId,
      page.id,
    );
    await this.assertPublishableMediaReferences(revision.content);
    const compiled = await compiler({
      id: page.id,
      title: revision.title,
      content: revision.content,
      seoTitle: revision.seoTitle,
      seoDescription: revision.seoDescription,
      seoKeyword: revision.seoKeyword,
    });
    const previousContent = await fileStore.read(revision.slug);
    await fileStore.write(revision.slug, compiled);
    try {
      const updated = await this.transaction(async (tx) => {
        const current = await tx.page.findUnique({ where: { id: page.id } });
        if (!current || current.deletedAt) throw pageNotFound();
        assertPageActivatePointerUnchanged(
          current.publishedRevisionId ?? null,
          revision.id,
        );
        const result = await tx.page.update({
          where: { id: current.id },
          data: { status: "PUBLISHED" },
        });
        await logEvent(tx, {
          userId,
          action: "PAGE_PUBLISHED",
          objectType: "PAGE",
          objectLabel: pageObjectLabel(result),
          objectId: result.id,
          ...audit,
        });
        return this.withLifecycle(tx, result);
      });
      await cloudflarePurge(await this.purgeUrl(revision.slug));
      await this.refreshArtifacts().catch(() => undefined);
      return updated;
    } catch (error) {
      await this.restoreFile(revision.slug, previousContent);
      throw error;
    }
  }

  /**
   * Desativa: remove o HTML do ar mantendo a revisão publicada e o ponteiro,
   * para que Ativar religue exatamente a mesma versão.
   */
  async unpublish(
    userId: string,
    page: PageWithLifecycle,
    audit?: LogEventContext,
  ): Promise<PageWithLifecycle> {
    const { fileStore, database } = this.deps;
    const publishedRevisionId = page.publishedRevisionId;
    if (!publishedRevisionId) {
      throw new PagesDomainError(
        "INVALID_STATE",
        "Page has no published revision",
      );
    }
    if (page.status !== "PUBLISHED") {
      return this.withLifecycle(database, page);
    }

    const published = await this.loadPublished(database, page);
    const publicSlug = published?.slug ?? page.slug;
    const previousContent = await fileStore.read(publicSlug);
    await fileStore.remove(publicSlug);

    try {
      const unpublished = await this.transaction(async (tx) => {
        const current = await tx.page.findUnique({ where: { id: page.id } });
        if (!current || current.deletedAt) throw pageNotFound();
        assertPageUnpublishPointerUnchanged(
          current.publishedRevisionId ?? null,
          publishedRevisionId,
        );
        if (current.status !== "PUBLISHED") {
          return this.withLifecycle(tx, current);
        }
        const updated = await tx.page.update({
          where: { id: current.id },
          data: { status: "DRAFT" },
        });
        await logEvent(tx, {
          userId,
          action: "PAGE_UNPUBLISHED",
          objectType: "PAGE",
          objectLabel: pageObjectLabel(updated),
          objectId: updated.id,
          ...audit,
        });
        return this.withLifecycle(tx, updated);
      });
      await cloudflarePurge(await this.purgeUrl(publicSlug));
      await this.refreshArtifacts().catch(() => undefined);
      return unpublished;
    } catch (error) {
      await this.restoreFile(publicSlug, previousContent);
      throw error;
    }
  }
}
