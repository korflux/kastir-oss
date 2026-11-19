import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/Publishing/queue", () => ({
  TRACKED_JOB_RETENTION: { age: 3600, count: 1000 },
  getPublishingQueue: vi.fn(),
}));

import {
  CustomCodeService,
  extractSelectorCandidates,
} from "@/lib/Modules/CustomCode/Service";
import {
  MAX_SNIPPET_CONTENT_BYTES,
  SCOPE_PAGE_IDS_INVALID_MESSAGE,
  SCOPE_PAGE_IDS_MAX,
} from "@/lib/Modules/CustomCode/Schema";
import type { SnippetRecord } from "@/lib/Modules/CustomCode/Types";
import { snippetSnapshotFingerprint } from "@/lib/Modules/Revisions/snapshot";
import { contentSha256 } from "@/lib/Modules/Shared/ContentPatch";

/**
 * ids de página no formato cuid (`c` + 24 alfanuméricos): o schema do escopo recusa qualquer
 * outro formato, então os fixtures usam o mesmo formato do `Page.id` real.
 */
const pageCuid = (n: number) => `c${String(n).padStart(24, "0")}`;
const PAGE_1 = pageCuid(1);
const PAGE_2 = pageCuid(2);
const PAGE_3 = pageCuid(3);

type TestPage = {
  id: string;
  status: "DRAFT" | "PUBLISHED";
  deletedAt: Date | null;
  content?: string;
};

type SnippetWhere = {
  status?: SnippetRecord["status"];
  location?: SnippetRecord["location"];
  name?: { contains: string };
  deletedAt?: null | { not: null };
};

type PageWhere = {
  id?: { in: string[] };
  status?: TestPage["status"];
  deletedAt?: null;
};

function createQueue() {
  return {
    add: vi.fn((...args: unknown[]) => {
      void args;
      return Promise.resolve({ id: "job-id" });
    }),
  };
}

function createSnippet(
  id: string,
  overrides: Partial<SnippetRecord> = {},
): SnippetRecord {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id,
    name: `snippet-${id}`,
    location: "HEADER",
    content: "<script>window.example = true;</script>",
    status: "DRAFT",
    priority: null,
    scopeType: "SPECIFIC_PAGES",
    scopedPages: [],
    triggerType: null,
    triggerConfig: null,
    maxDisplays: null,
    displayResetDays: null,
    publishedRevisionId: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createDatabase(initial: SnippetRecord[] = []) {
  const snippets: SnippetRecord[] = initial.map((snippet) => ({
    ...snippet,
    scopedPages: [...(snippet.scopedPages ?? [])],
  }));
  const pages: TestPage[] = [
    { id: PAGE_1, status: "PUBLISHED", deletedAt: null },
    { id: PAGE_2, status: "PUBLISHED", deletedAt: null },
    { id: PAGE_3, status: "DRAFT", deletedAt: null },
  ];
  const logs: Array<{ action: string; objectLabel: string }> = [];
  let nextId = snippets.length + 1;

  const database = {
    snippet: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          snippets.find((snippet) => snippet.id === where.id) ?? null,
      ),
      findMany: vi.fn(
        async (args?: {
          where?: SnippetWhere;
          skip?: number;
          take?: number;
        }) => {
          let result = [...snippets];
          const where = args?.where ?? {};
          if (where.deletedAt === null) {
            result = result.filter((snippet) => snippet.deletedAt == null);
          } else if (where.deletedAt && typeof where.deletedAt === "object") {
            result = result.filter((snippet) => snippet.deletedAt != null);
          }
          if (where.status)
            result = result.filter(
              (snippet) => snippet.status === where.status,
            );
          if (where.location)
            result = result.filter(
              (snippet) => snippet.location === where.location,
            );
          const nameFilter = where.name?.contains;
          if (nameFilter) {
            result = result.filter((snippet) =>
              snippet.name.toLowerCase().includes(nameFilter.toLowerCase()),
            );
          }
          const skip = args?.skip ?? 0;
          return result.slice(
            skip,
            args?.take === undefined ? undefined : skip + args.take,
          );
        },
      ),
      count: vi.fn(async ({ where }: { where?: SnippetWhere } = {}) => {
        const result = await database.snippet.findMany({ where });
        return result.length;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const created = createSnippet(
          String(data.id ?? `snippet-${nextId++}`),
          {
            name: String(data.name),
            location: data.location as SnippetRecord["location"],
            content: String(data.content),
            status: (data.status as SnippetRecord["status"]) ?? "DRAFT",
            priority: (data.priority as number | null) ?? null,
            scopeType: data.scopeType as SnippetRecord["scopeType"],
            scopedPages: [],
            triggerType:
              (data.triggerType as SnippetRecord["triggerType"]) ?? null,
            triggerConfig:
              (data.triggerConfig as SnippetRecord["triggerConfig"]) ?? null,
            maxDisplays: (data.maxDisplays as number | null) ?? null,
            displayResetDays: (data.displayResetDays as number | null) ?? null,
            ...(data.updatedAt instanceof Date
              ? { updatedAt: data.updatedAt }
              : {}),
            ...(data.createdAt instanceof Date
              ? { createdAt: data.createdAt }
              : {}),
          },
        );
        snippets.push(created);
        return created;
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const snippet = snippets.find(
            (candidate) => candidate.id === where.id,
          );
          if (!snippet) throw new Error("missing snippet");
          Object.assign(snippet, data, { updatedAt: new Date() });
          return snippet;
        },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; status?: SnippetRecord["status"] };
          data: Record<string, unknown>;
        }) => {
          const snippet = snippets.find(
            (candidate) =>
              candidate.id === where.id &&
              (where.status === undefined || candidate.status === where.status),
          );
          if (!snippet) return { count: 0 };
          Object.assign(snippet, data, { updatedAt: new Date() });
          return { count: 1 };
        },
      ),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const index = snippets.findIndex((snippet) => snippet.id === where.id);
        if (index < 0) throw new Error("missing snippet");
        return snippets.splice(index, 1)[0];
      }),
    },
    snippetPageScope: {
      deleteMany: vi.fn(
        async ({
          where,
        }: {
          where: { snippetId?: string; pageId?: string };
        }) => {
          let count = 0;
          for (const snippet of snippets) {
            if (where.snippetId && snippet.id !== where.snippetId) continue;
            const before = snippet.scopedPages?.length ?? 0;
            snippet.scopedPages =
              snippet.scopedPages?.filter((scope) =>
                where.pageId ? scope.pageId !== where.pageId : false,
              ) ?? [];
            count += before - snippet.scopedPages.length;
          }
          return { count };
        },
      ),
      createMany: vi.fn(
        async ({
          data,
        }: {
          data: Array<{ snippetId: string; pageId: string }>;
        }) => {
          for (const row of data) {
            const snippet = snippets.find(
              (candidate) => candidate.id === row.snippetId,
            );
            if (snippet) snippet.scopedPages?.push({ pageId: row.pageId });
          }
          return { count: data.length };
        },
      ),
    },
    page: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          pages.find((page) => page.id === where.id) ?? null,
      ),
      findMany: vi.fn(async ({ where }: { where?: PageWhere } = {}) => {
        let result = [...pages];
        const pageIds = where?.id?.in;
        if (pageIds)
          result = result.filter((page) => pageIds.includes(page.id));
        if (where?.status)
          result = result.filter((page) => page.status === where.status);
        if (where?.deletedAt === null)
          result = result.filter((page) => page.deletedAt === null);
        return result;
      }),
      count: vi.fn(
        async ({ where }: { where?: PageWhere } = {}) =>
          (await database.page.findMany({ where })).length,
      ),
    },
    snippetRevision: (() => {
      const rows: Array<Record<string, unknown>> = [];
      return {
        findFirst: vi.fn(
          async ({
            where,
          }: {
            where: { snippetId?: string; fingerprint?: string };
          }) =>
            rows.find(
              (row) =>
                (!where.snippetId || row.snippetId === where.snippetId) &&
                (!where.fingerprint || row.fingerprint === where.fingerprint),
            ) ?? null,
        ),
        findUnique: vi.fn(
          async ({ where }: { where: { id: string } }) =>
            rows.find((row) => row.id === where.id) ?? null,
        ),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const row = {
            id: `srev-${rows.length + 1}`,
            pinned: false,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            ...data,
          };
          rows.push(row);
          return row;
        }),
      };
    })(),
    logEntry: {
      create: vi.fn(
        async ({ data }: { data: { action: string; objectLabel: string } }) => {
          logs.push(data);
          return { id: `log-${logs.length}` };
        },
      ),
    },
    // Trava de linha do Save: o banco falso só registra a chamada (concorrência real em
    // `tests/integration/snippets-save-lock.test.ts`).
    $queryRaw: vi.fn(async (...args: unknown[]) => {
      void args;
      return [];
    }),
    $transaction: vi.fn(async <T>(callback: (tx: unknown) => Promise<T>) =>
      callback(database),
    ),
  };

  const queue = createQueue();
  return { database, snippets, pages, logs, queue };
}

