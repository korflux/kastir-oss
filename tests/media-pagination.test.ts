import { describe, expect, it } from "vitest";

import {
  getMediaRefreshPages,
  mergeMediaPages,
} from "@/lib/Modules/Media/Components/MediaWorkspace";

describe("media refresh pagination", () => {
  it("recarrega todas as páginas previamente visíveis acima do limite da API", () => {
    expect(getMediaRefreshPages(101)).toHaveLength(13);
  });

  it("mescla páginas sem perder itens carregados", () => {
    const pages = Array.from({ length: 13 }, (_, pageIndex) =>
      Array.from({ length: 8 }, (_, itemIndex) => ({
        id: String(pageIndex * 8 + itemIndex),
      })),
    );

    expect(mergeMediaPages(pages)).toHaveLength(104);
  });
});
