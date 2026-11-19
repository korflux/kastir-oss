import { describe, expect, it } from "vitest";

import {
  getRowSelectionState,
  removeRowSelection,
  toggleAllRows,
  toggleRowSelection,
} from "@/components/Shared/useRowSelection";
import { BULK_IDS_MAX } from "@/lib/Modules/Shared/BulkConstants";

describe("row selection", () => {
  it("toggles one ID without introducing duplicates", () => {
    expect(toggleRowSelection(["a", "b"], "b")).toEqual(["a"]);
    expect(toggleRowSelection(["a", "b"], "c")).toEqual(["a", "b", "c"]);
    expect(toggleRowSelection(["a", "a"], "c")).toEqual(["a", "c"]);
  });

  it("selects or clears only the IDs currently visible", () => {
    expect(toggleAllRows(["outside"], ["a", "b"])).toEqual([
      "outside",
      "a",
      "b",
    ]);
    expect(toggleAllRows(["outside", "a", "b"], ["a", "b"])).toEqual([
      "outside",
    ]);
  });

  it("never creates a selection larger than the bulk API contract", () => {
    const visibleIds = Array.from(
      { length: BULK_IDS_MAX + 1 },
      (_, index) => `id-${index}`,
    );

    expect(toggleAllRows([], visibleIds)).toHaveLength(BULK_IDS_MAX);
    expect(
      toggleRowSelection(
        visibleIds.slice(0, BULK_IDS_MAX),
        visibleIds[BULK_IDS_MAX],
      ),
    ).toHaveLength(BULK_IDS_MAX);
    expect(
      toggleRowSelection(visibleIds.slice(0, BULK_IDS_MAX), visibleIds[0]),
    ).toHaveLength(BULK_IDS_MAX - 1);
  });

  it("removes completed IDs without changing unrelated selection", () => {
    expect(removeRowSelection(["a", "b", "a"], ["b"])).toEqual(["a"]);
  });

  it("reports all and partial selection for the visible subset", () => {
    expect(getRowSelectionState(["a", "b"], ["a", "b"])).toEqual({
      allSelected: true,
      someSelected: false,
    });
    expect(getRowSelectionState(["a"], ["a", "b"])).toEqual({
      allSelected: false,
      someSelected: true,
    });
    expect(getRowSelectionState(["outside"], ["a", "b"])).toEqual({
      allSelected: false,
      someSelected: false,
    });
  });
});
