/**
 * Diff de revisões via jsdiff: só `-` / `+`. Word-level só em linhas
 * adjacentes pareadas com segurança; sem `~` de "modificado".
 *
 * Seções deste arquivo:
 *   1. `compareRevisionText`: o diff em si. Contrato compartilhado com o servidor
 *      (`Revisions/Service.ts`) e as ferramentas MCP: `previous` → `next`, `-` sai de
 *      `previous` e `+` entra em `next`. Quem escolhe qual texto é `previous` é o chamador.
 *   2. `countRevisionDiff` e `foldRevisionDiff`: leituras puras do resultado, usadas só pela
 *      UI da comparação (contagem `+N −N` e trechos iguais recolhidos).
 */
import { diffLines, diffWords } from "diff";

export type RevisionDiffKind = "unchanged" | "removed" | "added";

export type RevisionDiffWord = {
  kind: RevisionDiffKind;
  text: string;
};

export type RevisionDiffLine = {
  kind: RevisionDiffKind;
  marker: "-" | "+" | " ";
  text: string;
  words?: RevisionDiffWord[];
};

const SAFE_PAIR_RATIO = 0.4;

function splitLines(value: string): string[] {
  return value.split("\n");
}

function similarEnough(left: string, right: string): boolean {
  if (!left || !right) return false;
  const changes = diffWords(left, right);
  const unchanged = changes
    .filter((change) => !change.added && !change.removed)
    .reduce((total, change) => total + change.value.length, 0);
  return unchanged / Math.max(left.length, right.length) >= SAFE_PAIR_RATIO;
}

function wordHighlight(
  left: string,
  right: string,
): { removed: RevisionDiffWord[]; added: RevisionDiffWord[] } | null {
  if (!similarEnough(left, right)) return null;
  const removed: RevisionDiffWord[] = [];
  const added: RevisionDiffWord[] = [];
  for (const change of diffWords(left, right)) {
    if (change.added) {
      added.push({ kind: "added", text: change.value });
    } else if (change.removed) {
      removed.push({ kind: "removed", text: change.value });
    } else {
      removed.push({ kind: "unchanged", text: change.value });
      added.push({ kind: "unchanged", text: change.value });
    }
  }
  return { removed, added };
}

/**
 * Diff linha a linha de `previous` para `next` (`-` só em `previous`, `+` só em `next`).
 * Não escolhe a direção: o servidor e o MCP passam (versão A, versão B); o editor passa
 * (conteúdo atual, versão selecionada) para que `-` seja o que sai do rascunho ao restaurar.
 */
export function compareRevisionText(
  previous: string,
  next: string,
): RevisionDiffLine[] {
  const changes = diffLines(previous, next);
  const lines: RevisionDiffLine[] = [];

  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index]!;
    const following = changes[index + 1];
    if (change.removed && following?.added) {
      const removedLines = splitLines(change.value.replace(/\n$/, ""));
      const addedLines = splitLines(following.value.replace(/\n$/, ""));
      if (removedLines.length === addedLines.length) {
        for (let line = 0; line < removedLines.length; line += 1) {
          const left = removedLines[line]!;
          const right = addedLines[line]!;
          const words = wordHighlight(left, right);
          lines.push({
            kind: "removed",
            marker: "-",
            text: left,
            ...(words ? { words: words.removed } : {}),
          });
          lines.push({
            kind: "added",
            marker: "+",
            text: right,
            ...(words ? { words: words.added } : {}),
          });
        }
        index += 1;
        continue;
      }
    }

    const kind: RevisionDiffKind = change.added
      ? "added"
      : change.removed
        ? "removed"
        : "unchanged";
    const marker = kind === "added" ? "+" : kind === "removed" ? "-" : " ";
    const chunk = splitLines(change.value.replace(/\n$/, ""));
    if (chunk.length === 1 && chunk[0] === "" && change.value === "") continue;
    for (const text of chunk) {
      lines.push({ kind, marker, text });
    }
  }

  return lines;
}

/* -------------------------------------------------------------------------- */
/* 2. Leituras do diff para a UI da comparação                                 */
/* -------------------------------------------------------------------------- */

/** Linhas que entram (`+`) e saem (`-`) no diff; as linhas iguais não contam. */
export function countRevisionDiff(lines: readonly RevisionDiffLine[]): {
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.kind === "added") added += 1;
    else if (line.kind === "removed") removed += 1;
  }
  return { added, removed };
}

/** Intervalo de linhas iguais a recolher: índices (base 0) de `lines`, ambos inclusos. */
export type RevisionDiffFold = { from: number; to: number };

/** Linhas iguais mantidas visíveis em cada lado de uma alteração. */
export const REVISION_DIFF_CONTEXT_LINES = 2;

/**
 * Menor trecho de linhas iguais que vale recolher. O marcador "N linhas iguais" ocupa uma
 * linha, então recolher 1 ou 2 linhas não economiza nada (e "1 linhas iguais" não tem
 * singular no dicionário).
 */
export const REVISION_DIFF_MIN_FOLDED_LINES = 3;

/**
 * Decide quais trechos de linhas iguais ficam recolhidos: tudo que está a mais de
 * `context` linhas de uma alteração, em trechos de pelo menos `minHidden` linhas.
 * Só devolve os intervalos; o documento continua inteiro (o painel recolhe por cima dele,
 * então "expandir" nunca perde linha). Sem nenhuma alteração não há o que focar: devolve [].
 */
export function foldRevisionDiff(
  lines: readonly RevisionDiffLine[],
  {
    context = REVISION_DIFF_CONTEXT_LINES,
    minHidden = REVISION_DIFF_MIN_FOLDED_LINES,
  }: { context?: number; minHidden?: number } = {},
): RevisionDiffFold[] {
  const visible = new Array<boolean>(lines.length).fill(false);
  let changed = false;
  lines.forEach((line, index) => {
    if (line.kind === "unchanged") return;
    changed = true;
    const first = Math.max(0, index - context);
    const last = Math.min(lines.length - 1, index + context);
    for (let around = first; around <= last; around += 1)
      visible[around] = true;
  });
  if (!changed) return [];

  const folds: RevisionDiffFold[] = [];
  let start = -1;
  const close = (end: number) => {
    if (start >= 0 && end - start + 1 >= minHidden) {
      folds.push({ from: start, to: end });
    }
    start = -1;
  };
  lines.forEach((_line, index) => {
    if (visible[index]) close(index - 1);
    else if (start < 0) start = index;
  });
  close(lines.length - 1);
  return folds;
}
