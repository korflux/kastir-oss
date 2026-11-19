"use client";

/**
 * Painel do diff de uma versão (Pages e Scripts compartilham).
 *
 * Seções deste arquivo:
 *   1. Marcadores e decorações de diff (`-` / `+` na calha, cor de linha e de palavra).
 *   2. Trechos iguais recolhidos: pontos de dobra por cima do documento inteiro.
 *   3. `RevisionDiffPane`: monta o CodeMirror somente leitura e o fallback estático.
 *
 * O documento do CodeMirror contém TODAS as linhas do diff. Os trechos iguais longos são
 * dobras (fold) por cima dele, não linhas removidas: assim `state.doc.line(index + 1)` continua
 * casando com `lines[index]`, e expandir (um trecho, ou todos) nunca perde conteúdo.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { html } from "@codemirror/lang-html";
import {
  codeFolding,
  defaultHighlightStyle,
  foldEffect,
  foldGutter,
  syntaxHighlighting,
  unfoldAll,
} from "@codemirror/language";
import {
  EditorState,
  RangeSet,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  gutter,
  GutterMarker,
  lineNumbers,
} from "@codemirror/view";

import {
  createPanelEditorTheme,
  syntaxHighlightStyle,
} from "@/lib/Modules/Pages/Components/PageEditor";
import { fillRevisionCopy } from "@/lib/Modules/Revisions/Components/RevisionHistoryPanel";
import {
  foldRevisionDiff,
  type RevisionDiffLine,
} from "@/lib/Modules/Revisions/diff";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* 1. Marcadores e decorações de diff                                          */
/* -------------------------------------------------------------------------- */

const setRevisionDiffLines = StateEffect.define<RevisionDiffLine[]>();

/** Marcador `-` / `+` na calha: o sinal fica como caractere, não só como cor da linha. */
class RevisionDiffGutterMarker extends GutterMarker {
  constructor(
    private readonly marker: "-" | "+",
    private readonly spacer = false,
  ) {
    super();
  }

  eq(other: GutterMarker): boolean {
    return (
      other instanceof RevisionDiffGutterMarker &&
      other.marker === this.marker &&
      other.spacer === this.spacer
    );
  }

  toDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className =
      this.marker === "+"
        ? "kastir-diff-marker-added"
        : "kastir-diff-marker-removed";
    element.textContent = this.marker;
    if (this.spacer) element.style.visibility = "hidden";
    return element;
  }
}

/**
 * Classe de linha (`kastir-diff-line-*`) e destaque de palavras do diff. O índice da linha do
 * diff é o da linha do documento (`index + 1`), já que o documento tem todas as linhas.
 */
function buildDiffDecorations(
  state: EditorState,
  lines: RevisionDiffLine[],
): DecorationSet {
  const decorations = [];
  for (const [index, line] of lines.entries()) {
    const documentLine = state.doc.line(index + 1);
    const lineClass = `kastir-diff-line-${line.kind}`;
    decorations.push(
      Decoration.line({ attributes: { class: lineClass } }).range(
        documentLine.from,
      ),
    );

    let offset = documentLine.from;
    for (const word of line.words ?? []) {
      const end = offset + word.text.length;
      if (word.kind !== "unchanged" && end > offset) {
        decorations.push(
          Decoration.mark({
            class: `kastir-diff-word-${word.kind}`,
          }).range(offset, end),
        );
      }
      offset = end;
    }
  }
  return Decoration.set(decorations, true);
}

/** Um marcador na calha para cada linha removida ou adicionada (as iguais ficam sem). */
function buildDiffGutterMarkers(
  state: EditorState,
  lines: RevisionDiffLine[],
): RangeSet<GutterMarker> {
  const markers = new RangeSetBuilder<GutterMarker>();
  for (const [index, line] of lines.entries()) {
    if (line.marker === " ") continue;
    const documentLine = state.doc.line(index + 1);
    markers.add(
      documentLine.from,
      documentLine.from,
      new RevisionDiffGutterMarker(line.marker),
    );
  }
  return markers.finish();
}

/** Guarda as decorações do diff; recalcula quando o painel envia um diff novo. */
const revisionDiffDecorations = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setRevisionDiffLines)) {
        next = buildDiffDecorations(transaction.state, effect.value);
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Guarda os marcadores da calha; recalcula junto com as decorações. */
const revisionDiffGutterMarkers = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setRevisionDiffLines)) {
        return buildDiffGutterMarkers(transaction.state, effect.value);
      }
    }
    return value;
  },
});

