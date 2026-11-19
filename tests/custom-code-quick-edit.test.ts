import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { canChangeQuickEditOpen } from "@/components/Shared/quickEdit";
import {
  canSubmitCustomCodeQuickEdit,
  CustomCodeQuickEditPopover,
} from "@/lib/Modules/CustomCode/Components/CustomCodeQuickEditPopover";
import { getPanelDictionary } from "@/lib/i18n/panel";

describe("custom code quick edit", () => {
  it("requires a name and accepts an empty or nonnegative integer priority", () => {
    expect(
      canSubmitCustomCodeQuickEdit({ name: "Analytics", priority: "" }),
    ).toBe(true);
    expect(
      canSubmitCustomCodeQuickEdit({ name: "Analytics", priority: "10" }),
    ).toBe(true);
    expect(canSubmitCustomCodeQuickEdit({ name: "  ", priority: "10" })).toBe(
      false,
    );
    expect(
      canSubmitCustomCodeQuickEdit({ name: "Analytics", priority: "-1" }),
    ).toBe(false);
    expect(
      canSubmitCustomCodeQuickEdit({ name: "Analytics", priority: "1.5" }),
    ).toBe(false);
  });

  it("keeps the popover open while the save is pending", () => {
    expect(canChangeQuickEditOpen(false, true)).toBe(false);
    expect(canChangeQuickEditOpen(false, false)).toBe(true);
  });

  it("uses the lightning trigger for quick edit instead of the full-editor pencil", () => {
    const html = renderToStaticMarkup(
      createElement(CustomCodeQuickEditPopover, {
        dictionary: getPanelDictionary("en").customCode,
        page: {
          id: "snippet-id",
          name: "Analytics",
          location: "HEADER",
          priority: null,
          scopeType: "ALL_PAGES",
        },
        onSave: async () => undefined,
      }),
    );

    expect(html).toContain("lucide-zap");
    expect(html).not.toContain("lucide-pencil");
  });
});
