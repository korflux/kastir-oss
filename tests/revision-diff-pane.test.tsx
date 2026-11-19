// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RevisionCompareBar } from "@/lib/Modules/Revisions/Components/RevisionCompareBar";
import { RevisionDiffPane } from "@/lib/Modules/Revisions/Components/RevisionDiffPane";
import type { RevisionHistoryItem } from "@/lib/Modules/Revisions/Components/RevisionHistoryPanel";
import {
  pageFieldChanges,
  scriptFieldChanges,
  type PageFieldValues,
  type ScriptFieldValues,
} from "@/lib/Modules/Revisions/Components/revisionFieldChanges";
import {
  compareRevisionText,
  type RevisionDiffLine,
} from "@/lib/Modules/Revisions/diff";
import { getPanelDictionary } from "@/lib/i18n/panel";

// Habilita o flush determinístico dos efeitos React usados pela montagem.
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const dictionary = getPanelDictionary("en");
const copy = dictionary.revisions;

const hunks: RevisionDiffLine[] = [
  { kind: "unchanged", marker: " ", text: "keep this" },
  {
    kind: "removed",
    marker: "-",
    text: "hello world",
    words: [
      { kind: "unchanged", text: "hello " },
      { kind: "removed", text: "world" },
    ],
  },
  {
    kind: "added",
    marker: "+",
    text: "hello there",
    words: [
      { kind: "unchanged", text: "hello " },
      { kind: "added", text: "there" },
    ],
  },
];

let root: Root | undefined;

function unmount() {
  if (root) {
    act(() => root?.unmount());
    root = undefined;
  }
  document.body.replaceChildren();
}

afterEach(unmount);

/** Monta e devolve o container; `rerender` troca só as props sem recriar a árvore. */
function mount(element: React.ReactElement) {
  unmount();
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(element));
  return {
    container,
    rerender(next: React.ReactElement) {
      act(() => root?.render(next));
    },
  };
}

describe("RevisionDiffPane", () => {
  it("renders the full document in a read-only editor with diff styling", () => {
    const html = renderToStaticMarkup(
      createElement(RevisionDiffPane, {
        emptyLabel: copy.noDifference,
        lines: hunks,
      }),
    );
    expect(html).toContain("keep this");
    expect(html).toContain("hello ");
    expect(html).toContain("world");
    expect(html).toContain("there");
    expect(html).toContain("-");
    expect(html).toContain("+");
    expect(html).not.toContain("~");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("contenteditable");
    expect(html).toContain('data-testid="revision-diff-editor"');
    expect(html).toContain('data-editor-mode="read-only"');
    expect(html).toContain("kastir-diff-line-removed");
    expect(html).toContain("whitespace-pre");
  });

  it("shows the empty copy when there are no lines", () => {
    const html = renderToStaticMarkup(
      createElement(RevisionDiffPane, {
        emptyLabel: copy.noDifference,
        lines: [],
      }),
    );
    expect(html).toContain(copy.noDifference);
  });

  it("shows the identical-content copy instead of the code when nothing changed", () => {
    const { container } = mount(
      createElement(RevisionDiffPane, {
        emptyLabel: copy.noDifference,
        lines: compareRevisionText("<p>same</p>\n", "<p>same</p>\n"),
      }),
    );
    expect(container.textContent).toContain(copy.noDifference);
    expect(
      container.querySelector('[data-testid="revision-diff-editor"]'),
    ).toBeNull();
  });

  it("renders the read-only footer under the code", () => {
    const { container } = mount(
      createElement(RevisionDiffPane, {
        emptyLabel: copy.noDifference,
        footer: "Read-only · 1122334 · Ada",
        lines: hunks,
      }),
    );
    expect(
      container.querySelector('[data-testid="revision-diff-footer"]')
        ?.textContent,
    ).toBe("Read-only · 1122334 · Ada");
  });
});

/* -------------------------------------------------------------------------- */
/* Trechos iguais recolhidos                                                   */
/* -------------------------------------------------------------------------- */