/** Calha própria do diff: não insere caracteres no documento e preserva a indentação. */
const revisionDiffGutter = gutter({
  class: "kastir-diff-gutter",
  initialSpacer: () => new RevisionDiffGutterMarker("+", true),
  markers: (view) => view.state.field(revisionDiffGutterMarkers),
});

/** Texto do documento do CodeMirror: todas as linhas do diff, na ordem. */
function diffDocument(lines: RevisionDiffLine[]): string {
  return lines.map((line) => line.text).join("\n");
}

/* -------------------------------------------------------------------------- */
/* 2. Trechos iguais recolhidos                                                */
/* -------------------------------------------------------------------------- */

/** Aparência do marcador "⋯ N linhas iguais" (o tema do painel não conhece essa classe). */
const foldedLinesTheme = EditorView.theme({
  ".kastir-diff-fold": {
    cursor: "pointer",
    border: "none",
    background: "transparent",
    padding: "0",
    font: "inherit",
    fontStyle: "italic",
    color: "var(--muted-foreground)",
    textDecoration: "underline dotted",
  },
  ".kastir-diff-fold:hover": { color: "var(--foreground)" },
  ".kastir-diff-fold:focus-visible": {
    outline: "2px solid var(--ring)",
    outlineOffset: "2px",
  },
});

/**
 * Dado sobre uma dobra, calculado quando ela é criada: quantas linhas esconde e se são todas
 * iguais (nossas dobras) ou se é uma dobra de sintaxe do HTML feita pelo usuário na calha.
 */
type FoldInfo = { count: number; allUnchanged: boolean };

/**
 * Configura como as dobras aparecem: as de linhas iguais viram um botão "⋯ N linhas iguais"
 * (clicar abre aquele trecho); as de sintaxe seguem com o "…" padrão, porque dizer "linhas
 * iguais" sobre um bloco que tem alteração seria mentira.
 */
