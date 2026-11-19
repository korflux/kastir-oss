import { describe, expect, it } from "vitest";

import {
  REVISION_PIN_MAX,
  REVISION_RETENTION_DEFAULT,
} from "@/lib/Modules/Settings/revisionRetention";
import {
  pageSnapshotsEqual,
  pageSnapshotFingerprint,
  selectRevisionsToPurge,
  snippetSnapshotsEqual,
  snippetSnapshotFingerprint,
} from "@/lib/Modules/Revisions/snapshot";
import type {
  PageSnapshot,
  SnippetSnapshot,
} from "@/lib/Modules/Revisions/Types";

const pageA: PageSnapshot = {
  title: "Home",
  slug: "home",
  content: "<p>A</p>",
  seoTitle: null,
  seoDescription: null,
  seoKeyword: null,
  folderId: "base",
};

const snippetA: SnippetSnapshot = {
  name: "Header",
  location: "HEADER",
  content: "<script>a()</script>",
  priority: null,
  scopeType: "SPECIFIC_PAGES",
  pageIds: ["p2", "p1"],
  triggerType: "SCROLL",
  triggerConfig: { percentage: 40 },
  maxDisplays: 2,
  displayResetDays: 7,
};

describe("revision snapshot comparison", () => {
  it("treats identical page snapshots as equal even when object identity differs", () => {
    expect(pageSnapshotsEqual(pageA, { ...pageA })).toBe(true);
    expect(pageSnapshotFingerprint(pageA)).toBe(
      pageSnapshotFingerprint({ ...pageA }),
    );
    expect(pageSnapshotsEqual(pageA, { ...pageA, content: "<p>B</p>" })).toBe(
      false,
    );
  });

  it("normalizes snippet pageIds order so the same scope is not cloned", () => {
    const sameScope: SnippetSnapshot = {
      ...snippetA,
      pageIds: ["p1", "p2"],
    };
    expect(snippetSnapshotsEqual(snippetA, sameScope)).toBe(true);
    expect(snippetSnapshotFingerprint(snippetA)).toBe(
      snippetSnapshotFingerprint(sameScope),
    );
    expect(
      snippetSnapshotsEqual(snippetA, { ...snippetA, pageIds: ["p1"] }),
    ).toBe(false);
  });
});

describe("revision retention policy", () => {
  it("keeps the normal window, extra pins outside it, and live even when unpinned", () => {
    const revisions = Array.from({ length: 8 }, (_, index) => ({
      id: `rev-${index + 1}`,
      createdAt: new Date(Date.UTC(2026, 0, 8 - index)),
      pinned: index === 6 || index === 7,
    }));
    const purge = selectRevisionsToPurge({
      revisions,
      publishedRevisionId: "rev-8",
      normalLimit: REVISION_RETENTION_DEFAULT,
    });

    expect(REVISION_PIN_MAX).toBe(3);
    expect(purge.sort()).toEqual(["rev-6"]);
    expect(purge).not.toContain("rev-8");
    expect(purge).not.toContain("rev-7");
  });

  it("never schedules the live revision for removal", () => {
    const revisions = [
      { id: "new", createdAt: new Date("2026-02-01"), pinned: false },
      { id: "live", createdAt: new Date("2026-01-01"), pinned: false },
    ];
    expect(
      selectRevisionsToPurge({
        revisions,
        publishedRevisionId: "live",
        normalLimit: 1,
      }),
    ).toEqual([]);
  });
});
