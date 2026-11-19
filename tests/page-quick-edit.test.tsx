import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  canSubmitPageQuickEdit,
  PageQuickEditPopover,
} from "@/lib/Modules/Pages/Components/PageQuickEditPopover";
import { canChangeQuickEditOpen } from "@/components/Shared/quickEdit";
import { getPanelDictionary } from "@/lib/i18n/panel";

describe("page quick edit", () => {
  it("requires a title and folder before submitting", () => {
    expect(canSubmitPageQuickEdit({ title: "Landing", folderId: "base" })).toBe(
      true,
    );
    expect(canSubmitPageQuickEdit({ title: "  ", folderId: "base" })).toBe(
      false,
    );
    expect(canSubmitPageQuickEdit({ title: "Landing", folderId: "" })).toBe(
      false,
    );
  });

  it("does not allow an async save to be dismissed by outside close", () => {
    expect(canChangeQuickEditOpen(false, true)).toBe(false);
    expect(canChangeQuickEditOpen(true, true)).toBe(true);
    expect(canChangeQuickEditOpen(false, false)).toBe(true);
  });

  it("uses the lightning trigger for quick edit instead of the full-editor pencil", () => {
    const html = renderToStaticMarkup(
      createElement(PageQuickEditPopover, {
        dictionary: getPanelDictionary("en").pages,
        folders: [{ id: "base", name: "Base", parentId: null }],
        page: {
          id: "page-id",
          title: "Landing",
          slug: "landing",
          folderId: "base",
        },
        onSave: async () => undefined,
      }),
    );

    expect(html).toContain("lucide-zap");
    expect(html).not.toContain("lucide-pencil");
    // Conteúdo só monta com open — paridade com Custom Code e Split Tests.
    expect(html).not.toContain(`quick-page-title-page-id`);
  });
});
