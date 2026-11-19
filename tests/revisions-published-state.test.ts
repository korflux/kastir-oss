import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  resolvePublishedPage,
  resolvePublishedSnippet,
} from "@/lib/Modules/Revisions/publishedState";
import { rebuildPublishedPage } from "@/lib/Publishing/rebuild";
import { reconcilePublishedSite } from "@/lib/Publishing/reconcile";

const publishedRevision = {
  id: "rev-live",
  pageId: "page-1",
  title: "Live title",
  slug: "live-slug",
  content: "<main>Published</main>",
  seoTitle: "Live SEO",
  seoDescription: null,
  seoKeyword: null,
  folderId: "base",
};

const draftPage = {
  id: "page-1",
  status: "PUBLISHED" as const,
  deletedAt: null,
  title: "Draft title",
  slug: "draft-slug",
  content: "<main>Draft</main>",
  publishedRevisionId: "rev-live",
  publishedRevision,
};

describe("resolvePublishedPage", () => {
  it("returns the snapshot pointer, never the draft fields", () => {
    expect(resolvePublishedPage(draftPage)).toEqual({
      id: "page-1",
      title: "Live title",
      slug: "live-slug",
      content: "<main>Published</main>",
      seoTitle: "Live SEO",
      seoDescription: null,
      seoKeyword: null,
    });
  });

  it("does not fall back to the draft when the pointer is missing or foreign", () => {
    expect(
      resolvePublishedPage({
        ...draftPage,
        publishedRevisionId: null,
        publishedRevision: null,
      }),
    ).toBeNull();
    expect(
      resolvePublishedPage({
        ...draftPage,
        publishedRevision: { ...publishedRevision, pageId: "other-page" },
      }),
    ).toBeNull();
    expect(
      resolvePublishedPage({
        ...draftPage,
        status: "DRAFT",
      }),
    ).toBeNull();
  });
});

describe("resolvePublishedSnippet", () => {
  it("uses published snapshot scope and content, not the draft row", () => {
    const resolved = resolvePublishedSnippet({
      id: "snip-1",
      status: "PUBLISHED",
      deletedAt: null,
      publishedRevisionId: "srev-1",
      publishedRevision: {
        id: "srev-1",
        snippetId: "snip-1",
        name: "Live script",
        location: "HEADER",
        content: "<script>live()</script>",
        priority: 1,
        scopeType: "ALL_PAGES",
        pageIds: [],
        triggerType: null,
        triggerConfig: null,
        maxDisplays: null,
        displayResetDays: null,
        createdAt: new Date("2026-01-01"),
      },
    });
    expect(resolved).toMatchObject({
      id: "snip-1",
      content: "<script>live()</script>",
      location: "HEADER",
      priority: 1,
    });
  });
});

describe("public rebuild and reconcile ignore draft", () => {
  it("writes the published slug and content, not the draft", async () => {
    const write = vi.fn(async () => undefined);
    await rebuildPublishedPage("page-1", {
      database: {
        page: {
          findUnique: vi.fn(async () => draftPage),
        },
        snippet: { findMany: vi.fn(async () => []) },
      },
      fileStore: { read: vi.fn(), write, remove: vi.fn() },
    });

    expect(write).toHaveBeenCalledWith(
      "live-slug",
      expect.stringContaining("<main>Published</main>"),
    );
    expect(write).not.toHaveBeenCalledWith("draft-slug", expect.anything());
  });

  it("does not rebuild a deactivated page or one without a pointer", async () => {
    const write = vi.fn(async () => undefined);
    await rebuildPublishedPage("page-1", {
      database: {
        page: {
          findUnique: vi.fn(async () => ({
            ...draftPage,
            status: "DRAFT",
          })),
        },
        snippet: { findMany: vi.fn() },
      },
      fileStore: { read: vi.fn(), write, remove: vi.fn() },
    });
    await rebuildPublishedPage("page-2", {
      database: {
        page: {
          findUnique: vi.fn(async () => ({
            ...draftPage,
            publishedRevisionId: null,
            publishedRevision: null,
          })),
        },
        snippet: { findMany: vi.fn() },
      },
      fileStore: { read: vi.fn(), write, remove: vi.fn() },
    });

    expect(write).not.toHaveBeenCalled();
  });

  it("reconciles using the published slug, not the draft slug", async () => {
    const rebuildGlobal = vi.fn();
    const fileStore = {
      read: vi.fn(async (slug: string) =>
        slug === "live-slug" ? null : "<html>draft file</html>",
      ),
      write: vi.fn(),
      remove: vi.fn(),
    };

    const result = await reconcilePublishedSite({
      database: {
        page: {
          findMany: vi.fn(async () => [draftPage]),
        },
      },
      fileStore,
      rebuildGlobal,
    });

    expect(fileStore.read).toHaveBeenCalledWith("live-slug");
    expect(fileStore.read).not.toHaveBeenCalledWith("draft-slug");
    expect(result).toEqual({ checked: 1, missing: 1, rebuilt: true });
    expect(rebuildGlobal).toHaveBeenCalledOnce();
  });
});