describe("CustomCodeService", () => {
  it("creates a scoped draft with deduplicated page relations", async () => {
    const { database, snippets } = createDatabase();
    const service = new CustomCodeService(
      database as never,
      createQueue() as never,
    );

    const created = await service.createSnippet("user-1", {
      name: "Analytics",
      location: "BODY_END",
      content: "<script>analytics();</script>",
      scopeType: "SPECIFIC_PAGES",
      pageIds: [PAGE_1, PAGE_1, PAGE_2],
    });

    expect(created.status).toBe("DRAFT");
    expect(created.scopedPages).toEqual([
      { pageId: PAGE_1 },
      { pageId: PAGE_2 },
    ]);
    expect(snippets).toHaveLength(1);
    expect(database.logEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "SCRIPT_CREATED" }),
      }),
    );
  });

  it("trims and collapses repeated page ids before they reach the scope relations", async () => {
    const { database } = createDatabase();
    const service = new CustomCodeService(
      database as never,
      createQueue() as never,
    );

    const created = await service.createSnippet("user-1", {
      name: "Analytics",
      location: "BODY_END",
      content: "<script>analytics();</script>",
      scopeType: "SPECIFIC_PAGES",
      pageIds: [` ${PAGE_2} `, PAGE_2, PAGE_1, `${PAGE_1}\n`],
    });

    expect(created.scopedPages).toEqual([
      { pageId: PAGE_2 },
      { pageId: PAGE_1 },
    ]);
  });

  it("refuses pageIds outside the contract with the fixed scope message, before touching the database", async () => {
    const source = createSnippet("snippet-1", {
      scopedPages: [{ pageId: PAGE_1 }],
    });
    const { database, snippets } = createDatabase([source]);
    const service = new CustomCodeService(
      database as never,
      createQueue() as never,
    );
    const valid = {
      name: "Analytics",
      location: "BODY_END",
      content: "<script>analytics();</script>",
      scopeType: "SPECIFIC_PAGES",
    };
    const hostile = "<img src=x onerror=alert(1)>";
    const overLimit = Array.from({ length: SCOPE_PAGE_IDS_MAX + 1 }, (_, i) =>
      pageCuid(i + 1),
    );

    for (const pageIds of [
      ["page-1"],
      [PAGE_1, hostile],
      [""],
      ["   "],
      overLimit,
      "not-an-array",
      [42],
    ]) {
      await expect(
        service.createSnippet("user-1", { ...valid, pageIds }),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        message: SCOPE_PAGE_IDS_INVALID_MESSAGE,
      });
      await expect(
        service.updateSnippet("user-1", { id: source.id, pageIds }),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        message: SCOPE_PAGE_IDS_INVALID_MESSAGE,
      });
    }

    // Recusa na borda: nem lookup de página nem transação, e o script existente segue igual.
    expect(database.page.findMany).not.toHaveBeenCalled();
    expect(database.$transaction).not.toHaveBeenCalled();
    expect(snippets).toHaveLength(1);
    expect(snippets[0]?.scopedPages).toEqual([{ pageId: PAGE_1 }]);
    // A mensagem é fixa: não carrega nenhum valor do payload.
    expect(SCOPE_PAGE_IDS_INVALID_MESSAGE).toContain(
      String(SCOPE_PAGE_IDS_MAX),
    );
    expect(SCOPE_PAGE_IDS_INVALID_MESSAGE).not.toMatch(/page-1|onerror/);
  });

  it("checks the scope refusal before the generic one, and keeps the generic message for other fields", async () => {
    const { database } = createDatabase();
    const service = new CustomCodeService(
      database as never,
      createQueue() as never,
    );
    const valid = {
      name: "Analytics",
      location: "BODY_END",
      content: "<script>analytics();</script>",
      scopeType: "SPECIFIC_PAGES",
    };

    // Campo inválido e escopo inválido juntos: vence a mensagem do escopo.
    await expect(
      service.createSnippet("user-1", {
        ...valid,
        name: "",
        pageIds: ["page-1"],
      }),
    ).rejects.toMatchObject({ message: SCOPE_PAGE_IDS_INVALID_MESSAGE });

    // Só outro campo inválido: segue o erro genérico.
    await expect(
      service.createSnippet("user-1", { ...valid, name: "", pageIds: [] }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Invalid snippet data",
    });
  });

  it("publishes, updates scope with the old/new union, and unpublishes", async () => {
    const source = createSnippet("snippet-1", {
      name: "Banner",
      status: "DRAFT",
      scopedPages: [{ pageId: PAGE_1 }],
    });
    const { database, queue, logs } = createDatabase([source]);
    const service = new CustomCodeService(database as never, queue as never);

    await service.publishSnippet("user-1", source.id);
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add.mock.calls[0]?.[1]).toEqual({
      type: "page-rebuild",
      pageId: PAGE_1,
    });
    expect(queue.add.mock.calls[1]?.[1]).toMatchObject({
      type: "settings-rebuild",
      scope: "ARTIFACTS",
    });

    queue.add.mockClear();
    await service.updateSnippet("user-1", {
      id: source.id,
      scopeType: "SPECIFIC_PAGES",
      pageIds: [PAGE_2, PAGE_3],
    });
    expect(queue.add).not.toHaveBeenCalled();

    queue.add.mockClear();
    await service.unpublishSnippet("user-1", source.id);
    expect(queue.add.mock.calls.map(([name]) => name)).toEqual([
      `page-rebuild-${PAGE_1}`,
      expect.stringMatching(/^settings-rebuild-/),
    ]);
    expect(logs.map((log) => log.action)).toEqual([
      "SCRIPT_PUBLISHED",
      "SCRIPT_UPDATED",
      "SCRIPT_UNPUBLISHED",
    ]);
  });

  it("normalizes all-pages scope without creating stale relations", async () => {
    const { database, snippets } = createDatabase();
    const service = new CustomCodeService(
      database as never,
      createQueue() as never,
    );

    const created = await service.createSnippet("user-1", {
      name: "Global",
      location: "HEADER",
      content: '<meta name="x" content="y">',
      scopeType: "ALL_PAGES",
      pageIds: [PAGE_1],
    });

    expect(created.scopedPages).toEqual([]);
    expect(snippets[0]?.scopeType).toBe("ALL_PAGES");
  });

  it("writes one source log while rebuilding hundreds of affected pages", async () => {
    const source = createSnippet("snippet-1", {
      name: "Global",
      scopeType: "ALL_PAGES",
    });
    const { database, pages, logs, queue } = createDatabase([source]);
    pages.push(
      ...Array.from({ length: 250 }, (_, index) => ({
        id: `page-extra-${index}`,
        status: "PUBLISHED" as const,
        deletedAt: null,
      })),
    );
    const service = new CustomCodeService(database as never, queue as never);

    await service.publishSnippet("user-1", source.id);

    expect(queue.add).toHaveBeenCalledTimes(253);
    expect(
      logs.filter((log) => log.action === "SCRIPT_PUBLISHED"),
    ).toHaveLength(1);
  });

  it("leaves scopeType/pageIds untouched when a partial update omits them", async () => {
    const source = createSnippet("snippet-1", {
      name: "Banner",
      scopeType: "SPECIFIC_PAGES",
      scopedPages: [{ pageId: PAGE_1 }],
    });
    const { database, snippets } = createDatabase([source]);
    const service = new CustomCodeService(
      database as never,
      createQueue() as never,
    );

    await service.updateSnippet("user-1", { id: source.id, name: "Banner v2" });

    expect(snippets[0]).toMatchObject({
      name: "Banner v2",
      scopeType: "SPECIFIC_PAGES",
      scopedPages: [{ pageId: PAGE_1 }],
    });
  });

  it("duplicates as a draft with a collision-safe copia name", async () => {
    const source = createSnippet("snippet-1", {
      name: "Banner",
      status: "PUBLISHED",
      scopedPages: [{ pageId: PAGE_1 }],
    });
    const copy = createSnippet("snippet-2", { name: "Banner-copia" });
    const { database } = createDatabase([source, copy]);
    const service = new CustomCodeService(
      database as never,
      createQueue() as never,
    );

    const duplicate = await service.duplicateSnippet("user-1", source.id);

    expect(duplicate).toMatchObject({
      name: "Banner-copia-2",
      status: "DRAFT",
      scopedPages: [{ pageId: PAGE_1 }],
    });
  });

  it("rejects malformed content at publish time", async () => {
    const source = createSnippet("snippet-1", { content: "<script>" });
    const { database, queue } = createDatabase([source]);
    const service = new CustomCodeService(database as never, queue as never);

    await expect(
      service.publishSnippet("user-1", source.id),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("saves malformed draft content without publishing or rebuilding", async () => {
    const source = createSnippet("snippet-1", {
      status: "PUBLISHED",
      content: "<script>ok();</script>",
      scopedPages: [{ pageId: PAGE_1 }],
    });
    const { database, queue, snippets } = createDatabase([source]);
    const service = new CustomCodeService(database as never, queue as never);

    const updated = await service.updateSnippet("user-1", {
      id: source.id,
      content: "<script>",
    });

    expect(snippets[0]!.content).toBe("<script>");
    expect(updated.hasUnpublishedChanges).toBe(true);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("requires MCP confirmation before changing live code or lifecycle", async () => {
    const published = createSnippet("snippet-1", {
      status: "PUBLISHED",
      scopedPages: [{ pageId: PAGE_1 }],
    });
    const draft = createSnippet("snippet-2", { status: "DRAFT" });
    const { database, queue, logs, snippets } = createDatabase([
      published,
      draft,
    ]);
    const service = new CustomCodeService(database as never, queue as never);
    const denied = {
      enforceConfirmation: true,
      confirmationApproved: false,
    } as const;

    const saved = await service.updateSnippet(
      "user-1",
      { id: published.id, content: "<script>newCode();</script>" },
      undefined,
      denied,
    );
    expect(saved.content).toBe("<script>newCode();</script>");
    expect(saved.hasUnpublishedChanges).toBe(true);
    await expect(
      service.publishSnippet("user-1", draft.id, undefined, denied),
    ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    await expect(
      service.publishSnippet("user-1", published.id, undefined, denied),
    ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    await expect(
      service.unpublishSnippet("user-1", published.id, undefined, denied),
    ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    await expect(
      service.unpublishSnippet("user-1", draft.id, undefined, denied),
    ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });

    expect(snippets).toMatchObject([
      {
        id: published.id,
        status: "PUBLISHED",
        content: "<script>newCode();</script>",
      },
      { id: draft.id, status: "DRAFT" },
    ]);
    expect(queue.add).not.toHaveBeenCalled();
    expect(logs.map((log) => log.action)).toEqual(["SCRIPT_UPDATED"]);
  });

  it("keeps metadata-only updates outside the live-code confirmation policy", async () => {
    const source = createSnippet("snippet-1", { status: "PUBLISHED" });
    const { database, snippets } = createDatabase([source]);
    const service = new CustomCodeService(
      database as never,
      createQueue() as never,
    );

    await service.updateSnippet(
      "user-1",
      { id: source.id, name: "Renamed live script" },
      undefined,
      { enforceConfirmation: true, confirmationApproved: false },
    );

    expect(snippets[0]).toMatchObject({
      name: "Renamed live script",
      status: "PUBLISHED",
    });
  });

  it("keeps a concurrent status flip from publishing the draft Save", async () => {
    const source = createSnippet("snippet-1", { status: "DRAFT" });
    const { database, snippets, queue } = createDatabase([source]);
    const service = new CustomCodeService(database as never, queue as never);

    const updated = await service.updateSnippet(
      "user-1",
      { id: source.id, content: "<script>live();</script>" },
      undefined,
      { enforceConfirmation: true, confirmationApproved: false },
    );

    expect(updated.hasUnpublishedChanges).toBe(true);
    expect(snippets[0]).toMatchObject({
      status: "DRAFT",
      content: "<script>live();</script>",
    });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("rolls published status back when rebuild enqueue fails", async () => {
    const source = createSnippet("snippet-1", {
      status: "DRAFT",
      content: "<script>ok();</script>",
      scopedPages: [{ pageId: PAGE_1 }],
    });
    const { database, queue, snippets } = createDatabase([source]);
    queue.add.mockRejectedValueOnce(new Error("redis down"));
    const service = new CustomCodeService(database as never, queue as never);

    await expect(
      service.publishSnippet("user-1", source.id),
    ).rejects.toMatchObject({
      code: "QUEUE_FAILED",
    });
    expect(snippets[0]?.status).toBe("DRAFT");
  });

  it("saves a published script without enqueueing a rebuild", async () => {
    const source = createSnippet("snippet-1", {
      name: "Banner",
      status: "PUBLISHED",
      content: "<script>old();</script>",
      scopedPages: [{ pageId: PAGE_1 }],
    });
    const { database, queue, snippets } = createDatabase([source]);
    queue.add.mockRejectedValueOnce(new Error("redis down"));
    const service = new CustomCodeService(database as never, queue as never);

    const updated = await service.updateSnippet("user-1", {
      id: source.id,
      content: "<script>new();</script>",
      pageIds: [PAGE_2],
      scopeType: "SPECIFIC_PAGES",
    });

    expect(updated.hasUnpublishedChanges).toBe(true);
    expect(snippets[0]).toMatchObject({
      name: "Banner",
      content: "<script>new();</script>",
      status: "PUBLISHED",
      scopeType: "SPECIFIC_PAGES",
      scopedPages: [{ pageId: PAGE_2 }],
    });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("defaults displayResetDays to 30 when maxDisplays is set without it", async () => {
    const { database, snippets } = createDatabase();
    const service = new CustomCodeService(
      database as never,
      createQueue() as never,
    );

    await service.createSnippet("user-1", {
      name: "Popup",
      location: "BODY_END",
      content: "<div>hi</div>",
      scopeType: "ALL_PAGES",
      pageIds: [],
      trigger: { triggerType: "PAGE_LOAD", triggerConfig: { delaySeconds: 5 } },
      maxDisplays: 3,
    });

    expect(snippets[0]).toMatchObject({ maxDisplays: 3, displayResetDays: 30 });
  });

  it("keeps an explicit displayResetDays instead of defaulting it", async () => {
    const { database, snippets } = createDatabase();
    const service = new CustomCodeService(
      database as never,
      createQueue() as never,
    );

    await service.createSnippet("user-1", {
      name: "Popup",
      location: "BODY_END",
      content: "<div>hi</div>",
      scopeType: "ALL_PAGES",
      pageIds: [],
      trigger: { triggerType: "SCROLL", triggerConfig: { percentage: 50 } },
      maxDisplays: 3,
      displayResetDays: 7,
    });

    expect(snippets[0]).toMatchObject({ maxDisplays: 3, displayResetDays: 7 });
  });

  it("rejects maxDisplays with no trigger, resolved against DB state on a partial update", async () => {
    const source = createSnippet("snippet-1", { triggerType: null });
    const { database } = createDatabase([source]);
    const service = new CustomCodeService(
      database as never,
      createQueue() as never,
    );

    await expect(
      service.updateSnippet("user-1", { id: source.id, maxDisplays: 5 }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("accepts maxDisplays alone on update when a trigger already exists in the DB", async () => {
    const source = createSnippet("snippet-1", {
      triggerType: "SCROLL",
      triggerConfig: { percentage: 50 },
    });
    const { database, snippets } = createDatabase([source]);
    const service = new CustomCodeService(
      database as never,
      createQueue() as never,
    );

    await service.updateSnippet("user-1", { id: source.id, maxDisplays: 4 });

    expect(snippets[0]).toMatchObject({
      triggerType: "SCROLL",
      maxDisplays: 4,
      displayResetDays: 30,
    });
  });

  it("clearing the trigger (trigger: null) also clears an existing maxDisplays cap", async () => {
    const source = createSnippet("snippet-1", {
      triggerType: "SCROLL",
      triggerConfig: { percentage: 50 },
      maxDisplays: 4,
      displayResetDays: 30,
    });
    const { database, snippets } = createDatabase([source]);
    const service = new CustomCodeService(
      database as never,
      createQueue() as never,
    );

    await service.updateSnippet("user-1", {
      id: source.id,
      trigger: null,
      maxDisplays: null,
    });

    expect(snippets[0]).toMatchObject({
      triggerType: null,
      triggerConfig: null,
      maxDisplays: null,
    });
  });

  it("marks a trigger-only change on a published snippet as compile-affecting", async () => {
    const source = createSnippet("snippet-1", {
      status: "PUBLISHED",
      scopedPages: [{ pageId: PAGE_1 }],
    });
    const { database, queue } = createDatabase([source]);
    const service = new CustomCodeService(database as never, queue as never);

    await service.updateSnippet("user-1", {
      id: source.id,
      trigger: { triggerType: "SCROLL", triggerConfig: { percentage: 50 } },
    });

    expect(queue.add).not.toHaveBeenCalled();
  });

  it("duplicates the trigger and display-cap fields along with the rest", async () => {
    const source = createSnippet("snippet-1", {
      name: "Banner",
      triggerType: "REFERRER",
      triggerConfig: { matches: "instagram.com" },
      maxDisplays: 2,
      displayResetDays: 14,
    });
    const copy = createSnippet("snippet-2", { name: "Banner-copia" });
    const { database } = createDatabase([source, copy]);
    const service = new CustomCodeService(
      database as never,
      createQueue() as never,
    );

    const duplicate = await service.duplicateSnippet("user-1", source.id);

    expect(duplicate).toMatchObject({
      triggerType: "REFERRER",
      triggerConfig: { matches: "instagram.com" },
      maxDisplays: 2,
      displayResetDays: 14,
    });
  });

  it("trash soft-deletes, hides from list, and unpublishes", async () => {
    const source = createSnippet("snippet-1", {
      status: "PUBLISHED",
      scopedPages: [{ pageId: PAGE_1 }],
    });
    const { database, snippets, queue } = createDatabase([source]);
    const service = new CustomCodeService(database as never, queue as never);

    const trashed = await service.trashSnippet("user-1", source.id);
    expect(trashed.deletedAt).toBeInstanceOf(Date);
    expect(trashed.status).toBe("DRAFT");
    expect(snippets[0]?.deletedAt).toBeInstanceOf(Date);

    const active = await service.listSnippets();
    expect(active.items.map((item) => item.id)).not.toContain(source.id);
    const trash = await service.listSnippets({ includeDeleted: true });
    expect(trash.items.map((item) => item.id)).toContain(source.id);

    await expect(service.getSnippet(source.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("restores from trash and permanently deletes only after trash", async () => {
    const source = createSnippet("snippet-1");
    const { database, snippets } = createDatabase([source]);
    const service = new CustomCodeService(
      database as never,
      createQueue() as never,
    );

    await expect(
      service.permanentlyDeleteSnippet("user-1", source.id, "MASTER"),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });

    await service.trashSnippet("user-1", source.id);
    await expect(
      service.permanentlyDeleteSnippet("user-1", source.id, "EDITOR"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const restored = await service.restoreSnippet("user-1", source.id);
    expect(restored.deletedAt).toBeNull();
    expect(snippets[0]?.deletedAt).toBeNull();

    await service.trashSnippet("user-1", source.id);
    await service.permanentlyDeleteSnippet("user-1", source.id, "ADMIN");
    expect(
      snippets.find((snippet) => snippet.id === source.id),
    ).toBeUndefined();
  });

  it("expires trashed snippets past the retention window", async () => {
    const source = createSnippet("snippet-1", {
      deletedAt: new Date("2020-01-01T00:00:00.000Z"),
      status: "DRAFT",
    });
    const { database, snippets } = createDatabase([source]);
    const service = new CustomCodeService(
      database as never,
      createQueue() as never,
    );

    const expired = await service.expireTrashedSnippets(
      new Date("2026-01-01T00:00:00.000Z"),
    );
    expect(expired).toBe(1);
    expect(
      snippets.find((snippet) => snippet.id === source.id),
    ).toBeUndefined();
  });

  it("rejects the expire job when a trashed snippet cannot be hard-deleted", async () => {
    const source = createSnippet("snippet-1", {
      deletedAt: new Date("2020-01-01T00:00:00.000Z"),
      status: "DRAFT",
    });
    const { database } = createDatabase([source]);
    database.snippet.delete = vi.fn(async () => {
      throw new Error("fk constraint");
    });
    const service = new CustomCodeService(
      database as never,
      createQueue() as never,
    );

    await expect(
      service.expireTrashedSnippets(new Date("2026-01-01T00:00:00.000Z")),
    ).rejects.toThrow(/1 failure/);
  });
});

describe("extractSelectorCandidates", () => {
  it("prioritizes clickable elements over the rest, regardless of document order", () => {
    const html = `
      <div id="hero" class="banner"></div>
      <button id="buy" class="cta">Buy now</button>
    `;
    expect(extractSelectorCandidates(html)).toEqual([
      "#buy",
      ".cta",
      "#hero",
      ".banner",
    ]);
  });

  it("recognizes input[type=submit|button], [role=button] and [onclick] as clickable", () => {
    const html = `
      <input id="submit-btn" type="submit">
      <span id="fake-button" role="button">Go</span>
      <div id="onclick-div" onclick="doThing()"></div>
      <p id="plain">text</p>
    `;
    const result = extractSelectorCandidates(html);
    expect(result.slice(0, 3)).toEqual([
      "#submit-btn",
      "#fake-button",
      "#onclick-div",
    ]);
    expect(result).toContain("#plain");
  });

  it("dedupes ids and repeated classes, keeping first occurrence only", () => {
    const html = `
      <div id="a" class="foo bar"></div>
      <div id="b" class="foo baz"></div>
    `;
    expect(extractSelectorCandidates(html)).toEqual([
      "#a",
      ".foo",
      ".bar",
      "#b",
      ".baz",
    ]);
  });

  it("returns an empty list for HTML with no id or class", () => {
    expect(
      extractSelectorCandidates("<h1>Hello</h1><p>No selectors here.</p>"),
    ).toEqual([]);
  });
});

describe("CustomCodeService.getScopeSelectors", () => {
  it("aggregates and dedupes selector candidates across only the pages in SPECIFIC_PAGES scope", async () => {
    const source = createSnippet("snippet-1", {
      scopeType: "SPECIFIC_PAGES",
      scopedPages: [{ pageId: PAGE_1 }, { pageId: PAGE_2 }],
    });
    const { database, pages } = createDatabase([source]);
    pages.find((page) => page.id === PAGE_1)!.content =
      '<button id="buy" class="cta">Buy</button>';
    pages.find((page) => page.id === PAGE_2)!.content =
      '<div id="hero" class="cta"></div>';
    pages.find((page) => page.id === PAGE_3)!.content =
      '<div id="not-in-scope"></div>';
    const service = new CustomCodeService(
      database as never,
      createQueue() as never,
    );

    const selectors = await service.getScopeSelectors(source.id);

    expect(selectors).toEqual(["#buy", ".cta", "#hero"]);
    expect(selectors).not.toContain("#not-in-scope");
  });

  it("returns an empty list when the scope has no pages", async () => {
    const source = createSnippet("snippet-1", {
      scopeType: "SPECIFIC_PAGES",
      scopedPages: [],
    });
    const { database } = createDatabase([source]);
    const service = new CustomCodeService(
      database as never,
      createQueue() as never,
    );

    expect(await service.getScopeSelectors(source.id)).toEqual([]);
  });

  it("reads every non-deleted page site-wide for ALL_PAGES scope", async () => {
    const source = createSnippet("snippet-1", { scopeType: "ALL_PAGES" });
    const { database, pages } = createDatabase([source]);
    pages.find((page) => page.id === PAGE_1)!.content =
      '<button id="buy"></button>';
    pages.find((page) => page.id === PAGE_3)!.content =
      '<div id="draft-page"></div>';
    const service = new CustomCodeService(
      database as never,
      createQueue() as never,
    );

    expect(await service.getScopeSelectors(source.id)).toEqual([
      "#buy",
      "#draft-page",
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* patchSnippetContent: busca e troca exata pelo serviço, gravada pelo Save    */
/* -------------------------------------------------------------------------- */

describe("CustomCodeService.patchSnippetContent", () => {
  type PatchOperations = Array<{ old: string; new: string }>;

  function setup(content: string, overrides: Partial<SnippetRecord> = {}) {
    const fixture = createDatabase([
      createSnippet("snip-1", { content, ...overrides }),
    ]);
    const service = new CustomCodeService(
      fixture.database as never,
      createQueue() as never,
    );
    /** Patch com o hash do conteúdo lido, como o agente faz depois de ler o script. */
    const patch = (operations: PatchOperations) =>
      service.patchSnippetContent("user-1", {
        id: "snip-1",
        expectedContentSha256: contentSha256(content),
        operations,
      });
    return { ...fixture, service, patch };
  }

  /** Nada gravado, nada auditado, linha intacta: o contrato de toda recusa do patch. */
  function expectUntouched(
    fixture: ReturnType<typeof setup>,
    content: string,
    updatedAt: Date,
  ) {
    expect(fixture.snippets[0]!.content).toBe(content);
    expect(fixture.snippets[0]!.updatedAt).toBe(updatedAt);
    expect(fixture.database.snippet.update).not.toHaveBeenCalled();
    expect(fixture.database.logEntry.create).not.toHaveBeenCalled();
  }

  it("A1: replaces only the matched excerpt, saves through the locked Save and audits SCRIPT_UPDATED", async () => {
    const source = "fill:#111;fill:#222";
    const fixture = setup(source, {
      name: "Palette",
      scopeType: "SPECIFIC_PAGES",
      scopedPages: [{ pageId: PAGE_1 }],
    });
    const { database, snippets, patch } = fixture;

    const saved = await patch([{ old: "#111", new: "#0A0" }]);

    expect(snippets[0]!.content).toBe("fill:#0A0;fill:#222");
    expect(saved.content).toBe("fill:#0A0;fill:#222");
    // O patch altera só `content`.
    expect(snippets[0]).toMatchObject({
      name: "Palette",
      location: "HEADER",
      scopeType: "SPECIFIC_PAGES",
      scopedPages: [{ pageId: PAGE_1 }],
    });
    expect(database.$queryRaw).toHaveBeenCalledTimes(1);
    expect(database.logEntry.create).toHaveBeenCalledTimes(1);
    expect(database.logEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "SCRIPT_UPDATED",
          objectId: "snip-1",
        }),
      }),
    );
    // A18: o fingerprint segue a fórmula do snapshot, não o hash do conteúdo.
    expect(saved.draftFingerprint).toBe(
      snippetSnapshotFingerprint({
        name: "Palette",
        location: "HEADER",
        content: "fill:#0A0;fill:#222",
        priority: null,
        scopeType: "SPECIFIC_PAGES",
        pageIds: [PAGE_1],
        triggerType: null,
        triggerConfig: null,
        maxDisplays: null,
        displayResetDays: null,
      }),
    );
    expect(saved.draftFingerprint).not.toBe(
      contentSha256("fill:#0A0;fill:#222"),
    );
  });

  it.each<[string, string, PatchOperations, string]>([
    ["replaces one match", "AB", [{ old: "A", new: "X" }], "XB"],
    [
      "applies operations in sequence, the second on the result of the first",
      "AB",
      [
        { old: "A", new: "B" },
        { old: "BB", new: "C" },
      ],
      "C",
    ],
    [
      "matches CRLF exactly",
      "<p>\r\n</p>",
      [{ old: "<p>\r\n</p>", new: "<p></p>" }],
      "<p></p>",
    ],
    [
      "A17: keeps CRLF and trailing spaces outside the excerpt byte for byte",
      "a\r\nb  \r\n",
      [{ old: "a\r\nb", new: "c" }],
      "c  \r\n",
    ],
    [
      "replaces a character outside the BMP as a whole",
      "🚀 x",
      [{ old: "🚀", new: "✅" }],
      "✅ x",
    ],
    [
      "does not read $& or $1 in `new` as a replacement pattern",
      "price: X",
      [{ old: "X", new: "$& $1 $$" }],
      "price: $& $1 $$",
    ],
  ])("patch (A2 table): %s", async (_name, source, operations, expected) => {
    const { snippets, patch } = setup(source);

    await patch(operations);

    expect(snippets[0]!.content).toBe(expected);
  });

  it.each<[string, string, PatchOperations, string]>([
    [
      "second operation with no match",
      "AB",
      [
        { old: "A", new: "X" },
        { old: "Z", new: "Y" },
      ],
      "Operation 1: old text occurs 0 times",
    ],
    [
      "repeated match",
      "a b a",
      [{ old: "a", new: "x" }],
      "Operation 0: old text occurs 2 times",
    ],
    [
      "overlapping match counts as repeated",
      "aaa",
      [{ old: "aa", new: "b" }],
      "Operation 0: old text occurs 2 times",
    ],
    [
      "LF does not match CRLF",
      "<p>\r\n</p>",
      [{ old: "<p>\n</p>", new: "<p></p>" }],
      "Operation 0: old text occurs 0 times",
    ],
    [
      "unpaired surrogate in old",
      "🚀 x",
      [{ old: "\ud83d", new: "y" }],
      "Operation 0: old and new text must not contain an unpaired surrogate",
    ],
  ])(
    "patch (A2 table): refuses %s with VALIDATION_ERROR and the operation index, writing and auditing nothing",
    async (_name, source, operations, message) => {
      const fixture = setup(source);
      const updatedAt = fixture.snippets[0]!.updatedAt;

      await expect(fixture.patch(operations)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        message: expect.stringContaining(message),
      });

      expectUntouched(fixture, source, updatedAt);
      // Recusa antes da transação: nem trava, nem leitura travada.
      expect(fixture.database.$transaction).not.toHaveBeenCalled();
    },
  );

  it("patch (A2 table): a result identical to the content ends without a write, an audit or a new updatedAt", async () => {
    const fixture = setup("AB");
    const updatedAt = fixture.snippets[0]!.updatedAt;

    const result = await fixture.patch([{ old: "A", new: "A" }]);

    expect(result.content).toBe("AB");
    expectUntouched(fixture, "AB", updatedAt);
  });

  it("A5: refuses a stale hash with CONFLICT and the current hash, before judging the operations", async () => {
    const fixture = setup("v1");
    const staleHash = contentSha256("v1");
    fixture.snippets[0]!.content = "v2 from another session";
    const updatedAt = fixture.snippets[0]!.updatedAt;

    // `old` inexistente no conteúdo atual: a versão vem antes das operações.
    await expect(
      fixture.service.patchSnippetContent("user-1", {
        id: "snip-1",
        expectedContentSha256: staleHash,
        operations: [{ old: "v1", new: "v3" }],
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining(
        `current contentSha256: ${contentSha256("v2 from another session")}`,
      ),
    });

    expectUntouched(fixture, "v2 from another session", updatedAt);
  });

  it("A5: refuses with CONFLICT when the content changes after the patch was computed, because the locked row is checked again", async () => {
    const fixture = setup("fill:#111;fill:#222");
    const { database, snippets, patch } = fixture;
    const innerTransaction = database.$transaction.getMockImplementation()!;
    database.$transaction.mockImplementationOnce(async (callback) => {
      // Outra sessão grava entre o patch ser calculado e a transação travar a linha.
      snippets[0]!.content = "fill:#111;fill:#999";
      return innerTransaction(callback);
    });
    const updatedAt = snippets[0]!.updatedAt;

    await expect(patch([{ old: "#111", new: "#0A0" }])).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining(
        `current contentSha256: ${contentSha256("fill:#111;fill:#999")}`,
      ),
    });

    expectUntouched(fixture, "fill:#111;fill:#999", updatedAt);
  });

  it("A10: refuses a result above the byte limit citing it, and accepts exactly the limit", async () => {
    const atLimit = `x${"a".repeat(MAX_SNIPPET_CONTENT_BYTES - 1)}`;
    const fixture = setup(atLimit);
    const updatedAt = fixture.snippets[0]!.updatedAt;

    // Primeiro valor recusado: 1 byte acima do limite.
    await expect(
      fixture.patch([{ old: "x", new: "xx" }]),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining(String(MAX_SNIPPET_CONTENT_BYTES)),
    });
    expectUntouched(fixture, atLimit, updatedAt);

    // O próprio limite passa.
    await fixture.patch([{ old: "x", new: "y" }]);
    expect(fixture.snippets[0]!.content).toBe(
      `y${"a".repeat(MAX_SNIPPET_CONTENT_BYTES - 1)}`,
    );
  });

  it("refuses malformed input at the boundary, touching nothing, and accepts exactly 50 operations", async () => {
    const source = Array.from({ length: 51 }, (_, i) => `[${i}]`).join("");
    const fixture = setup(source);
    const { database, service } = fixture;
    const hash = contentSha256(source);
    const operation = { old: "[0]", new: "<0>" };

    for (const input of [
      // 51 operações
      {
        id: "snip-1",
        expectedContentSha256: hash,
        operations: Array.from({ length: 51 }, (_, i) => ({
          old: `[${i}]`,
          new: "",
        })),
      },
      // nenhuma operação
      { id: "snip-1", expectedContentSha256: hash, operations: [] },
      // old vazio
      {
        id: "snip-1",
        expectedContentSha256: hash,
        operations: [{ old: "", new: "x" }],
      },
      // campo fora da allowlist, na operação e na entrada
      {
        id: "snip-1",
        expectedContentSha256: hash,
        operations: [{ ...operation, regex: true }],
      },
      {
        id: "snip-1",
        expectedContentSha256: hash,
        operations: [operation],
        name: "other",
      },
      // hash ausente e hash que não tem 64 hexadecimais
      { id: "snip-1", operations: [operation] },
      {
        id: "snip-1",
        expectedContentSha256: hash.slice(1),
        operations: [operation],
      },
      // tipos errados
      { id: "snip-1", expectedContentSha256: hash, operations: "x" },
      {
        id: "snip-1",
        expectedContentSha256: hash,
        operations: [{ old: 1, new: 2 }],
      },
    ]) {
      await expect(
        service.patchSnippetContent("user-1", input),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        message: "Invalid snippet data",
      });
    }
    expect(database.snippet.findUnique).not.toHaveBeenCalled();
    expect(database.$transaction).not.toHaveBeenCalled();
    expect(fixture.snippets[0]!.content).toBe(source);

    // O limite de quantidade: 50 passa (as 50 primeiras marcas).
    await service.patchSnippetContent("user-1", {
      id: "snip-1",
      expectedContentSha256: hash,
      operations: Array.from({ length: 50 }, (_, i) => ({
        old: `[${i}]`,
        new: `<${i}>`,
      })),
    });
    expect(fixture.snippets[0]!.content).toBe(
      `${Array.from({ length: 50 }, (_, i) => `<${i}>`).join("")}[50]`,
    );
  });

  it("answers NOT_FOUND for a missing or trashed script, without a transaction", async () => {
    const fixture = setup("AB", {
      deletedAt: new Date("2026-01-02T00:00:00Z"),
    });
    const { database, service } = fixture;
    const hash = contentSha256("AB");

    for (const id of ["snip-1", "unknown"]) {
      await expect(
        service.patchSnippetContent("user-1", {
          id,
          expectedContentSha256: hash,
          operations: [{ old: "A", new: "X" }],
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect(database.$transaction).not.toHaveBeenCalled();
    expect(database.snippet.update).not.toHaveBeenCalled();
  });
});