describe("RevisionDiffPane folded unchanged lines", () => {
  const same = (text: string): RevisionDiffLine => ({
    kind: "unchanged",
    marker: " ",
    text,
  });
  const run = (count: number, prefix: string) =>
    Array.from({ length: count }, (_, index) => same(`${prefix}${index}`));
  // 10 iguais, uma troca, 10 iguais: com 2 linhas de contexto sobram 8 escondidas de cada lado.
  const lines: RevisionDiffLine[] = [
    ...run(10, "above-"),
    { kind: "removed", marker: "-", text: "old-line" },
    { kind: "added", marker: "+", text: "new-line" },
    ...run(10, "below-"),
  ];
  const props = {
    emptyLabel: copy.noDifference,
    foldedLabel: copy.foldedLines,
    lines,
  };

  function folds(container: HTMLElement) {
    return [
      ...container.querySelectorAll<HTMLElement>(
        '[data-testid="revision-diff-fold"]',
      ),
    ];
  }

  function visibleText(container: HTMLElement) {
    return container.querySelector(".cm-content")?.textContent ?? "";
  }

  it("collapses long unchanged runs into labelled markers and keeps the changes visible", () => {
    const { container } = mount(createElement(RevisionDiffPane, props));
    expect(folds(container).map((fold) => fold.textContent)).toEqual([
      "⋯ 8 unchanged lines",
      "⋯ 8 unchanged lines",
    ]);
    const text = visibleText(container);
    expect(text).toContain("old-line");
    expect(text).toContain("new-line");
    // Contexto de 2 linhas de cada lado; o miolo fica recolhido.
    expect(text).toContain("above-9");
    expect(text).toContain("below-0");
    expect(text).not.toContain("above-3");
    expect(text).not.toContain("below-5");
  });

  it("keeps the diff markers aligned with the right lines after folding", () => {
    const { container } = mount(createElement(RevisionDiffPane, props));
    // Dentro do editor: o <ol> estático (escondido após a montagem) repete as classes.
    const removed = container.querySelector(
      ".cm-content .kastir-diff-line-removed",
    );
    const added = container.querySelector(
      ".cm-content .kastir-diff-line-added",
    );
    expect(removed?.textContent).toBe("old-line");
    expect(added?.textContent).toBe("new-line");
    // A calha tem um marcador "+" invisível só para reservar largura; não conta.
    const shown = (selector: string) =>
      [...container.querySelectorAll<HTMLElement>(selector)].filter(
        (marker) => marker.style.visibility !== "hidden",
      );
    expect(shown(".kastir-diff-marker-removed")).toHaveLength(1);
    expect(shown(".kastir-diff-marker-added")).toHaveLength(1);
  });

  it("expands one run on click and leaves the other folded", () => {
    const { container } = mount(createElement(RevisionDiffPane, props));
    act(() => folds(container)[0]?.click());

    expect(folds(container)).toHaveLength(1);
    const text = visibleText(container);
    expect(text).toContain("above-0");
    expect(text).toContain("above-3");
    expect(text).not.toContain("below-5");
  });

  it("expands every run when the expand-all signal changes, losing no line", () => {
    const { container, rerender } = mount(
      createElement(RevisionDiffPane, { ...props, expandAllSignal: 0 }),
    );
    expect(folds(container)).toHaveLength(2);

    rerender(createElement(RevisionDiffPane, { ...props, expandAllSignal: 1 }));

    expect(folds(container)).toHaveLength(0);
    const text = visibleText(container);
    for (const line of lines) expect(text).toContain(line.text);
  });

  it("does not expand on mount just because the signal already had a value", () => {
    const { container } = mount(
      createElement(RevisionDiffPane, { ...props, expandAllSignal: 3 }),
    );
    expect(folds(container)).toHaveLength(2);
  });

  it("shows the whole document when no fold label is given (previous behavior)", () => {
    const { container } = mount(
      createElement(RevisionDiffPane, {
        emptyLabel: copy.noDifference,
        lines,
      }),
    );
    expect(folds(container)).toHaveLength(0);
    const text = visibleText(container);
    for (const line of lines) expect(text).toContain(line.text);
  });
});

