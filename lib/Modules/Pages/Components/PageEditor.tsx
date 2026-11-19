"use client";

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { html } from "@codemirror/lang-html";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { lintKeymap } from "@codemirror/lint";
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  highlightSelectionMatches,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
  SearchQuery,
  searchKeymap,
  setSearchQuery,
} from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import {
  crosshairCursor,
  Decoration,
  type DecorationSet,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder as editorPlaceholder,
  rectangularSelection,
  runScopeHandlers,
  ViewPlugin,
  type Panel,
  type ViewUpdate,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";

import { MediaPickerDialog } from "@/components/Shared/MediaPickerDialog";

import {
  findMediaReferenceRanges,
  type MediaReferenceRange,
} from "./mediaReferenceRanges";

// VS Code Dark+ / One Dark inspired palette — same hex family in both panel
// themes since the syntax highlight sits on top of the shared card background,
// not the OS light/dark toggle.
const SYNTAX_COLORS = {
  tag: "#569cd6",
  attribute: "#9cdcfe",
  string: "#ce9178",
  comment: "#6a9955",
  keyword: "#c586c0",
  number: "#b5cea8",
};

export const syntaxHighlightStyle = HighlightStyle.define([
  { tag: tags.tagName, color: SYNTAX_COLORS.tag },
  { tag: tags.angleBracket, color: SYNTAX_COLORS.tag },
  { tag: tags.attributeName, color: SYNTAX_COLORS.attribute },
  { tag: tags.attributeValue, color: SYNTAX_COLORS.string },
  { tag: tags.string, color: SYNTAX_COLORS.string },
  { tag: tags.comment, color: SYNTAX_COLORS.comment, fontStyle: "italic" },
  { tag: tags.keyword, color: SYNTAX_COLORS.keyword },
  { tag: tags.number, color: SYNTAX_COLORS.number },
]);

/**
 * Tema compartilhado pelos editores de código editável e de revisão.
 * O diff usa as mesmas cores de sintaxe; só acrescenta acentos de linha/gutter.
 */
export function createPanelEditorTheme(dark: boolean, fill = false) {
  return EditorView.theme(
    {
      "&": {
        color: "var(--foreground)",
        backgroundColor: "var(--card)",
        // fill: ocupa a coluna inteira do Pages EDIT (não trava em 28rem).
        height: fill ? "100%" : "28rem",
        minHeight: fill ? "100%" : "28rem",
        fontSize: "0.875rem",
        position: "relative",
      },
      "&.cm-focused": {
        outline: "none",
      },
      // Float the search panel over the top-right corner instead of the
      // default sticky bar, which reserves flow height and pushes content.
      ".cm-panels.cm-panels-top": {
        position: "absolute",
        top: "0.5rem",
        right: "0.5rem",
        left: "auto",
        width: "auto",
        border: "none",
        background: "transparent",
        zIndex: "20",
      },
      ".cm-scroller": {
        overflow: "auto",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        lineHeight: "1.55",
        ...(fill ? { height: "100%", minHeight: "100%" } : {}),
      },
      ".cm-content": {
        caretColor: "var(--foreground)",
        minHeight: fill ? "100%" : "28rem",
        padding: "0.75rem 0",
      },
      ".cm-line": {
        padding: "0 0.75rem",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "var(--foreground)",
      },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
        {
          backgroundColor:
            "color-mix(in oklab, var(--foreground) 22%, transparent)",
        },
      ".cm-activeLine": {
        backgroundColor:
          "color-mix(in oklab, var(--foreground) 6%, transparent)",
      },
      ".cm-gutters": {
        backgroundColor: "var(--muted)",
        color: "var(--muted-foreground)",
        border: "none",
        borderRight: "1px solid var(--border)",
      },
      // O marcador fica em um gutter separado para não inserir caracteres no
      // documento e preservar a indentação original do código revisado.
      ".kastir-diff-gutter": {
        backgroundColor: "var(--muted)",
        color: "var(--muted-foreground)",
        borderRight: "1px solid var(--border)",
        minWidth: "1.25rem",
        textAlign: "center",
      },
      ".kastir-diff-marker-added": {
        color: "var(--color-brand)",
        fontWeight: "700",
      },
      ".kastir-diff-marker-removed": {
        color: "var(--destructive)",
        fontWeight: "700",
      },
      ".kastir-diff-line-added": {
        backgroundColor:
          "color-mix(in oklab, var(--color-brand) 12%, transparent)",
      },
      ".kastir-diff-line-removed": {
        backgroundColor:
          "color-mix(in oklab, var(--destructive) 12%, transparent)",
      },
      ".kastir-diff-word-added": {
        backgroundColor:
          "color-mix(in oklab, var(--color-brand) 28%, transparent)",
      },
      ".kastir-diff-word-removed": {
        backgroundColor:
          "color-mix(in oklab, var(--destructive) 28%, transparent)",
      },
      ".cm-activeLineGutter": {
        backgroundColor:
          "color-mix(in oklab, var(--foreground) 6%, transparent)",
        color: "var(--foreground)",
      },
      ".cm-placeholder": {
        color: "var(--muted-foreground)",
        fontStyle: "italic",
      },
      ".kastir-search-panel": {
        display: "flex",
        flexDirection: "column",
        gap: "0.375rem",
        padding: "0.375rem 0.5rem",
        borderRadius: "0.5rem",
        border: "1px solid var(--border)",
        background: "var(--card)",
        boxShadow: "0 2px 10px rgba(0, 0, 0, 0.15)",
      },
      ".kastir-search-panel__row, .kastir-search-panel__advanced": {
        display: "flex",
        alignItems: "center",
        gap: "0.25rem",
        flexWrap: "wrap",
      },
      ".kastir-search-panel__field": {
        color: "var(--foreground)",
        backgroundColor: "var(--background)",
        border: "1px solid var(--border)",
        borderRadius: "0.25rem",
        padding: "0.125rem 0.375rem",
        fontSize: "0.8125rem",
        width: "9rem",
      },
      ".kastir-search-panel__count": {
        color: "var(--muted-foreground)",
        fontSize: "0.75rem",
        minWidth: "1.5rem",
        textAlign: "center",
      },
      ".kastir-search-panel__button": {
        color: "var(--foreground)",
        background: "transparent",
        border: "1px solid transparent",
        borderRadius: "0.25rem",
        padding: "0.125rem 0.375rem",
        cursor: "pointer",
        fontSize: "0.8125rem",
      },
      ".kastir-search-panel__button:hover": {
        background: "color-mix(in oklab, var(--foreground) 8%, transparent)",
      },
      ".kastir-search-panel__checkbox": {
        display: "inline-flex",
        alignItems: "center",
        gap: "0.25rem",
        color: "var(--muted-foreground)",
        fontSize: "0.75rem",
      },
      ".kastir-media-ref": {
        cursor: "pointer",
        textDecoration: "underline",
        textDecorationStyle: "dotted",
        textUnderlineOffset: "2px",
      },
    },
    { dark },
  );
}

/** Mantém o termo escolhido ao reabrir a busca, mesmo após substituir o texto selecionado. */
export function shouldPreserveSearchQuery(
  previousQuery: SearchQuery,
  nextQuery: SearchQuery,
): boolean {
  // Query vazia permite que o CodeMirror derive o termo da seleção atual.
  return previousQuery.search.length > 0 && !nextQuery.eq(previousQuery);
}

function openSearchPanelPreservingQuery(view: EditorView): boolean {
  const previousQuery = getSearchQuery(view.state);
  const handled = openSearchPanel(view);

  // O CodeMirror usa a seleção atual como novo termo; depois de um replace-all,
  // isso pode trocar "hello" pelo texto de reposição e perder a intenção da busca.
  if (shouldPreserveSearchQuery(previousQuery, getSearchQuery(view.state))) {
    view.dispatch({ effects: setSearchQuery.of(previousQuery) });
  }

  return handled;
}

/**
 * Custom search panel: default state exposes only field + match count +
 * previous/next + close (4 controls) — replace and case/regex/whole-word
 * live behind a discrete toggle, closed by default. Positioned top-right via
 * `.cm-panels.cm-panels-top` overrides in `createPanelEditorTheme`.
 */
function buildSearchPanel(view: EditorView): Panel {
  const initialQuery = getSearchQuery(view.state);
  let lastQuery = initialQuery;

  const dom = document.createElement("div");
  dom.className = "kastir-search-panel";
  dom.setAttribute("role", "search");
  dom.setAttribute("aria-label", "Find in editor");

  function button(label: string, ariaLabel: string, onClick: () => void) {
    const el = document.createElement("button");
    el.type = "button";
    el.textContent = label;
    el.setAttribute("aria-label", ariaLabel);
    el.className = "kastir-search-panel__button";
    el.addEventListener("click", onClick);
    return el;
  }

  function textField(value: string, ariaLabel: string) {
    const el = document.createElement("input");
    el.type = "text";
    el.value = value;
    el.placeholder = ariaLabel;
    el.setAttribute("aria-label", ariaLabel);
    el.className = "kastir-search-panel__field";
    return el;
  }

  function checkbox(labelText: string, ariaLabel: string, checked: boolean) {
    const label = document.createElement("label");
    label.className = "kastir-search-panel__checkbox";
    label.title = ariaLabel;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.setAttribute("aria-label", ariaLabel);
    label.append(input, document.createTextNode(labelText));
    return { label, input };
  }

  const searchField = textField(initialQuery.search, "Find");
  // CodeMirror usa este marcador para focar o campo principal ao abrir o painel.
  searchField.setAttribute("main-field", "true");
  const countLabel = document.createElement("span");
  countLabel.className = "kastir-search-panel__count";
  countLabel.setAttribute("aria-live", "polite");

  const prevButton = button("‹", "Previous match", () => findPrevious(view));
  const nextButton = button("›", "Next match", () => findNext(view));
  const closeButton = button("×", "Close search", () => {
    closeSearchPanel(view);
    view.focus();
  });

  const advancedRow = document.createElement("div");
  advancedRow.className = "kastir-search-panel__advanced";
  advancedRow.hidden = true;

  const toggleButton = button("⋯", "Toggle search options", () => {
    advancedRow.hidden = !advancedRow.hidden;
    toggleButton.setAttribute("aria-expanded", String(!advancedRow.hidden));
  });
  toggleButton.setAttribute("aria-expanded", "false");

  const replaceField = textField(initialQuery.replace, "Replace");
  const replaceButton = button("Replace", "Replace next match", () =>
    replaceNext(view),
  );
  const replaceAllButton = button("Replace all", "Replace all matches", () =>
    replaceAll(view),
  );
  const caseSensitive = checkbox(
    "Aa",
    "Match case",
    initialQuery.caseSensitive,
  );
  const regexp = checkbox(".*", "Regular expression", initialQuery.regexp);
  const wholeWord = checkbox("Ab", "Whole word", initialQuery.wholeWord);

  const mainRow = document.createElement("div");
  mainRow.className = "kastir-search-panel__row";
  mainRow.append(
    searchField,
    countLabel,
    prevButton,
    nextButton,
    toggleButton,
    closeButton,
  );

  advancedRow.append(
    replaceField,
    replaceButton,
    replaceAllButton,
    caseSensitive.label,
    regexp.label,
    wholeWord.label,
  );

  dom.append(mainRow, advancedRow);

  function currentQuery(): SearchQuery {
    return new SearchQuery({
      search: searchField.value,
      replace: replaceField.value,
      caseSensitive: caseSensitive.input.checked,
      regexp: regexp.input.checked,
      wholeWord: wholeWord.input.checked,
    });
  }

  function commit() {
    const query = currentQuery();
    // Do not touch `lastQuery` here — `update()` below is the single place
    // that syncs it, from the effect this dispatch produces. Setting it
    // eagerly would make the eq-check there always pass and the count/field
    // sync would silently never run.
    if (query.eq(lastQuery)) return;
    view.dispatch({ effects: setSearchQuery.of(query) });
  }

  function updateCount() {
    const query = getSearchQuery(view.state);
    if (!query.valid) {
      countLabel.textContent = "";
      return;
    }
    let count = 0;
    const cursor = query.getCursor(view.state);
    while (!cursor.next().done && count < 1000) count += 1;
    countLabel.textContent = String(count);
  }

  for (const field of [searchField, replaceField]) {
    field.addEventListener("input", commit);
  }
  for (const { input } of [caseSensitive, regexp, wholeWord]) {
    input.addEventListener("change", commit);
  }

  dom.addEventListener("keydown", (event) => {
    if (runScopeHandlers(view, event, "search-panel")) {
      event.preventDefault();
      return;
    }
    if (event.key === "Enter" && event.target === searchField) {
      event.preventDefault();
      (event.shiftKey ? findPrevious : findNext)(view);
    } else if (event.key === "Enter" && event.target === replaceField) {
      event.preventDefault();
      replaceNext(view);
    }
  });

  updateCount();

  return {
    dom,
    top: true,
    mount() {
      searchField.focus();
      searchField.select();
    },
    update(update) {
      let queryChanged = false;
      for (const tr of update.transactions) {
        for (const effect of tr.effects) {
          if (effect.is(setSearchQuery) && !effect.value.eq(lastQuery)) {
            lastQuery = effect.value;
            searchField.value = lastQuery.search;
            replaceField.value = lastQuery.replace;
            caseSensitive.input.checked = lastQuery.caseSensitive;
            regexp.input.checked = lastQuery.regexp;
            wholeWord.input.checked = lastQuery.wholeWord;
            queryChanged = true;
          }
        }
      }
      if (queryChanged || update.docChanged) updateCount();
    },
  };
}

const mediaReferenceMark = Decoration.mark({
  class: "kastir-media-ref",
  attributes: { title: "Click to choose from the Media Library" },
});

function buildMediaReferenceDecorations(
  doc: string,
  ranges: MediaReferenceRange[],
): DecorationSet {
  return Decoration.set(
    ranges
      .filter((range) => range.from < range.to && range.to <= doc.length)
      .map((range) => mediaReferenceMark.range(range.from, range.to)),
  );
}

/**
 * Detects `<img src="...">` and CSS `url(...)` references and makes them
 * clickable — click opens the Media Library (via `onClick`) to swap just the
 * URL, leaving the rest of the tag untouched.
 */
function mediaReferenceExtension(
  onClick: (range: MediaReferenceRange) => void,
) {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      ranges: MediaReferenceRange[];

      constructor(view: EditorView) {
        this.ranges = findMediaReferenceRanges(view.state.doc.toString());
        this.decorations = buildMediaReferenceDecorations(
          view.state.doc.toString(),
          this.ranges,
        );
      }

      update(update: ViewUpdate) {
        if (!update.docChanged) return;
        const doc = update.state.doc.toString();
        this.ranges = findMediaReferenceRanges(doc);
        this.decorations = buildMediaReferenceDecorations(doc, this.ranges);
      }
    },
    { decorations: (instance) => instance.decorations },
  );

  const clickHandler = EditorView.domEventHandlers({
    mousedown(event, view) {
      // Não depender de `.kastir-media-ref` no DOM: o highlight de sintaxe
      // (spans ͼ*) fica por cima do mark e o target do clique não é o mark.
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null) return false;
      const ranges =
        view.plugin(plugin)?.ranges ??
        findMediaReferenceRanges(view.state.doc.toString());
      const range = ranges.find((r) => pos >= r.from && pos <= r.to);
      if (!range) return false;
      event.preventDefault();
      // mousedown abre o dialog; o `click` residual fecharia via outside-dismiss.
      const swallow = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
        document.removeEventListener("click", swallow, true);
      };
      document.addEventListener("click", swallow, true);
      onClick(range);
      return true;
    },
  });

  return [plugin, clickHandler];
}

