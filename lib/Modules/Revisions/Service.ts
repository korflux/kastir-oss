/**
 * Persistência de snapshots: um adaptador tipado por recurso, sem update
 * de conteúdo (imutável) e sem tipo polimórfico vindo da entrada.
 */
import { compareRevisionText } from "@/lib/Modules/Revisions/diff";
import { REVISION_PIN_MAX } from "@/lib/Modules/Settings/revisionRetention";
import {
  MAX_REVISION_PAGE_SIZE,
  parsePageSnapshot,
  parseSnippetSnapshot,
} from "@/lib/Modules/Revisions/Schema";
import {
  pageSnapshotFingerprint,
  snippetSnapshotFingerprint,
} from "@/lib/Modules/Revisions/snapshot";
import {
  RevisionsDomainError,
  type PageRevisionListItem,
  type PageRevisionRecord,
  type PageSnapshot,
  type PersistPageSnapshotInput,
  type PersistRevisionResult,
  type PersistSnippetSnapshotInput,
  type RevisionDiffTarget,
  type RevisionListResult,
  type SnippetRevisionListItem,
  type SnippetRevisionRecord,
  type SnippetSnapshot,
} from "@/lib/Modules/Revisions/Types";

type PageRevisionStore = {
  findFirst(args: {
    where: { pageId: string; fingerprint: string };
  }): Promise<PageRevisionRecord | null>;
  findUnique(args: {
    where: { id: string };
  }): Promise<PageRevisionRecord | null>;
  findMany?(args: {
    where: { pageId: string };
    orderBy?: { createdAt: "desc" };
    skip?: number;
    take?: number;
    include?: { author: { select: { name: true } } };
  }): Promise<Array<PageRevisionRecord & { author?: { name: string } | null }>>;
  count?(args: {
    where: { pageId: string; pinned?: boolean };
  }): Promise<number>;
  create(args: {
    data: PageSnapshot & {
      pageId: string;
      authorId: string;
      fingerprint: string;
    };
  }): Promise<PageRevisionRecord>;
  update?(args: {
    where: { id: string };
    data: { pinned: boolean };
  }): Promise<PageRevisionRecord>;
};

type SnippetRevisionStore = {
  findFirst(args: {
    where: { snippetId: string; fingerprint: string };
  }): Promise<SnippetRevisionRecord | null>;
  findUnique(args: {
    where: { id: string };
  }): Promise<SnippetRevisionRecord | null>;
  findMany?(args: {
    where: { snippetId: string };
    orderBy?: { createdAt: "desc" };
    skip?: number;
    take?: number;
    include?: { author: { select: { name: true } } };
  }): Promise<
    Array<SnippetRevisionRecord & { author?: { name: string } | null }>
  >;
  count?(args: {
    where: { snippetId: string; pinned?: boolean };
  }): Promise<number>;
  create(args: {
    data: SnippetSnapshot & {
      snippetId: string;
      authorId: string;
      fingerprint: string;
    };
  }): Promise<SnippetRevisionRecord>;
  update?(args: {
    where: { id: string };
    data: { pinned: boolean };
  }): Promise<SnippetRevisionRecord>;
};

export type RevisionDatabase = {
  pageRevision: PageRevisionStore;
  snippetRevision: SnippetRevisionStore;
  /** Pin count+update precisa serializar; sem isso o 4º pin passa em corrida. */
  $transaction?<T>(
    callback: (tx: RevisionDatabase) => Promise<T>,
    options?: { isolationLevel?: "Serializable" },
  ): Promise<T>;
};

function invalidSnapshot(): never {
  throw new RevisionsDomainError("VALIDATION_ERROR", "Invalid revision");
}

function missingRevision(): never {
  throw new RevisionsDomainError("NOT_FOUND", "Revision was not found");
}

export class RevisionService {
  constructor(private readonly database: RevisionDatabase) {}

