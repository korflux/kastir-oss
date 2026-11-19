import { describe, expect, it } from "vitest";

import {
  promoteBaseChildFolders,
  type PromoteFolderRow,
} from "@/lib/Modules/Shared/promoteBaseChildFolders";

function makeWriter(rows: PromoteFolderRow[]) {
  return {
    findMany: async () => rows.map((row) => ({ ...row })),
    updateMany: async (args: {
      where: { parentId: string };
      data: { parentId: null };
    }) => {
      let count = 0;
      for (const row of rows) {
        if (row.parentId === args.where.parentId) {
          row.parentId = null;
          count += 1;
        }
      }
      return { count };
    },
  };
}

describe("promoteBaseChildFolders", () => {
  it("promotes direct Base children to independent roots", async () => {
    const rows: PromoteFolderRow[] = [
      { id: "base", parentId: null, isBase: true },
      { id: "l1", parentId: "base", isBase: false },
      { id: "l2", parentId: "l1", isBase: false },
      { id: "l3", parentId: "l2", isBase: false },
    ];

    const result = await promoteBaseChildFolders(makeWriter(rows));

    expect(result).toEqual({ baseId: "base", promoted: 1 });
    expect(rows.find((row) => row.id === "l1")?.parentId).toBeNull();
    // Netos/bisnetos mantêm parentId original.
    expect(rows.find((row) => row.id === "l2")?.parentId).toBe("l1");
    expect(rows.find((row) => row.id === "l3")?.parentId).toBe("l2");
    expect(rows.find((row) => row.id === "base")?.parentId).toBeNull();
  });

  it("is idempotent on a second run", async () => {
    const rows: PromoteFolderRow[] = [
      { id: "base", parentId: null, isBase: true },
      { id: "l1", parentId: "base", isBase: false },
    ];
    const writer = makeWriter(rows);

    await promoteBaseChildFolders(writer);
    const second = await promoteBaseChildFolders(writer);

    expect(second.promoted).toBe(0);
    expect(rows.find((row) => row.id === "l1")?.parentId).toBeNull();
  });

  it("returns null base when Base is missing", async () => {
    const result = await promoteBaseChildFolders(
      makeWriter([{ id: "orphan", parentId: null, isBase: false }]),
    );
    expect(result).toEqual({ baseId: null, promoted: 0 });
  });
});
