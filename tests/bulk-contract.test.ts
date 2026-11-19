import { describe, expect, it } from "vitest";

import {
  bulkIdsSchema,
  bulkResponseStatus,
  normalizeBulkIds,
  runBulk,
} from "@/lib/Modules/Shared/Bulk";

const validId = "clh5q6m1v0000qz9j8r2w4x7a";

describe("bulk contract", () => {
  it("deduplicates IDs while preserving their first-seen order", () => {
    expect(normalizeBulkIds(["b", "a", "b", "c", "a"])).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("rejects empty, malformed and oversized ID lists at the boundary", () => {
    expect(bulkIdsSchema.safeParse([]).success).toBe(false);
    expect(bulkIdsSchema.safeParse(["not-a-cuid"]).success).toBe(false);
    expect(
      bulkIdsSchema.safeParse(Array.from({ length: 201 }, () => validId))
        .success,
    ).toBe(false);
  });

  it("continues in order after one item fails", async () => {
    const processed: string[] = [];
    const result = await runBulk(
      ["first", "second", "first", "third"],
      async (id) => {
        processed.push(id);
        if (id === "second") throw new Error("internal detail");
      },
      (id) => ({
        id,
        code: "ITEM_FAILED",
        message: "Unable to complete this item",
      }),
    );

    expect(processed).toEqual(["first", "second", "third"]);
    expect(result).toEqual({
      ok: ["first", "third"],
      failed: [
        {
          id: "second",
          code: "ITEM_FAILED",
          message: "Unable to complete this item",
        },
      ],
    });
  });

  it("uses 207 whenever at least one item failed", () => {
    expect(bulkResponseStatus({ ok: ["one"], failed: [] })).toBe(200);
    expect(
      bulkResponseStatus({
        ok: ["one"],
        failed: [{ id: "two", code: "FAILED", message: "Failed" }],
      }),
    ).toBe(207);
    expect(
      bulkResponseStatus({
        ok: [],
        failed: [{ id: "one", code: "FAILED", message: "Failed" }],
      }),
    ).toBe(207);
  });
});