/* -------------------------------------------------------------------------- */
/* Barra de comparação                                                         */
/* -------------------------------------------------------------------------- */

const version: RevisionHistoryItem = {
  id: "rev-old",
  fingerprint: "11223344556677889900aabbccddeeff",
  authorName: "Grace",
  createdAt: "2026-07-30T12:00:00.000Z",
  pinned: false,
  published: false,
};

// O editor tem "only in the editor"; a versão tem "only in the version".
const editorLines = compareRevisionText(
  "<h1>title</h1>\n<p>only in the editor</p>\n",
  "<h1>title</h1>\n<p>only in the version</p>\n",
);

const formatDateTime = (value: string) => `@${value.slice(0, 10)}`;

function bar(props: Partial<Parameters<typeof RevisionCompareBar>[0]> = {}) {
  return createElement(RevisionCompareBar, {
    copy,
    target: version,
    lines: editorLines,
    fieldChanges: [],
    dirty: false,
    draftFingerprint: "ffffffffffffffffffffffffffffffff",
    formatDateTime,
    onRestore: () => undefined,
    onBack: () => undefined,
    ...props,
  });
}

function buttonByText(root: ParentNode, text: string) {
  return [...root.querySelectorAll("button")].find(
    (button) => button.textContent === text,
  );
}

function dialog() {
  return document.body.querySelector<HTMLElement>(
    '[data-slot="dialog-content"]',
  );
}

describe("RevisionCompareBar direction and counts", () => {
  it("states the direction draft → version, the line counts and the legend", () => {
    const { container } = mount(bar());
    const text = container.textContent ?? "";

    expect(text).toContain(copy.compareTitle);
    expect(text).toContain(copy.compareDraftBadge);
    expect(
      container.querySelector('[data-testid="revision-compare-target"]')
        ?.textContent,
    ).toBe("@2026-07-30 · Grace");
    // Uma linha sai do rascunho (-) e uma volta com a versão (+).
    expect(
      container.querySelector('[data-testid="revision-compare-stats"]')
        ?.textContent,
    ).toBe("+1 −1 lines");
    // A legenda explica cada marcador com o caractere, não só com cor.
    expect(text).toContain(`−${copy.legendRemoved}`);
    expect(text).toContain(`+${copy.legendAdded}`);
  });

  it("marks the published version as Live or Published according to the item state", () => {
    const published = { ...version, published: true };
    const live = mount(bar({ target: published, live: true }));
    expect(
      live.container.querySelector('[data-testid="revision-compare-target"]')
        ?.textContent,
    ).toBe(`${copy.live} · @2026-07-30 · Grace`);

    const offline = mount(bar({ target: published, live: false }));
    expect(
      offline.container.querySelector('[data-testid="revision-compare-target"]')
        ?.textContent,
    ).toBe(`${copy.publishedOffline} · @2026-07-30 · Grace`);
  });
});

