import { describe, expect, it } from "vitest";

import { MAX_PAGE_CONTENT_BYTES } from "@/lib/Modules/Pages/Schema";
import { MAX_SNIPPET_CONTENT_BYTES } from "@/lib/Modules/CustomCode/Schema";
import {
  pageSnapshotSchema,
  parsePageSnapshot,
  parseSnippetSnapshot,
  revisionDiffQuerySchema,
  revisionListQuerySchema,
  revisionPinSchema,
  revisionRestoreSchema,
  snippetSnapshotSchema,
} from "@/lib/Modules/Revisions/Schema";

const pageSnapshot = {
  title: "Landing",
  slug: "landing",
  content: "<h1>Hi</h1>",
  seoTitle: "SEO",
  seoDescription: null,
  seoKeyword: null,
  folderId: "folder-1",
};

const snippetSnapshot = {
  name: "Tracker",
  location: "HEADER" as const,
  content: "<script>1</script>",
  priority: 1,
  scopeType: "ALL_PAGES" as const,
  pageIds: [],
  triggerType: null,
  triggerConfig: null,
  maxDisplays: null,
  displayResetDays: null,
};

describe("revision snapshot schemas", () => {
  it("accepts a complete page snapshot and rejects control fields", () => {
    expect(pageSnapshotSchema.safeParse(pageSnapshot).success).toBe(true);
    expect(
      pageSnapshotSchema.safeParse({
        ...pageSnapshot,
        publishedRevisionId: "rev-1",
      }).success,
    ).toBe(false);
    expect(
      pageSnapshotSchema.safeParse({
        ...pageSnapshot,
        authorId: "user-1",
        pinned: true,
      }).success,
    ).toBe(false);
    expect(
      pageSnapshotSchema.safeParse({
        ...pageSnapshot,
        type: "page",
      }).success,
    ).toBe(false);
  });

  it("accepts a complete snippet snapshot and rejects control fields", () => {
    expect(snippetSnapshotSchema.safeParse(snippetSnapshot).success).toBe(true);
    expect(
      snippetSnapshotSchema.safeParse({
        ...snippetSnapshot,
        id: "rev-1",
        snippetId: "snip-1",
      }).success,
    ).toBe(false);
    expect(
      snippetSnapshotSchema.safeParse({
        ...snippetSnapshot,
        resourceType: "snippet",
      }).success,
    ).toBe(false);
  });

  it("rejects oversized page and snippet content", () => {
    const hugePage = "x".repeat(MAX_PAGE_CONTENT_BYTES + 1);
    const hugeSnippet = "y".repeat(MAX_SNIPPET_CONTENT_BYTES + 1);
    expect(parsePageSnapshot({ ...pageSnapshot, content: hugePage })).toEqual({
      success: false,
    });
    expect(
      parseSnippetSnapshot({ ...snippetSnapshot, content: hugeSnippet }),
    ).toEqual({ success: false });
  });

  it("accepts list/diff query bounds and rejects oversized pageSize", () => {
    expect(
      revisionListQuerySchema.safeParse({ page: "1", pageSize: "20" }).success,
    ).toBe(true);
    expect(revisionListQuerySchema.safeParse({ pageSize: 51 }).success).toBe(
      false,
    );
    expect(
      revisionDiffQuerySchema.safeParse({ from: "rev-1", to: "draft" }).success,
    ).toBe(true);
    expect(
      revisionDiffQuerySchema.safeParse({
        from: "rev-1",
        to: "rev-2",
        extra: true,
      }).success,
    ).toBe(false);
  });

  it("requires expectedUpdatedAt for restore and a boolean pin flag", () => {
    expect(
      revisionRestoreSchema.safeParse({
        expectedUpdatedAt: "2026-08-13T12:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(revisionRestoreSchema.safeParse({}).success).toBe(false);
    expect(
      revisionRestoreSchema.safeParse({
        expectedUpdatedAt: "2026-08-13T12:00:00.000Z",
        content: "<script>alert(1)</script>",
      }).success,
    ).toBe(false);
    expect(revisionPinSchema.safeParse({ pinned: true }).success).toBe(true);
    expect(revisionPinSchema.safeParse({ pinned: "yes" }).success).toBe(false);
  });

  it("accepts a triggerConfig that matches triggerType and rejects a mismatched one", () => {
    expect(
      snippetSnapshotSchema.safeParse({
        ...snippetSnapshot,
        triggerType: "SCROLL",
        triggerConfig: { percentage: 50 },
      }).success,
    ).toBe(true);
    expect(
      snippetSnapshotSchema.safeParse({
        ...snippetSnapshot,
        triggerType: "SCROLL",
        triggerConfig: { delaySeconds: 5 },
      }).success,
    ).toBe(false);
    expect(
      snippetSnapshotSchema.safeParse({
        ...snippetSnapshot,
        triggerType: "SCROLL",
        triggerConfig: { percentage: 50, extra: true },
      }).success,
    ).toBe(false);
    expect(
      snippetSnapshotSchema.safeParse({
        ...snippetSnapshot,
        triggerType: null,
        triggerConfig: { percentage: 50 },
      }).success,
    ).toBe(false);
    const parsed = parseSnippetSnapshot({
      ...snippetSnapshot,
      triggerType: "PAGE_LOAD",
      triggerConfig: { delaySeconds: 3 },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.triggerConfig).toEqual({ delaySeconds: 3 });
    }
  });

  it("does not accept a polymorphic type discriminator from external input", () => {
    expect(
      pageSnapshotSchema.safeParse({
        ...pageSnapshot,
        kind: "snippet",
      }).success,
    ).toBe(false);
    expect(
      snippetSnapshotSchema.safeParse({
        ...snippetSnapshot,
        kind: "page",
      }).success,
    ).toBe(false);
  });
});