  async persistPageSnapshot(
    input: PersistPageSnapshotInput,
  ): Promise<PersistRevisionResult<PageRevisionRecord>> {
    const parsed = parsePageSnapshot(input.snapshot);
    if (!parsed.success) invalidSnapshot();
    const fingerprint = pageSnapshotFingerprint(parsed.data);
    const existing = await this.database.pageRevision.findFirst({
      where: { pageId: input.pageId, fingerprint },
    });
    if (existing) return { revision: existing, reused: true };
    const revision = await this.database.pageRevision.create({
      data: {
        pageId: input.pageId,
        authorId: input.authorId,
        fingerprint,
        ...parsed.data,
      },
    });
    return { revision, reused: false };
  }

  async persistSnippetSnapshot(
    input: PersistSnippetSnapshotInput,
  ): Promise<PersistRevisionResult<SnippetRevisionRecord>> {
    const parsed = parseSnippetSnapshot(input.snapshot);
    if (!parsed.success) invalidSnapshot();
    const fingerprint = snippetSnapshotFingerprint(parsed.data);
    const existing = await this.database.snippetRevision.findFirst({
      where: { snippetId: input.snippetId, fingerprint },
    });
    if (existing) return { revision: existing, reused: true };
    const revision = await this.database.snippetRevision.create({
      data: {
        snippetId: input.snippetId,
        authorId: input.authorId,
        fingerprint,
        ...parsed.data,
      },
    });
    return { revision, reused: false };
  }

  /** Leitura escopada: revisão de outra página é NOT_FOUND, sem vazar o payload. */
  async getPageRevisionForPage(
    revisionId: string,
    pageId: string,
  ): Promise<PageRevisionRecord> {
    const revision = await this.database.pageRevision.findUnique({
      where: { id: revisionId },
    });
    if (!revision || revision.pageId !== pageId) missingRevision();
    return revision;
  }

  async getSnippetRevisionForSnippet(
    revisionId: string,
    snippetId: string,
  ): Promise<SnippetRevisionRecord> {
    const revision = await this.database.snippetRevision.findUnique({
      where: { id: revisionId },
    });
    if (!revision || revision.snippetId !== snippetId) missingRevision();
    return revision;
  }