function isDocumentDark(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

export function PageEditor({
  value,
  onChange,
  ariaLabel = "Page HTML, CSS and JavaScript content",
  placeholder = "Paste or type HTML, CSS and JavaScript here…",
  /** Preenche o painel pai (Pages EDIT) em vez da altura fixa de 28rem. */
  fill = false,
  /**
   * Textos do seletor de imagem. Título e confirmar têm padrão em inglês; cancelar (rodapé) e
   * fechar (X do canto) são obrigatórios e separados, como no `ConfirmDialog` (fase 4, A3). O
   * editor não recebe o dicionário do painel, então quem o usa passa os rótulos, como `ariaLabel`
   * e `placeholder`.
   */
  mediaTitle = "Choose image",
  mediaSelectLabel = "Select",
  mediaCancelLabel,
  mediaCloseLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  placeholder?: string;
  fill?: boolean;
  mediaTitle?: string;
  mediaSelectLabel?: string;
  mediaCancelLabel: string;
  mediaCloseLabel: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const initialValueRef = useRef(value);
  const ariaLabelRef = useRef(ariaLabel);
  const placeholderRef = useRef(placeholder);
  const fillRef = useRef(fill);
  const [mediaRange, setMediaRange] = useState<MediaReferenceRange | null>(
    null,
  );
  const mediaClickRef = useRef<(range: MediaReferenceRange) => void>(
    () => undefined,
  );

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    fillRef.current = fill;
  }, [fill]);

  useEffect(() => {
    mediaClickRef.current = (range: MediaReferenceRange) => {
      flushSync(() => setMediaRange(range));
    };
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const themeCompartment = new Compartment();
    const fillMode = fillRef.current;

    const state = EditorState.create({
      doc: initialValueRef.current,
      extensions: [
        // Recomposed from `basicSetup` (codemirror package) minus its default
        // searchKeymap-driven panel — search() below supplies our own panel
        // via createPanel instead of the built-in "cheio de botão" one.
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        search({ createPanel: buildSearchPanel, top: true }),
        keymap.of([
          { key: "Mod-f", run: openSearchPanelPreservingQuery },
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap.filter(({ key }) => key !== "Mod-f"),
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
          ...lintKeymap,
        ]),
        html(),
        syntaxHighlighting(syntaxHighlightStyle),
        mediaReferenceExtension((range) => mediaClickRef.current(range)),
        keymap.of([indentWithTab]),
        editorPlaceholder(placeholderRef.current),
        themeCompartment.of(createPanelEditorTheme(isDocumentDark(), fillMode)),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: container });
    view.dom.setAttribute("role", "textbox");
    view.dom.setAttribute("aria-multiline", "true");
    view.dom.setAttribute("aria-label", ariaLabelRef.current);
    viewRef.current = view;

    const themeObserver = new MutationObserver(() => {
      view.dispatch({
        effects: themeCompartment.reconfigure(
          createPanelEditorTheme(isDocumentDark(), fillRef.current),
        ),
      });
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      themeObserver.disconnect();
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
  }, [value]);

  return (
    <div
      className={
        fill
          ? "flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-transparent"
          : "border-border bg-card text-card-foreground overflow-hidden rounded-lg border"
      }
    >
      <div
        className={
          fill
            ? // Cadeia h-full até o .cm-editor — preenche a coluna do DetailsPanel.
              "flex min-h-0 flex-1 cursor-text flex-col [&_.cm-editor]:h-full [&_.cm-editor]:min-h-0"
            : "min-h-[28rem] cursor-text [&_.cm-editor]:h-[28rem] [&_.cm-editor]:max-h-[28rem]"
        }
        onClick={() => viewRef.current?.focus()}
      >
        <div
          className={fill ? "min-h-0 flex-1 [&_.cm-editor]:h-full" : undefined}
          ref={containerRef}
        />
      </div>

      <MediaPickerDialog
        cancelLabel={mediaCancelLabel}
        closeLabel={mediaCloseLabel}
        open={mediaRange !== null}
        selectedId=""
        selectLabel={mediaSelectLabel}
        title={mediaTitle}
        onOpenChange={(open) => {
          if (!open) setMediaRange(null);
        }}
        onSelect={(item) => {
          const view = viewRef.current;
          if (view && mediaRange) {
            view.dispatch({
              changes: {
                from: mediaRange.from,
                to: mediaRange.to,
                insert: item.url,
              },
            });
          }
          setMediaRange(null);
        }}
      />
    </div>
  );
}
