import { describe, expect, it } from "vitest";

import {
  liveRevisionsForExport,
  stripPublishedPointerForInsert,
} from "@/lib/Modules/Revisions/package";

describe("revision backup package helpers", () => {
  it("exports only revisions pointed by publishedRevisionId", () => {
    const selected = liveRevisionsForExport(
      [
        { publishedRevisionId: "live-1" },
        { publishedRevisionId: null },
        { publishedRevisionId: "live-2" },
        { publishedRevisionId: "live-1" },
      ],
      [
        { id: "live-1", content: "<h1>Live</h1>" },
        { id: "old", content: "<h1>History</h1>" },
        { id: "live-2", content: "<h1>Other</h1>" },
      ],
    );

    expect(selected.map((row) => row.id).sort()).toEqual(["live-1", "live-2"]);
    expect(selected.some((row) => row.id === "old")).toBe(false);
  });

  it("strips the published pointer so import can recreate the FK after the snapshot", () => {
    expect(
      stripPublishedPointerForInsert({
        id: "page-1",
        title: "Home",
        publishedRevisionId: "live-1",
        content: "<h1>Draft</h1>",
      }),
    ).toEqual({
      id: "page-1",
      title: "Home",
      content: "<h1>Draft</h1>",
    });
  });
});
