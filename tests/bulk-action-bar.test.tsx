import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { BulkActionBar } from "@/components/Shared/BulkActionBar";

const baseProps = {
  allSelected: false,
  clearLabel: "Clear",
  onClear: vi.fn(),
  onToggleAll: vi.fn(),
  selectedCount: 2,
  selectedLabel: "selected",
  selectAllLabel: "Select all visible",
  visibleCount: 4,
};

describe("BulkActionBar", () => {
  it("renders visible select-all and composed non-destructive actions", () => {
    const html = renderToStaticMarkup(
      createElement(BulkActionBar, {
        ...baseProps,
        actions: createElement("button", { type: "button" }, "Move"),
      }),
    );

    expect(html).toContain('data-testid="bulk-action-bar"');
    expect(html).toContain('aria-label="Select all visible"');
    expect(html).toContain("2 selected");
    expect(html).toContain("Clear");
    expect(html).toContain("Move");
    expect(html).toContain('data-slot="bulk-actions"');
    expect(html).toContain("flex-wrap");
    expect(html).toContain("min-w-0");
  });

  it("keeps non-destructive and destructive actions in distinct DOM slots", () => {
    const html = renderToStaticMarkup(
      createElement(BulkActionBar, {
        ...baseProps,
        actions: createElement("button", { type: "button" }, "Move"),
        destructiveActions: createElement(
          "button",
          { type: "button" },
          "Trash",
        ),
      }),
    );

    const actionsIdx = html.indexOf('data-slot="bulk-actions"');
    const destructiveIdx = html.indexOf('data-slot="bulk-destructive"');
    expect(actionsIdx).toBeGreaterThan(-1);
    expect(destructiveIdx).toBeGreaterThan(-1);
    // Eixo E/D: grupo não-destrutivo aparece antes do destrutivo no markup.
    expect(actionsIdx).toBeLessThan(destructiveIdx);
    expect(html.indexOf("Move")).toBeGreaterThan(actionsIdx);
    expect(html.indexOf("Move")).toBeLessThan(destructiveIdx);
    expect(html.indexOf("Trash")).toBeGreaterThan(destructiveIdx);
  });

  it("does not render the bar when there is no selection", () => {
    const html = renderToStaticMarkup(
      createElement(BulkActionBar, {
        ...baseProps,
        selectedCount: 0,
        actions: createElement("button", { type: "button" }, "Move"),
      }),
    );

    expect(html).toBe("");
  });

  it("disables select-all and announces the shared selection ceiling after selection", () => {
    const html = renderToStaticMarkup(
      createElement(BulkActionBar, {
        allSelected: false,
        clearLabel: "Clear",
        onClear: vi.fn(),
        onToggleAll: vi.fn(),
        selectedCount: 1,
        selectedLabel: "selected",
        selectAllLabel: "Select all visible",
        selectionLimitLabel: "Select up to {count} items",
        visibleCount: 201,
      }),
    );

    expect(html).toContain("disabled");
    expect(html).toContain("Select up to 200 items");
  });
});
