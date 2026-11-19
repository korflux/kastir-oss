import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { onHomePageRemoved } from "@/lib/SideEffects/onHomePageRemoved";
import { onPageRemovedFromScope } from "@/lib/SideEffects/onPageRemovedFromScope";

function pageContext(
  overrides: Partial<Parameters<typeof onPageRemovedFromScope>[0]> = {},
) {
  return {
    pageId: "page-id",
    title: "Landing",
    slug: "landing",
    snippetIds: ["snippet-id"],
    isHome: false,
    actorId: "master-id",
    ...overrides,
  };
}

describe("page removal side-effect listeners", () => {
  it("disables only orphaned published snippets and notifies unique administrators", async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([{ id: "snippet-id", name: "Pixel" }])
      .mockResolvedValueOnce([]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const emit = vi.fn().mockResolvedValue(undefined);
    const database = {
      snippet: { findMany, updateMany },
      user: { findMany: vi.fn() },
      logEntry: { create: vi.fn(async () => ({})) },
    };

    await onPageRemovedFromScope(pageContext(), {
      database,
      getRecipients: async () => ["master-id", "admin-id"],
      notify: emit,
      language: "en",
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "snippet-id",
        status: "PUBLISHED",
        scopeType: "SPECIFIC_PAGES",
        scopedPages: { none: {} },
      }),
      data: { status: "DRAFT" },
    });
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledWith(
      "master-id",
      expect.stringContaining("Pixel"),
      "/admin/custom-code/snippet-id",
    );
    expect(database.logEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "master-id",
        action: "SNIPPET_AUTO_DISABLED",
        objectType: "SCRIPT",
        objectId: "snippet-id",
      }),
    });
  });

  it("does not notify when the conditional transition loses a race", async () => {
    const emit = vi.fn().mockResolvedValue(undefined);
    const database = {
      snippet: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ id: "snippet-id", name: "Pixel" }])
          .mockResolvedValueOnce([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      user: { findMany: vi.fn() },
      logEntry: { create: vi.fn(async () => ({})) },
    };

    await onPageRemovedFromScope(pageContext(), {
      database,
      getRecipients: async () => ["master-id"],
      notify: emit,
    });

    expect(emit).not.toHaveBeenCalled();
  });

  it("keeps multi-page specific scope published and skips notify", async () => {
    const updateMany = vi.fn();
    const emit = vi.fn();
    const database = {
      snippet: {
        // Candidate query + reconciliation both empty (still has another page).
        findMany: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]),
        updateMany,
      },
      user: { findMany: vi.fn() },
      logEntry: { create: vi.fn(async () => ({})) },
    };

    await onPageRemovedFromScope(pageContext({ snippetIds: ["snippet-id"] }), {
      database,
      getRecipients: async () => ["master-id"],
      notify: emit,
    });

    expect(updateMany).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it("reconciles path-B orphans with empty context snippetIds", async () => {
    const emit = vi.fn().mockResolvedValue(undefined);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const database = {
      snippet: {
        findMany: vi
          .fn()
          // no path-A query when snippetIds empty; only reconciliation
          .mockResolvedValueOnce([{ id: "legacy-snippet", name: "Legacy" }]),
        updateMany,
      },
      user: { findMany: vi.fn() },
      logEntry: { create: vi.fn(async () => ({})) },
    };

    await onPageRemovedFromScope(pageContext({ snippetIds: [] }), {
      database,
      getRecipients: async () => ["master-id"],
      notify: emit,
      language: "en",
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "legacy-snippet" }),
      data: { status: "DRAFT" },
    });
    expect(emit).toHaveBeenCalledWith(
      "master-id",
      expect.stringContaining("specific-page scope became empty"),
      "/admin/custom-code/legacy-snippet",
    );
  });

  it("paginates path-B orphan reconciliation instead of one unbounded findMany", async () => {
    const remaining = [
      { id: "orphan-1", name: "One" },
      { id: "orphan-2", name: "Two" },
    ];
    const findMany = vi.fn(async (args?: { take?: number }) => {
      const take = args?.take ?? remaining.length;
      return remaining.slice(0, take);
    });
    // O contrato do listener tipa `where` como `unknown`; o teste estreita ao
    // formato que o listener realmente envia ({ id, ...orphanScopeWhere }).
    const updateMany = vi.fn(async ({ where }: { where: unknown }) => {
      const { id } = where as { id: string };
      const index = remaining.findIndex((row) => row.id === id);
      if (index >= 0) remaining.splice(index, 1);
      return { count: 1 };
    });
    const emit = vi.fn().mockResolvedValue(undefined);

    await onPageRemovedFromScope(pageContext({ snippetIds: [] }), {
      database: {
        snippet: { findMany, updateMany },
        user: { findMany: vi.fn() },
        logEntry: { create: vi.fn(async () => ({})) },
      },
      getRecipients: async () => ["master-id"],
      notify: emit,
      language: "en",
      batchSize: 1,
    });

    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(findMany).toHaveBeenCalledTimes(3);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 1,
        select: { id: true, name: true },
      }),
    );
    expect(emit).toHaveBeenCalledTimes(2);
  });

  // Regressão da fase 46: o lookup de destinatários virou eager e passou a
  // consultar usuários em toda remoção de página, mesmo sem nenhum órfão.
  it("does not look up recipients when no snippet is orphaned", async () => {
    const getRecipients = vi.fn(async () => ["master-id"]);
    const updateMany = vi.fn();
    const emit = vi.fn();

    await onPageRemovedFromScope(pageContext(), {
      database: {
        snippet: { findMany: vi.fn(async () => []), updateMany },
        user: { findMany: vi.fn() },
      },
      getRecipients,
      notify: emit,
    });

    expect(getRecipients).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it("looks up recipients once, before the first draft transition, across batches", async () => {
    const order: string[] = [];
    const getRecipients = vi.fn(async () => {
      order.push("recipients");
      return ["master-id"];
    });
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([{ id: "snippet-id", name: "Pixel" }])
      .mockResolvedValueOnce([{ id: "orphan-2", name: "Two" }])
      .mockResolvedValueOnce([]);
    const updateMany = vi.fn(async () => {
      order.push("transition");
      return { count: 1 };
    });
    const emit = vi.fn().mockResolvedValue(undefined);

    await onPageRemovedFromScope(pageContext(), {
      database: {
        snippet: { findMany, updateMany },
        user: { findMany: vi.fn() },
      },
      getRecipients,
      notify: emit,
      language: "en",
      batchSize: 1,
    });

    expect(getRecipients).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["recipients", "transition", "transition"]);
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it("treats notify failures as best-effort after a durable draft transition", async () => {
    const emit = vi.fn().mockRejectedValue(new Error("notify down"));
    const database = {
      snippet: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ id: "snippet-id", name: "Pixel" }])
          .mockResolvedValueOnce([]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      user: { findMany: vi.fn() },
      logEntry: { create: vi.fn(async () => ({})) },
    };

    await expect(
      onPageRemovedFromScope(pageContext(), {
        database,
        getRecipients: async () => ["master-id"],
        notify: emit,
      }),
    ).resolves.toBeUndefined();

    expect(database.snippet.updateMany).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledOnce();
  });

  it("throws when the snippet database is missing", async () => {
    await expect(
      onPageRemovedFromScope(pageContext(), {
        database: { user: { findMany: vi.fn() } } as never,
      }),
    ).rejects.toThrow(/snippet database/i);
  });

  it("resets the home pointer, rebuilds inline, enqueues a complement and notifies administrators", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const rebuild = vi.fn().mockResolvedValue(undefined);
    const add = vi.fn().mockResolvedValue(undefined);
    const emit = vi.fn().mockResolvedValue(undefined);
    const database = {
      siteSettings: { updateMany },
      user: { findMany: vi.fn() },
      logEntry: { create: vi.fn(async () => ({})) },
    };

    await expect(
      onHomePageRemoved(pageContext({ isHome: true }), {
        database,
        queue: { add },
        rebuild,
        getRecipients: async () => ["master-id", "admin-id"],
        notify: emit,
        language: "pt-BR",
      }),
    ).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "singleton", homePageId: "page-id" },
      data: { homePageId: null },
    });
    expect(rebuild).toHaveBeenCalledWith("ARTIFACTS", []);
    expect(add).toHaveBeenCalledWith(
      expect.stringMatching(/^settings-rebuild-/),
      expect.objectContaining({
        type: "settings-rebuild",
        scope: "ARTIFACTS",
        pageIds: [],
      }),
      expect.objectContaining({ attempts: 3 }),
    );
    expect(add.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({
        jobId: expect.stringMatching(/^settings-rebuild-/),
      }),
    );
    expect(add.mock.calls[0]?.[2]?.jobId).not.toContain(":");
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledWith(
      "admin-id",
      expect.stringContaining("página inicial"),
      "/admin/settings",
    );
    expect(database.logEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "master-id",
        action: "HOME_POINTER_RESET",
        objectType: "SETTINGS",
        objectId: "page-id",
      }),
    });
  });

  it("is a no-op when another settings write already moved the home pointer", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const rebuild = vi.fn();
    const emit = vi.fn();

    await expect(
      onHomePageRemoved(pageContext({ isHome: true }), {
        database: { siteSettings: { updateMany }, user: { findMany: vi.fn() } },
        rebuild,
        notify: emit,
      }),
    ).resolves.toBe(false);

    expect(rebuild).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it("returns true after durable rebuild even when notify fails", async () => {
    const rebuild = vi.fn().mockResolvedValue(undefined);
    const emit = vi.fn().mockRejectedValue(new Error("notify down"));

    await expect(
      onHomePageRemoved(pageContext({ isHome: true }), {
        database: {
          siteSettings: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
          user: { findMany: vi.fn() },
          logEntry: { create: vi.fn(async () => ({})) },
        },
        queue: { add: vi.fn().mockResolvedValue(undefined) },
        rebuild,
        getRecipients: async () => ["master-id"],
        notify: emit,
      }),
    ).resolves.toBe(true);

    expect(rebuild).toHaveBeenCalledOnce();
  });

  it("throws when siteSettings is missing for a home page", async () => {
    await expect(
      onHomePageRemoved(pageContext({ isHome: true }), {
        database: { user: { findMany: vi.fn() } } as never,
      }),
    ).rejects.toThrow(/siteSettings database/i);
  });
});
