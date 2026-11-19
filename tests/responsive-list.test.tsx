import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ListEmptyState,
  ListViewport,
} from "@/components/Shared/ResponsiveList";

describe("slots visuais compartilhados das listas", () => {
  it("isola a rolagem da lista no próprio viewport", () => {
    const html = renderToStaticMarkup(
      createElement(
        ListViewport,
        { className: "custom-class" },
        createElement("span", null, "Rows"),
      ),
    );

    expect(html).toContain("min-h-0");
    expect(html).toContain("min-w-0");
    expect(html).toContain("overflow-x-hidden");
    expect(html).toContain("overflow-y-auto");
    expect(html).toContain("custom-class");
  });

  it("mantém vazio como estado semântico da lista", () => {
    const html = renderToStaticMarkup(
      createElement(ListEmptyState, null, "Nothing here"),
    );

    expect(html).toContain('role="status"');
    expect(html).toContain("border-dashed");
    expect(html).toContain("Nothing here");
  });
});
