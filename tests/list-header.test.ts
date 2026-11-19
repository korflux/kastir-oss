import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ListHeader } from "@/components/Shared/ListHeader";

describe("ListHeader", () => {
  it("renders title, subtitle, and CTA slot", () => {
    const html = renderToStaticMarkup(
      createElement(
        ListHeader,
        { title: "Pages", subtitle: "Create static pages." },
        createElement("button", { type: "button" }, "New page"),
      ),
    );

    expect(html).toContain("Pages");
    expect(html).toContain("Create static pages.");
    expect(html).toContain("New page");
    expect(html).toContain('data-testid="list-header"');
  });

  it("renders a controlled search input when onSearchChange is provided", () => {
    const onSearchChange = vi.fn();
    const html = renderToStaticMarkup(
      createElement(ListHeader, {
        title: "Pages",
        searchValue: "black",
        onSearchChange,
        searchPlaceholder: "Search by",
      }),
    );

    expect(html).toContain('type="search"');
    expect(html).toContain('value="black"');
    expect(html).toContain('placeholder="Search by"');
  });

  it("omits the search field when onSearchChange is absent", () => {
    const html = renderToStaticMarkup(
      createElement(ListHeader, { title: "Pages" }),
    );

    expect(html).not.toContain('type="search"');
  });
});
