import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DetailsPanel } from "@/components/Shared/DetailsPanel";

describe("DetailsPanel", () => {
  it("renders details slot and main content", () => {
    const html = renderToStaticMarkup(
      <DetailsPanel details={<label>Name</label>} detailsTitle="Details">
        <div>Editor body</div>
      </DetailsPanel>,
    );

    expect(html).toContain("Details");
    expect(html).toContain("Name");
    expect(html).toContain("Editor body");
    expect(html).toContain('data-testid="details-panel"');
  });
});
