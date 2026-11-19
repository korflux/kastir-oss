import { SearchQuery } from "@codemirror/search";
import { describe, expect, it } from "vitest";

import { shouldPreserveSearchQuery } from "@/lib/Modules/Pages/Components/PageEditor";

describe("editor search query", () => {
  it("does not erase a selection-derived term when the previous query is empty", () => {
    const emptyQuery = new SearchQuery({ search: "" });
    const selectedTextQuery = new SearchQuery({ search: "Hello world" });

    expect(shouldPreserveSearchQuery(emptyQuery, selectedTextQuery)).toBe(
      false,
    );
  });

  it("preserves an existing query after the editor changes it", () => {
    const previousQuery = new SearchQuery({ search: "hello" });
    const nextQuery = new SearchQuery({ search: "hi" });

    expect(shouldPreserveSearchQuery(previousQuery, nextQuery)).toBe(true);
  });
});