function foldedLinesConfig(lines: RevisionDiffLine[], foldedLabel: string) {
  return codeFolding({
    preparePlaceholder: (state, range): FoldInfo => {
      const first = state.doc.lineAt(range.from).number;
      const last = state.doc.lineAt(range.to).number;
      let allUnchanged = true;
      for (let number = first; number <= last; number += 1) {
        if (lines[number - 1]?.kind !== "unchanged") {
          allUnchanged = false;
          break;
        }
      }
      return { count: last - first + 1, allUnchanged };
    },
    placeholderDOM: (_view, onclick, prepared: FoldInfo) => {
      if (!prepared.allUnchanged) {
        const element = document.createElement("span");
        element.className = "cm-foldPlaceholder";
        element.textContent = "…";
        element.addEventListener("click", onclick);
        return element;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "kastir-diff-fold";
      button.setAttribute("aria-expanded", "false");
      button.dataset.testid = "revision-diff-fold";
      button.textContent = `⋯ ${fillRevisionCopy(foldedLabel, { count: prepared.count })}`;
      button.addEventListener("click", onclick);
      return button;
    },
  });
}

/* -------------------------------------------------------------------------- */
/* 3. Painel                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Diff somente leitura. Com `foldedLabel`, trechos iguais longos (mais de 2 linhas além de
 * cada alteração) entram recolhidos em marcadores clicáveis; `expandAllSignal` (um número que
 * o dono incrementa, ver `useRevisionHistory.expandAll`) abre todos de uma vez. Sem
 * `foldedLabel` o documento aparece inteiro, como sempre foi.
 *
 * Sem nenhuma linha alterada (conteúdo idêntico, ou vazio) mostra `emptyLabel` no lugar do
 * código.
 */
export function RevisionDiffPane({
  lines,
  emptyLabel,
  ariaLabel = "Revision diff",
  foldedLabel,
  expandAllSignal,
  footer,
}: {
  lines: RevisionDiffLine[];
  emptyLabel: string;
  ariaLabel?: string;
  /** Texto do marcador de trecho recolhido, com `{count}` (`revisions.foldedLines`). */
  foldedLabel?: string;
  /** Muda para abrir todos os trechos recolhidos de uma vez. */
  expandAllSignal?: number;
  /** Linha fixa abaixo do código (ex.: "Somente leitura · código · autor"). */
  footer?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const appliedSignalRef = useRef(expandAllSignal);
  const [editorReady, setEditorReady] = useState(false);
  const hasChanges = useMemo(
    () => lines.some((line) => line.kind !== "unchanged"),
    [lines],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !hasChanges) return;

    const state = EditorState.create({
      doc: diffDocument(lines),
      extensions: [
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        lineNumbers(),
        revisionDiffGutter,
        foldGutter(),
        ...(foldedLabel ? [foldedLinesConfig(lines, foldedLabel)] : []),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        html(),
        syntaxHighlighting(syntaxHighlightStyle),
        revisionDiffDecorations,
        revisionDiffGutterMarkers,
        createPanelEditorTheme(false, true),
        foldedLinesTheme,
        EditorView.lineWrapping,
      ],
    });
    const view = new EditorView({ state, parent: container });
    view.dom.setAttribute("role", "textbox");
    view.dom.setAttribute("aria-readonly", "true");
    view.dom.setAttribute("aria-label", ariaLabel);
    const folds = foldedLabel
      ? foldRevisionDiff(lines).map(({ from, to }) =>
          foldEffect.of({
            from: view.state.doc.line(from + 1).from,
            to: view.state.doc.line(to + 1).to,
          }),
        )
      : [];
    view.dispatch({ effects: [setRevisionDiffLines.of(lines), ...folds] });
    viewRef.current = view;
    setEditorReady(true);

    return () => {
      viewRef.current = null;
      view.destroy();
      setEditorReady(false);
    };
  }, [ariaLabel, foldedLabel, hasChanges, lines]);

  // "Expandir tudo": só reage a uma MUDANÇA do sinal, nunca ao valor com que a montagem começa
  // (um diff novo sempre abre recolhido).
  useEffect(() => {
    if (expandAllSignal === appliedSignalRef.current) return;
    appliedSignalRef.current = expandAllSignal;
    if (viewRef.current) unfoldAll(viewRef.current);
  }, [expandAllSignal]);

  if (!hasChanges) {
    return (
      <p
        className="text-muted-foreground flex h-full items-center justify-center px-4 text-sm"
        data-testid="revision-diff-pane"
        role="status"
      >
        {emptyLabel}
      </p>
    );
  }

  return (
    <div
      className="bg-card flex h-full min-h-0 flex-col overflow-hidden"
      data-testid="revision-diff-pane"
    >
      <div className="relative min-h-0 flex-1">
        <ol
          aria-hidden={editorReady}
          className={cn(
            "h-full min-h-0 overflow-auto px-3 py-2 font-mono text-[12px] leading-6",
            editorReady && "hidden",
          )}
        >
          {lines.map((line, index) => (
            <li
              className={cn(
                "px-1 whitespace-pre",
                `kastir-diff-line-${line.kind}`,
                line.kind === "removed" && "bg-destructive/10 text-destructive",
                line.kind === "added" && "bg-brand/10 text-brand",
              )}
              key={`${line.marker}-${index}`}
            >
              <span aria-hidden className="mr-2 inline-block w-3 select-none">
                {line.marker}
              </span>
              {line.words?.length
                ? line.words.map((word, wordIndex) => (
                    <span
                      className={cn(
                        "whitespace-pre",
                        word.kind === "removed" &&
                          "bg-destructive/30 kastir-diff-word-removed",
                        word.kind === "added" &&
                          "bg-brand/30 kastir-diff-word-added",
                      )}
                      key={`${index}-${wordIndex}`}
                    >
                      {word.text}
                    </span>
                  ))
                : line.text}
            </li>
          ))}
        </ol>
        <div
          aria-label={ariaLabel}
          aria-hidden={!editorReady}
          className={cn("h-full min-h-0", !editorReady && "invisible")}
          data-editor-mode="read-only"
          data-testid="revision-diff-editor"
          ref={containerRef}
        />
      </div>
      {footer ? (
        <p
          className="text-muted-foreground border-border shrink-0 border-t px-3 py-1.5 text-[11px]"
          data-testid="revision-diff-footer"
        >
          {footer}
        </p>
      ) : null}
    </div>
  );
}
