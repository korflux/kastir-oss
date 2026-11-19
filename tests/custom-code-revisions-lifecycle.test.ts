import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/Publishing/queue", () => ({
  TRACKED_JOB_RETENTION: { age: 3600, count: 1000 },
  getPublishingQueue: vi.fn(),
}));

import { CustomCodeService } from "@/lib/Modules/CustomCode/Service";
import type { SnippetRecord } from "@/lib/Modules/CustomCode/Types";
import { snippetSnapshotFingerprint } from "@/lib/Modules/Revisions/snapshot";
import type { SnippetSnapshot } from "@/lib/Modules/Revisions/Types";
import { contentSha256 } from "@/lib/Modules/Shared/ContentPatch";

/**
 * ids de página no formato cuid (`c` + 24 alfanuméricos): o schema do escopo recusa qualquer
 * outro formato, então os fixtures usam o mesmo formato do `Page.id` real.
 */
const pageCuid = (n: number) => `c${String(n).padStart(24, "0")}`;
const PAGE_1 = pageCuid(1);
const PAGE_2 = pageCuid(2);

function createSnippet(
  id: string,
  overrides: Partial<SnippetRecord> = {},
): SnippetRecord {
  const now = new Date("2026-08-13T12:00:00.000Z");
  return {
    id,
    name: `snippet-${id}`,
    location: "HEADER",
    content: "<script>window.example = true;</script>",
    status: "DRAFT",
    priority: null,
    scopeType: "SPECIFIC_PAGES",
    scopedPages: [{ pageId: PAGE_1 }],
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

function revisionSnapshotOf(snippet: SnippetRecord): SnippetSnapshot {
  return {
    name: snippet.name,
    location: snippet.location,
    content: snippet.content,
    priority: snippet.priority,
    scopeType: snippet.scopeType,
    pageIds: snippet.scopedPages?.map((scope) => scope.pageId) ?? [],
    triggerType: snippet.triggerType,
    triggerConfig: snippet.triggerConfig,
    maxDisplays: snippet.maxDisplays,
    displayResetDays: snippet.displayResetDays,
  };
}

function createLifecycleDatabase(initial: SnippetRecord[] = []) {
  const snippets = initial.map((snippet) => ({
    ...snippet,
    scopedPages: [...(snippet.scopedPages ?? [])],
  }));
  const pages = [
    { id: PAGE_1, status: "PUBLISHED" as const, deletedAt: null },
    { id: PAGE_2, status: "PUBLISHED" as const, deletedAt: null },
  ];
  const revisions: Array<
    SnippetSnapshot & {
      id: string;
      snippetId: string;
      authorId: string;
      fingerprint: string;
      pinned: boolean;
      createdAt: Date;
    }
  > = [];
  let nextRevision = 1;
  // `add(name, data, options)` do BullMQ: o mock só tipa o nome do job, único
  // argumento que os testes inspecionam em `mock.calls`.
  const queue = {
    add: vi.fn<(name: string) => Promise<{ id: string }>>(async () => ({
      id: "job-id",
    })),
  };

  const database = {
    snippet: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          snippets.find((snippet) => snippet.id === where.id) ?? null,
      ),
      findMany: vi.fn(async () => snippets),
      count: vi.fn(async () => snippets.length),
      create: vi.fn(),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const snippet = snippets.find((row) => row.id === where.id);
          if (!snippet) throw new Error("missing snippet");
          Object.assign(snippet, data, { updatedAt: new Date() });
          return snippet;
        },
      ),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    snippetPageScope: {
      deleteMany: vi.fn(
        async ({ where }: { where: { snippetId?: string } }) => {
          const snippet = snippets.find((row) => row.id === where.snippetId);
          const count = snippet?.scopedPages?.length ?? 0;
          if (snippet) snippet.scopedPages = [];
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
            const snippet = snippets.find((item) => item.id === row.snippetId);
            snippet?.scopedPages?.push({ pageId: row.pageId });
          }
          return { count: data.length };
        },
      ),
    },
    snippetRevision: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { snippetId?: string; fingerprint?: string };
        }) =>
          revisions.find(
            (row) =>
              (!where.snippetId || row.snippetId === where.snippetId) &&
              (!where.fingerprint || row.fingerprint === where.fingerprint),
          ) ?? null,
      ),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          revisions.find((row) => row.id === where.id) ?? null,
      ),
      create: vi.fn(
        async ({
          data,
        }: {
          data: SnippetSnapshot & {
            snippetId: string;
            authorId: string;
            fingerprint: string;
          };
        }) => {
          const row = {
            id: `srev-${nextRevision++}`,
            pinned: false,
            createdAt: new Date("2026-08-13T12:00:00.000Z"),
            ...data,
          };
          revisions.push(row);
          return row;
        },
      ),
      count: vi.fn(
        async ({
          where,
        }: {
          where: { snippetId?: string; pinned?: boolean };
        }) =>
          revisions.filter(
            (row) =>
              (!where.snippetId || row.snippetId === where.snippetId) &&
              (where.pinned === undefined || row.pinned === where.pinned),
          ).length,
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { pinned: boolean };
        }) => {
          const row = revisions.find((candidate) => candidate.id === where.id);
          if (!row) throw new Error("missing revision");
          row.pinned = data.pinned;
          return row;
        },
      ),
    },
    page: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          pages.find((page) => page.id === where.id) ?? null,
      ),
      findMany: vi.fn(
        async ({
          where,
        }: {
          where?: { id?: { in: string[] }; status?: string; deletedAt?: null };
        } = {}) => {
          let result = [...pages];
          if (where?.id?.in)
            result = result.filter((page) => where.id!.in.includes(page.id));
          if (where?.status)
            result = result.filter((page) => page.status === where.status);
          if (where?.deletedAt === null)
            result = result.filter((page) => page.deletedAt === null);
          return result;
        },
      ),
    },
    logEntry: { create: vi.fn(async () => ({ id: "log-id" })) },
    // Trava de linha do Save (`lockRowForUpdate`): o banco falso não tem concorrência real, então
    // a trava só registra a chamada; a serialização de verdade é provada em
    // `tests/integration/snippets-save-lock.test.ts`.
    $queryRaw: vi.fn(async (...args: unknown[]) => {
      void args;
      return [];
    }),
    $transaction: vi.fn(
      async <T>(callback: (tx: typeof database) => Promise<T>) =>
        callback(database),
    ),
  };

  return { database, snippets, revisions, queue };
}