describe("RevisionCompareBar other fields", () => {
  const pageCurrent: PageFieldValues = {
    title: "Black Friday",
    slug: "black-friday",
    folderId: "folder-a",
    seoTitle: "Black Friday | Store",
    seoDescription: "Up to 50% off.",
    seoKeyword: "sale",
  };
  const scriptCurrent: ScriptFieldValues = {
    name: "Chat widget",
    location: "HEADER",
    priority: 1,
    scopeType: "ALL_PAGES",
    pageIds: [],
    triggerType: null,
    triggerConfig: null,
    maxDisplays: null,
    displayResetDays: null,
  };

  it("says only the code changes when no other field differs", () => {
    const { container } = mount(bar());
    expect(container.textContent).toContain(copy.otherFieldsTitle);
    expect(container.textContent).toContain(copy.otherFieldsNone);
    expect(
      container.querySelector('[data-testid^="revision-field-"]'),
    ).toBeNull();
  });

  it("lists every changed Pages field with the current value struck and the version value", () => {
    const fieldChanges = pageFieldChanges({
      copy,
      current: pageCurrent,
      version: {
        title: "Cyber Monday",
        slug: "cyber-monday",
        folderId: "folder-b",
        seoTitle: "Cyber",
        seoDescription: "Half price.",
        seoKeyword: "deals",
      },
      folderLabel: (id) => (id === "folder-a" ? "Campaigns" : "Archive"),
    });
    const { container } = mount(bar({ fieldChanges }));

    const rows = [
      ...container.querySelectorAll('[data-testid^="revision-field-"]'),
    ];
    expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual([
      "revision-field-name",
      "revision-field-slug",
      "revision-field-folder",
      "revision-field-seoTitle",
      "revision-field-seoDescription",
      "revision-field-seoKeyword",
    ]);
    const folder = container.querySelector(
      '[data-testid="revision-field-folder"]',
    );
    expect(folder?.textContent).toContain("Folder");
    expect(folder?.querySelector("del")?.textContent).toBe("Campaigns");
    expect(folder?.querySelector("ins")?.textContent).toBe("Archive");
    expect(container.textContent).not.toContain(copy.otherFieldsNone);
  });

  it("lists every changed Scripts field", () => {
    const fieldChanges = scriptFieldChanges({
      copy,
      labels: dictionary.customCode,
      current: scriptCurrent,
      version: {
        name: "Support chat",
        location: "BODY_END",
        priority: 5,
        scopeType: "SPECIFIC_PAGES",
        pageIds: ["page-1"],
        triggerType: "SCROLL",
        triggerConfig: { percentage: 40 },
        maxDisplays: 3,
        displayResetDays: 30,
      },
      pageName: () => "Pricing",
    });
    const { container } = mount(bar({ fieldChanges }));

    const keys = [
      ...container.querySelectorAll('[data-testid^="revision-field-"]'),
    ].map((row) => row.getAttribute("data-testid"));
    expect(keys).toEqual([
      "revision-field-name",
      "revision-field-location",
      "revision-field-priority",
      "revision-field-scope",
      "revision-field-scopedPages",
      "revision-field-trigger",
      "revision-field-triggerConfig",
      "revision-field-maxDisplays",
      "revision-field-displayResetDays",
    ]);
  });
});