  async listPageRevisions(input: {
    pageId: string;
    publishedRevisionId: string | null;
    page: number;
    pageSize: number;
  }): Promise<RevisionListResult<PageRevisionListItem>> {
    assertListBounds(input.page, input.pageSize);
    const store = this.database.pageRevision;
    if (!store.findMany || !store.count) {
      throw new RevisionsDomainError("VALIDATION_ERROR", "Invalid revision");
    }
    const where = { pageId: input.pageId };
    const skip = (input.page - 1) * input.pageSize;
    const [rows, total] = await Promise.all([
      store.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: input.pageSize,
        include: { author: { select: { name: true } } },
      }),
      store.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        pageId: row.pageId,
        authorId: row.authorId,
        authorName: revisionAuthorName(row),
        fingerprint: row.fingerprint,
        pinned: row.pinned,
        createdAt: row.createdAt,
        title: row.title,
        slug: row.slug,
        published: row.id === input.publishedRevisionId,
      })),
      total,
      page: input.page,
      pageSize: input.pageSize,
    };
  }

  async listSnippetRevisions(input: {
    snippetId: string;
    publishedRevisionId: string | null;
    page: number;
    pageSize: number;
  }): Promise<RevisionListResult<SnippetRevisionListItem>> {
    assertListBounds(input.page, input.pageSize);
    const store = this.database.snippetRevision;
    if (!store.findMany || !store.count) {
      throw new RevisionsDomainError("VALIDATION_ERROR", "Invalid revision");
    }
    const where = { snippetId: input.snippetId };
    const skip = (input.page - 1) * input.pageSize;
    const [rows, total] = await Promise.all([
      store.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: input.pageSize,
        include: { author: { select: { name: true } } },
      }),
      store.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        snippetId: row.snippetId,
        authorId: row.authorId,
        authorName: revisionAuthorName(row),
        fingerprint: row.fingerprint,
        pinned: row.pinned,
        createdAt: row.createdAt,
        name: row.name,
        published: row.id === input.publishedRevisionId,
      })),
      total,
      page: input.page,
      pageSize: input.pageSize,
    };
  }

  async diffPageRevision(input: {
    pageId: string;
    fromRevisionId: string;
    to: RevisionDiffTarget;
  }): Promise<{ lines: ReturnType<typeof compareRevisionText> }> {
    const from = await this.getPageRevisionForPage(
      input.fromRevisionId,
      input.pageId,
    );
    const toSnapshot =
      input.to.kind === "draft"
        ? parseOrThrowPage(input.to.snapshot)
        : await this.getPageRevisionForPage(input.to.revisionId, input.pageId);
    return {
      lines: compareRevisionText(from.content, toSnapshot.content),
    };
  }

  async diffSnippetRevision(input: {
    snippetId: string;
    fromRevisionId: string;
    to: RevisionDiffTarget;
  }): Promise<{ lines: ReturnType<typeof compareRevisionText> }> {
    const from = await this.getSnippetRevisionForSnippet(
      input.fromRevisionId,
      input.snippetId,
    );
    const toSnapshot =
      input.to.kind === "draft"
        ? parseOrThrowSnippet(input.to.snapshot)
        : await this.getSnippetRevisionForSnippet(
            input.to.revisionId,
            input.snippetId,
          );
    return {
      lines: compareRevisionText(from.content, toSnapshot.content),
    };
  }

  /**
   * Só o flag de fixação muda. Conteúdo permanece imutável; o teto de 3
   * impede retenção sem limite via pin.
   */
  async setPageRevisionPinned(input: {
    pageId: string;
    revisionId: string;
    pinned: boolean;
  }): Promise<PageRevisionRecord> {
    const revision = await this.getPageRevisionForPage(
      input.revisionId,
      input.pageId,
    );
    return this.applyPin(
      this.database.pageRevision,
      revision,
      { pageId: input.pageId },
      input.pinned,
    );
  }

  async setSnippetRevisionPinned(input: {
    snippetId: string;
    revisionId: string;
    pinned: boolean;
  }): Promise<SnippetRevisionRecord> {
    const revision = await this.getSnippetRevisionForSnippet(
      input.revisionId,
      input.snippetId,
    );
    return this.applyPin(
      this.database.snippetRevision,
      revision,
      { snippetId: input.snippetId },
      input.pinned,
    );
  }

  private async applyPin<
    TRevision extends { id: string; pinned: boolean },
    TWhere extends { pageId: string } | { snippetId: string },
  >(
    store: {
      count?(args: { where: TWhere & { pinned?: boolean } }): Promise<number>;
      update?(args: {
        where: { id: string };
        data: { pinned: boolean };
      }): Promise<TRevision>;
    },
    revision: TRevision,
    owner: TWhere,
    pinned: boolean,
  ): Promise<TRevision> {
    if (revision.pinned === pinned) return revision;
    const run = async (active: typeof store): Promise<TRevision> => {
      if (!active.count || !active.update) {
        throw new RevisionsDomainError("VALIDATION_ERROR", "Invalid revision");
      }
      if (pinned) {
        const pinnedCount = await active.count({
          where: { ...owner, pinned: true },
        });
        if (pinnedCount >= REVISION_PIN_MAX) {
          throw new RevisionsDomainError(
            "VALIDATION_ERROR",
            "Revision pin limit reached",
          );
        }
      }
      return active.update({
        where: { id: revision.id },
        data: { pinned },
      });
    };

    if (!this.database.$transaction) return run(store);
    return this.database.$transaction(
      (tx) => {
        const active = "pageId" in owner ? tx.pageRevision : tx.snippetRevision;
        return run(active as typeof store);
      },
      { isolationLevel: "Serializable" },
    );
  }
}

function assertListBounds(page: number, pageSize: number): void {
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > MAX_REVISION_PAGE_SIZE
  ) {
    throw new RevisionsDomainError("VALIDATION_ERROR", "Invalid revision");
  }
}

function parseOrThrowPage(snapshot: unknown): PageSnapshot {
  const parsed = parsePageSnapshot(snapshot);
  if (!parsed.success) invalidSnapshot();
  return parsed.data;
}

function parseOrThrowSnippet(snapshot: unknown): SnippetSnapshot {
  const parsed = parseSnippetSnapshot(snapshot);
  if (!parsed.success) invalidSnapshot();
  return parsed.data;
}

function revisionAuthorName(row: {
  author?: { name: string } | null;
}): string | undefined {
  const name = row.author?.name?.trim();
  return name ? name : undefined;
}