describe("CustomCodeService Save draft-only", () => {
  it("updates the draft without creating a revision or rebuilding", async () => {
    const { database, snippets, revisions, queue } = createLifecycleDatabase([
      createSnippet("snip-1"),
    ]);
    const service = new CustomCodeService(database as never, queue as never);

    const updated = await service.updateSnippet("user-1", {
      id: "snip-1",
      content: "<script>window.changed = true;</script>",
    });

    expect(snippets[0]!.content).toBe(
      "<script>window.changed = true;</script>",
    );
    expect(revisions).toHaveLength(0);
    expect(database.snippetRevision.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
    expect(updated.hasUnpublishedChanges).toBe(true);
    expect(updated.activated).toBe(false);
  });

  it("does not create a revision on a no-op Save", async () => {
    const source = createSnippet("snip-1");
    const { database, revisions, queue } = createLifecycleDatabase([source]);
    const service = new CustomCodeService(database as never, queue as never);

    await service.updateSnippet("user-1", {
      id: "snip-1",
      name: source.name,
      content: source.content,
    });

    expect(revisions).toHaveLength(0);
    expect(database.snippet.update).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("does not create a revision on Save even when a snapshot already exists", async () => {
    const source = createSnippet("snip-1");
    const { database, revisions } = createLifecycleDatabase([source]);
    const previous = revisionSnapshotOf(source);
    revisions.push({
      id: "srev-existing",
      snippetId: "snip-1",
      authorId: "other",
      fingerprint: snippetSnapshotFingerprint(previous),
      pinned: false,
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      ...previous,
    });
    const service = new CustomCodeService(
      database as never,
      { add: vi.fn() } as never,
    );

    await service.updateSnippet("user-1", {
      id: "snip-1",
      content: "<script>window.next = true;</script>",
    });

    expect(revisions).toHaveLength(1);
    expect(database.snippetRevision.create).not.toHaveBeenCalled();
  });
});

describe("CustomCodeService Publish and Ativado/Desativado", () => {
  it("publishes by materializing the draft and only then enqueueing rebuilds", async () => {
    const { database, snippets, revisions, queue } = createLifecycleDatabase([
      createSnippet("snip-1"),
    ]);
    const service = new CustomCodeService(database as never, queue as never);

    const published = await service.publishSnippet("user-1", "snip-1");

    expect(revisions).toHaveLength(1);
    expect(snippets[0]).toMatchObject({
      status: "PUBLISHED",
      publishedRevisionId: revisions[0]!.id,
    });
    expect(queue.add).toHaveBeenCalled();
    expect(published.activated).toBe(true);
    expect(published.hasUnpublishedChanges).toBe(false);
    expect(published.activatedDuringPublish).toBe(false);
  });

  it("keeps public rebuilds intact after Save and updates them after Publish", async () => {
    const { database, snippets, revisions, queue } = createLifecycleDatabase([
      createSnippet("snip-1"),
    ]);
    const service = new CustomCodeService(database as never, queue as never);

    await service.publishSnippet("user-1", "snip-1");
    queue.add.mockClear();
    await service.updateSnippet("user-1", {
      id: "snip-1",
      content: "<script>window.next = true;</script>",
    });
    expect(queue.add).not.toHaveBeenCalled();
    expect(revisions).toHaveLength(1);

    await service.publishSnippet("user-1", "snip-1");
    expect(queue.add).toHaveBeenCalled();
    expect(revisions).toHaveLength(2);
    expect(snippets[0]!.publishedRevisionId).toBe(revisions[1]!.id);
  });

  it("refuses Publish when the draft already matches the live revision", async () => {
    const source = createSnippet("snip-1");
    const { database, queue } = createLifecycleDatabase([source]);
    const service = new CustomCodeService(database as never, queue as never);
    await service.publishSnippet("user-1", "snip-1");
    queue.add.mockClear();

    await expect(
      service.publishSnippet("user-1", "snip-1"),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("activates a deactivated script on Publish and signals the toast", async () => {
    const { database, snippets, queue } = createLifecycleDatabase([
      createSnippet("snip-1"),
    ]);
    const service = new CustomCodeService(database as never, queue as never);
    await service.publishSnippet("user-1", "snip-1");
    await service.unpublishSnippet("user-1", "snip-1");
    await service.updateSnippet("user-1", {
      id: "snip-1",
      content: "<script>window.after = true;</script>",
    });

    const published = await service.publishSnippet("user-1", "snip-1");
    expect(snippets[0]!.status).toBe("PUBLISHED");
    expect(published.activatedDuringPublish).toBe(true);
  });

  it("does not confirm pointer or status when rebuild enqueue fails", async () => {
    const { database, snippets, queue } = createLifecycleDatabase([
      createSnippet("snip-1"),
    ]);
    queue.add.mockRejectedValueOnce(new Error("redis down"));
    const service = new CustomCodeService(database as never, queue as never);

    await expect(
      service.publishSnippet("user-1", "snip-1"),
    ).rejects.toMatchObject({ code: "QUEUE_FAILED" });
    expect(snippets[0]!.status).toBe("DRAFT");
    expect(snippets[0]!.publishedRevisionId).toBeNull();
  });

  it("keeps publishedRevisionId when deactivating and activates only the pointer", async () => {
    const { database, snippets, queue } = createLifecycleDatabase([
      createSnippet("snip-1"),
    ]);
    const service = new CustomCodeService(database as never, queue as never);
    await service.publishSnippet("user-1", "snip-1");
    const liveId = snippets[0]!.publishedRevisionId;
    await service.updateSnippet("user-1", {
      id: "snip-1",
      content: "<script>window.dirty = true;</script>",
      pageIds: [PAGE_2],
    });
    queue.add.mockClear();

    await service.unpublishSnippet("user-1", "snip-1");
    expect(snippets[0]!.status).toBe("DRAFT");
    expect(snippets[0]!.publishedRevisionId).toBe(liveId);
    expect(queue.add.mock.calls.map(([name]) => name)).toEqual([
      `page-rebuild-${PAGE_1}`,
      expect.stringMatching(/^settings-rebuild-/),
    ]);

    queue.add.mockClear();
    await service.activateSnippet("user-1", "snip-1");
    expect(snippets[0]!.status).toBe("PUBLISHED");
    expect(snippets[0]!.publishedRevisionId).toBe(liveId);
    expect(snippets[0]!.content).toBe("<script>window.dirty = true;</script>");
    expect(queue.add.mock.calls.map(([name]) => name)).toEqual([
      `page-rebuild-${PAGE_1}`,
      expect.stringMatching(/^settings-rebuild-/),
    ]);
  });

  it("leaves Ativado inert when the script was never published", async () => {
    const source = createSnippet("snip-1");
    const { database, queue } = createLifecycleDatabase([source]);
    const service = new CustomCodeService(database as never, queue as never);

    await expect(
      service.activateSnippet("user-1", "snip-1"),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(
      service.unpublishSnippet("user-1", "snip-1"),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("rejects activate when another publish moves the pointer before the tx", async () => {
    const { database, snippets, queue } = createLifecycleDatabase([
      createSnippet("snip-1"),
    ]);
    const service = new CustomCodeService(database as never, queue as never);
    await service.publishSnippet("user-1", "snip-1");
    const compiledPointer = snippets[0]!.publishedRevisionId;
    await service.unpublishSnippet("user-1", "snip-1");
    queue.add.mockClear();

    const innerTransaction = database.$transaction.getMockImplementation()!;
    database.$transaction.mockImplementationOnce(async (callback) => {
      snippets[0]!.publishedRevisionId = "rev-from-concurrent-publish";
      return innerTransaction(callback);
    });

    await expect(
      service.activateSnippet("user-1", "snip-1"),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(snippets[0]!.status).toBe("DRAFT");
    expect(snippets[0]!.publishedRevisionId).toBe(
      "rev-from-concurrent-publish",
    );
    expect(queue.add).not.toHaveBeenCalled();
    expect(compiledPointer).toBeTruthy();
  });

  it("rejects unpublish when the pointer moved before the tx", async () => {
    const { database, snippets, queue } = createLifecycleDatabase([
      createSnippet("snip-1"),
    ]);
    const service = new CustomCodeService(database as never, queue as never);
    await service.publishSnippet("user-1", "snip-1");
    queue.add.mockClear();

    const innerTransaction = database.$transaction.getMockImplementation()!;
    database.$transaction.mockImplementationOnce(async (callback) => {
      snippets[0]!.publishedRevisionId = "rev-from-concurrent-publish";
      return innerTransaction(callback);
    });

    await expect(
      service.unpublishSnippet("user-1", "snip-1"),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(snippets[0]!.status).toBe("PUBLISHED");
    expect(snippets[0]!.publishedRevisionId).toBe(
      "rev-from-concurrent-publish",
    );
    expect(queue.add).not.toHaveBeenCalled();
  });
});

describe("CustomCodeService Restore and pin", () => {
  it("restores a published snippet revision without creating another snapshot", async () => {
    const { database, snippets, revisions, queue } = createLifecycleDatabase([
      createSnippet("snip-1"),
    ]);
    const service = new CustomCodeService(database as never, queue as never);

    await service.publishSnippet("user-1", "snip-1");
    const liveId = revisions[0]!.id;
    queue.add.mockClear();
    await service.updateSnippet("user-1", {
      id: "snip-1",
      content: "<script>window.changed = true;</script>",
    });
    const expectedUpdatedAt = snippets[0]!.updatedAt;

    const restored = await service.restoreSnippetRevision(
      "user-1",
      "snip-1",
      liveId,
      expectedUpdatedAt,
    );

    expect(snippets[0]!.content).toBe(
      "<script>window.example = true;</script>",
    );
    expect(revisions).toHaveLength(1);
    expect(database.snippetRevision.create).toHaveBeenCalledTimes(1);
    expect(restored.hasUnpublishedChanges).toBe(false);
    expect(snippets[0]!.publishedRevisionId).toBe(liveId);
    expect(queue.add).not.toHaveBeenCalled();
    expect(database.logEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "SCRIPT_REVISION_RESTORED",
          objectType: "SCRIPT",
          objectId: "snip-1",
          objectLabel: expect.not.stringMatching(/<script>/),
        }),
      }),
    );
  });

  it("rejects a concurrent snippet restore without losing the newer draft", async () => {
    const { database, snippets, revisions, queue } = createLifecycleDatabase([
      createSnippet("snip-1"),
    ]);
    const service = new CustomCodeService(database as never, queue as never);
    await service.publishSnippet("user-1", "snip-1");
    queue.add.mockClear();
    snippets[0]!.content = "<script>window.newer = true;</script>";
    snippets[0]!.updatedAt = new Date("2026-08-13T16:00:00.000Z");

    await expect(
      service.restoreSnippetRevision(
        "user-1",
        "snip-1",
        revisions[0]!.id,
        new Date("2026-08-13T12:00:00.000Z"),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(snippets[0]!.content).toBe("<script>window.newer = true;</script>");
    expect(revisions).toHaveLength(1);
    expect(queue.add).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------------- */
/* Save: trava de linha, versão por hash do conteúdo e snapshot da linha lida */
/* ------------------------------------------------------------------------- */

describe("CustomCodeService Save com trava de linha e versão por hash", () => {
  const OLD_CONTENT = "<script>window.example = true;</script>";
  const NEW_CONTENT = "<script>window.changed = true;</script>";
  type LifecycleDatabase = ReturnType<
    typeof createLifecycleDatabase
  >["database"];

  /**
   * Reproduz a corrida: "outra sessão" grava entre o pedido chegar e a transação do Save
   * começar, e a transação passa a enxergar a linha já alterada (a mesma técnica dos testes de
   * ponteiro de Ativar e Desativar acima).
   */
  function changeBeforeNextTransaction(
    database: LifecycleDatabase,
    change: () => void,
  ) {
    const innerTransaction = database.$transaction.getMockImplementation()!;
    database.$transaction.mockImplementationOnce(async (callback) => {
      change();
      return innerTransaction(callback);
    });
  }

  function setup(overrides: Partial<SnippetRecord> = {}) {
    const fixture = createLifecycleDatabase([
      createSnippet("snip-1", { content: OLD_CONTENT, ...overrides }),
    ]);
    const service = new CustomCodeService(
      fixture.database as never,
      fixture.queue as never,
    );
    return { ...fixture, service };
  }

  it("A8: locks the Snippet row with the id as a bound parameter before any read of it", async () => {
    const { database, service } = setup();

    await service.updateSnippet("user-1", {
      id: "snip-1",
      content: NEW_CONTENT,
    });

    expect(database.$queryRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = database.$queryRaw.mock
      .calls[0] as unknown as [TemplateStringsArray, ...unknown[]];
    expect(strings.join("$")).toContain('FROM "Snippet"');
    expect(strings.join("$")).toContain("FOR UPDATE");
    expect(values).toEqual(["snip-1"]);

    // Trava antes de ler: a leitura que alimenta a guarda e o snapshot só pode vir depois dela.
    const lockedAt = database.$queryRaw.mock.invocationCallOrder[0]!;
    const readsAt = database.snippet.findUnique.mock.invocationCallOrder;
    expect(readsAt.length).toBeGreaterThan(0);
    for (const readAt of readsAt) expect(readAt).toBeGreaterThan(lockedAt);
    expect(
      database.snippet.update.mock.invocationCallOrder[0]!,
    ).toBeGreaterThan(lockedAt);
  });

  it.each([
    [
      "name",
      (row: SnippetRecord) => {
        row.name = "renamed elsewhere";
      },
      (row: SnippetRecord) => expect(row.name).toBe("renamed elsewhere"),
    ],
    [
      "scope",
      (row: SnippetRecord) => {
        row.scopedPages = [{ pageId: PAGE_2 }];
      },
      (row: SnippetRecord) =>
        expect(row.scopedPages).toEqual([{ pageId: PAGE_2 }]),
    ],
    [
      "trigger",
      (row: SnippetRecord) => {
        row.triggerType = "PAGE_LOAD";
        row.triggerConfig = { delaySeconds: 5 };
        row.maxDisplays = 3;
        row.displayResetDays = 7;
      },
      (row: SnippetRecord) =>
        expect(row).toMatchObject({
          triggerType: "PAGE_LOAD",
          triggerConfig: { delaySeconds: 5 },
          maxDisplays: 3,
          displayResetDays: 7,
        }),
    ],
  ])(
    "A8: a content Save by hash does not overwrite the %s changed after the request arrived",
    async (_field, change, expectKept) => {
      const { database, snippets, service } = setup();
      changeBeforeNextTransaction(database, () => {
        change(snippets[0]!);
        // O que outra gravação faria; com conferência só pelo hash, a data não protege.
        snippets[0]!.updatedAt = new Date("2026-08-13T13:00:00.000Z");
      });

      const saved = await service.updateSnippet("user-1", {
        id: "snip-1",
        content: NEW_CONTENT,
        expectedContentSha256: contentSha256(OLD_CONTENT),
      });

      expect(snippets[0]!.content).toBe(NEW_CONTENT);
      expectKept(snippets[0]!);
      // A resposta descreve o que ficou gravado, não o que o `existing` antigo dizia.
      expectKept(saved);
      expect(database.snippetPageScope.deleteMany).not.toHaveBeenCalled();
    },
  );

  it("A5: refuses a stale content hash with the current hash in the message and writes nothing", async () => {
    const { database, snippets, service } = setup();
    const staleHash = contentSha256(OLD_CONTENT);
    snippets[0]!.content = "<script>window.other = true;</script>";
    const currentHash = contentSha256(snippets[0]!.content);
    const updatedAtBefore = snippets[0]!.updatedAt;

    for (const stale of [
      // só o hash
      { expectedContentSha256: staleHash },
      // hash prevalece sobre uma data que confere
      {
        expectedContentSha256: staleHash,
        expectedUpdatedAt: updatedAtBefore.toISOString(),
      },
      // hash em maiúsculas é o mesmo hash
      { expectedContentSha256: staleHash.toUpperCase() },
    ]) {
      await expect(
        service.updateSnippet("user-1", {
          id: "snip-1",
          content: NEW_CONTENT,
          ...stale,
        }),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message: expect.stringContaining("was updated by another request"),
      });
      await expect(
        service.updateSnippet("user-1", {
          id: "snip-1",
          content: NEW_CONTENT,
          ...stale,
        }),
      ).rejects.toThrow(currentHash);
    }

    expect(snippets[0]!.content).toBe("<script>window.other = true;</script>");
    expect(snippets[0]!.updatedAt).toBe(updatedAtBefore);
    expect(database.snippet.update).not.toHaveBeenCalled();
    expect(database.logEntry.create).not.toHaveBeenCalled();
  });

  it("A9: the content hash wins over a stale expectedUpdatedAt, which a publish moves without changing the content", async () => {
    const { snippets, service } = setup();
    const readAt = snippets[0]!.updatedAt;
    await service.publishSnippet("user-1", "snip-1");
    expect(snippets[0]!.updatedAt.getTime()).not.toBe(readAt.getTime());

    // Sem hash, a data antiga continua recusando (comportamento de hoje).
    await expect(
      service.updateSnippet("user-1", {
        id: "snip-1",
        content: NEW_CONTENT,
        expectedUpdatedAt: readAt.toISOString(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // Com o hash do conteúdo lido, a gravação passa mesmo com a data antiga.
    await service.updateSnippet("user-1", {
      id: "snip-1",
      content: NEW_CONTENT,
      expectedUpdatedAt: readAt.toISOString(),
      expectedContentSha256: contentSha256(OLD_CONTENT),
    });
    expect(snippets[0]!.content).toBe(NEW_CONTENT);
  });

  it("refuses an expectedContentSha256 that is not 64 hexadecimal characters before opening a transaction", async () => {
    const { database, snippets, service } = setup();

    for (const expectedContentSha256 of [
      "",
      "abc",
      `${contentSha256(OLD_CONTENT)}0`,
      `${contentSha256(OLD_CONTENT).slice(1)}g`,
    ]) {
      await expect(
        service.updateSnippet("user-1", {
          id: "snip-1",
          content: NEW_CONTENT,
          expectedContentSha256,
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    }

    expect(database.$transaction).not.toHaveBeenCalled();
    expect(snippets[0]!.content).toBe(OLD_CONTENT);
  });

  it("runs the no-op check inside the locked transaction: no write, no audit, and a stale hash still conflicts", async () => {
    const { database, snippets, service } = setup();
    const updatedAtBefore = snippets[0]!.updatedAt;

    const result = await service.updateSnippet("user-1", {
      id: "snip-1",
      content: OLD_CONTENT,
      expectedContentSha256: contentSha256(OLD_CONTENT),
    });

    expect(result.content).toBe(OLD_CONTENT);
    expect(database.$transaction).toHaveBeenCalledTimes(1);
    expect(database.$queryRaw).toHaveBeenCalledTimes(1);
    expect(database.snippet.update).not.toHaveBeenCalled();
    expect(database.logEntry.create).not.toHaveBeenCalled();
    expect(snippets[0]!.updatedAt).toBe(updatedAtBefore);

    // O no-op decidido sobre a linha travada: conteúdo mudou depois da leitura, o no-op não vale.
    snippets[0]!.content = "<script>window.other = true;</script>";
    await expect(
      service.updateSnippet("user-1", {
        id: "snip-1",
        content: "<script>window.other = true;</script>",
        expectedContentSha256: contentSha256(OLD_CONTENT),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(database.snippet.update).not.toHaveBeenCalled();
  });

  it("A17: stores the full content byte for byte, CRLF and trailing spaces included", async () => {
    const { snippets, service } = setup();
    const sent = "<script>\r\nwindow.a = 1;  \r\n\t</script>  \r\n";

    await service.updateSnippet("user-1", { id: "snip-1", content: sent });

    expect(snippets[0]!.content).toBe(sent);
    expect(
      Buffer.from(snippets[0]!.content, "utf8").equals(Buffer.from(sent)),
    ).toBe(true);
  });

  it("A18: keeps draftFingerprint as the SHA-256 of the current snapshot formula after a Save", async () => {
    const { snippets, service } = setup({
      scopedPages: [{ pageId: PAGE_2 }, { pageId: PAGE_1 }],
    });

    const saved = await service.updateSnippet("user-1", {
      id: "snip-1",
      content: NEW_CONTENT,
      expectedContentSha256: contentSha256(OLD_CONTENT),
    });

    const row = snippets[0]!;
    // Fórmula escrita por extenso, independente de `snippetSnapshotFingerprint`: se alguém
    // mexer nela (campo, ordem, hash do conteúdo no meio), a deduplicação de revisões quebra.
    const expected = createHash("sha256")
      .update(
        JSON.stringify({
          name: row.name,
          location: row.location,
          content: row.content,
          priority: row.priority,
          scopeType: row.scopeType,
          pageIds: [PAGE_1, PAGE_2],
          triggerType: row.triggerType,
          triggerConfig: row.triggerConfig,
          maxDisplays: row.maxDisplays,
          displayResetDays: row.displayResetDays,
        }),
      )
      .digest("hex");
    expect(saved.draftFingerprint).toBe(expected);
    expect(saved.draftFingerprint).toBe(
      snippetSnapshotFingerprint(revisionSnapshotOf(row)),
    );
  });
});