describe("RevisionCompareBar restore availability", () => {
  it("disables Restore with the reason text while there are unsaved changes", () => {
    const { container } = mount(bar({ dirty: true }));
    const restore = buttonByText(container, copy.restoreAction);
    expect(restore?.hasAttribute("disabled")).toBe(true);
    const reason = container.querySelector(
      '[data-testid="revision-restore-reason"]',
    );
    expect(reason?.textContent).toBe(copy.restoreBlockedDirty);
    // O motivo está ligado ao botão para quem usa leitor de tela.
    expect(restore?.getAttribute("aria-describedby")).toBe(reason?.id);
  });

  it("disables Restore when the version is identical to the saved draft", () => {
    const { container } = mount(bar({ draftFingerprint: version.fingerprint }));
    expect(
      buttonByText(container, copy.restoreAction)?.hasAttribute("disabled"),
    ).toBe(true);
    expect(
      container.querySelector('[data-testid="revision-restore-reason"]')
        ?.textContent,
    ).toBe(copy.restoreBlockedIdentical);
  });

  it("gives unsaved changes precedence over an identical version", () => {
    const { container } = mount(
      bar({ dirty: true, draftFingerprint: version.fingerprint }),
    );
    expect(
      container.querySelector('[data-testid="revision-restore-reason"]')
        ?.textContent,
    ).toBe(copy.restoreBlockedDirty);
  });

  it("enables Restore without a reason when the form is clean and the version differs", () => {
    const { container } = mount(bar());
    expect(
      buttonByText(container, copy.restoreAction)?.hasAttribute("disabled"),
    ).toBe(false);
    expect(
      container.querySelector('[data-testid="revision-restore-reason"]'),
    ).toBeNull();
  });

  it("keeps both actions disabled while a request is in flight", () => {
    const { container } = mount(bar({ busy: true }));
    expect(
      buttonByText(container, copy.restoreAction)?.hasAttribute("disabled"),
    ).toBe(true);
    expect(
      buttonByText(container, copy.backToEditing)?.hasAttribute("disabled"),
    ).toBe(true);
  });

  it("goes back to editing", () => {
    const onBack = vi.fn();
    const { container } = mount(bar({ onBack }));
    act(() => buttonByText(container, copy.backToEditing)?.click());
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe("RevisionCompareBar expand all", () => {
  const same = (text: string): RevisionDiffLine => ({
    kind: "unchanged",
    marker: " ",
    text,
  });
  const foldable: RevisionDiffLine[] = [
    ...Array.from({ length: 10 }, (_, index) => same(`a${index}`)),
    { kind: "removed", marker: "-", text: "x" },
    { kind: "added", marker: "+", text: "y" },
  ];

  it("is disabled when nothing is folded and enabled when there is something to expand", () => {
    const onExpandAll = vi.fn();
    const short = mount(bar({ onExpandAll }));
    expect(
      buttonByText(short.container, copy.expandAll)?.hasAttribute("disabled"),
    ).toBe(true);

    const long = mount(bar({ lines: foldable, onExpandAll }));
    const button = buttonByText(long.container, copy.expandAll);
    expect(button?.hasAttribute("disabled")).toBe(false);
    act(() => button?.click());
    expect(onExpandAll).toHaveBeenCalledTimes(1);
  });
});

describe("RevisionCompareBar restore confirmation", () => {
  const fieldChanges = pageFieldChanges({
    copy,
    current: {
      title: "Black Friday",
      slug: "black-friday",
      folderId: "folder-a",
      seoTitle: null,
      seoDescription: null,
      seoKeyword: null,
    },
    version: {
      title: "Cyber Monday",
      slug: "black-friday",
      folderId: "folder-a",
      seoTitle: null,
      seoDescription: null,
      seoKeyword: null,
    },
  });

  function openConfirmation(
    props: Partial<Parameters<typeof RevisionCompareBar>[0]> = {},
  ) {
    const view = mount(bar({ fieldChanges, ...props }));
    act(() => buttonByText(view.container, copy.restoreAction)?.click());
    expect(dialog()).not.toBeNull();
    return view;
  }

  it("lists the code counts and every changed field before confirming", () => {
    openConfirmation();
    const content = dialog()!;
    expect(content.textContent).toContain(
      "Restore the version from @2026-07-30 (Grace)?",
    );
    expect(content.textContent).toContain(copy.confirmRestoreDescription);
    const items = [
      ...content.querySelectorAll('[data-testid="revision-restore-list"] li'),
    ].map((item) => item.textContent);
    expect(items).toEqual(["Code: +1 / −1 lines", "Name: Cyber Monday"]);
  });

  it("warns that saved unpublished changes will be replaced only when there are some", () => {
    openConfirmation({ replacesUnpublished: true });
    expect(
      dialog()?.querySelector('[data-testid="revision-restore-warning"]')
        ?.textContent,
    ).toBe(copy.restoreConfirmUnpublishedWarning);

    openConfirmation({ replacesUnpublished: false });
    expect(
      dialog()?.querySelector('[data-testid="revision-restore-warning"]'),
    ).toBeNull();
  });

  it("restores once on confirm and closes the dialog afterwards", async () => {
    const onRestore = vi.fn(async () => ({ page: { id: "p1" } }));
    openConfirmation({ onRestore });

    await act(async () => {
      buttonByText(dialog()!, copy.restore)?.click();
    });

    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
  });

  it("closes the dialog even when the restore fails (the conflict shows in the versions block)", async () => {
    const onRestore = vi.fn(async () => null);
    openConfirmation({ onRestore });

    await act(async () => {
      buttonByText(dialog()!, copy.restore)?.click();
    });

    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
  });

  it("restores nothing when the confirmation is cancelled", () => {
    const onRestore = vi.fn();
    openConfirmation({ onRestore });

    act(() => buttonByText(dialog()!, copy.cancel)?.click());

    expect(onRestore).not.toHaveBeenCalled();
  });
});
