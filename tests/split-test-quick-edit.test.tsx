import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  canSubmitSplitTestQuickEdit,
  SplitTestQuickEditPopover,
} from "@/lib/Modules/SplitTests/Components/SplitTestQuickEditPopover";
import { getPanelDictionary } from "@/lib/i18n/panel";

describe("split test quick edit", () => {
  it("accepts only a non-empty name and slug", () => {
    expect(
      canSubmitSplitTestQuickEdit({ name: "Campaign", slug: "campaign" }),
    ).toBe(true);
    expect(canSubmitSplitTestQuickEdit({ name: "  ", slug: "campaign" })).toBe(
      false,
    );
    expect(canSubmitSplitTestQuickEdit({ name: "Campaign", slug: "  " })).toBe(
      false,
    );
  });

  it("uses the lightning trigger and exposes no status or destinations fields", () => {
    const html = renderToStaticMarkup(
      createElement(SplitTestQuickEditPopover, {
        dictionary: getPanelDictionary("en").splitTests,
        campaign: { id: "campaign-id", name: "Campaign", slug: "campaign" },
        onSave: async () => undefined,
      }),
    );

    expect(html).toContain("lucide-zap");
    expect(html).not.toContain("lucide-pencil");
    expect(html).not.toContain("Destinations");
    expect(html).not.toContain("Status");
  });
});
