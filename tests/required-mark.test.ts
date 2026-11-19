import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RequiredMark } from "@/components/Shared/RequiredMark";

describe("RequiredMark", () => {
  it("renders a visual asterisk with accessible required label", () => {
    const html = renderToStaticMarkup(createElement(RequiredMark));

    expect(html).toContain("*");
    expect(html).toContain("required");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("sr-only");
  });

  it("accepts a localized accessible label", () => {
    const html = renderToStaticMarkup(
      createElement(RequiredMark, { label: "obrigatório" }),
    );

    expect(html).toContain("obrigatório");
  });
});
