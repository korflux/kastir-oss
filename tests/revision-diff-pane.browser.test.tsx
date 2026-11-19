// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { RevisionDiffPane } from "@/lib/Modules/Revisions/Components/RevisionDiffPane";
import type { RevisionDiffLine } from "@/lib/Modules/Revisions/diff";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const lines: RevisionDiffLine[] = [
  { kind: "unchanged", marker: " ", text: "  <main>" },
  { kind: "removed", marker: "-", text: "    <p>old</p>" },
  { kind: "added", marker: "+", text: "    <p>new</p>" },
  { kind: "unchanged", marker: " ", text: "  </main>" },
];

let root: Root | undefined;

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
    root = undefined;
  }
  document.body.replaceChildren();
});

describe("RevisionDiffPane browser", () => {
  it("mounts a read-only CodeMirror with diff gutters and original indentation", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <RevisionDiffPane
          ariaLabel="Revision diff"
          emptyLabel="No differences"
          lines={lines}
        />,
      );
    });

    const editor = container.querySelector(
      '[data-testid="revision-diff-editor"]',
    );
    expect(editor).not.toBeNull();
    expect(editor?.getAttribute("data-editor-mode")).toBe("read-only");
    expect(
      editor?.querySelector('[role="textbox"]')?.getAttribute("aria-readonly"),
    ).toBe("true");
    expect(
      editor?.querySelector(".cm-content")?.getAttribute("contenteditable"),
    ).toBe("false");
    expect(editor?.querySelector(".kastir-diff-gutter")).not.toBeNull();
    expect(editor?.querySelector(".kastir-diff-marker-added")).not.toBeNull();
    expect(editor?.querySelector(".kastir-diff-marker-removed")).not.toBeNull();
    expect(editor?.querySelector(".kastir-diff-line-removed")).not.toBeNull();
    expect(editor?.querySelector(".kastir-diff-line-added")).not.toBeNull();
    expect(editor?.querySelector(".cm-line")?.textContent).toBe("  <main>");
  });
});
