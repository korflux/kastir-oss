import { describe, expect, it } from "vitest";

import {
  compareRevisionText,
  countRevisionDiff,
  foldRevisionDiff,
  type RevisionDiffLine,
} from "@/lib/Modules/Revisions/diff";

describe("compareRevisionText", () => {
  it("marks removed and added lines with - and + only", () => {
    const diff = compareRevisionText("alpha\nkeep\n", "keep\nbeta\n");

    expect(diff.map((line) => line.kind)).toEqual([
      "removed",
      "unchanged",
      "added",
    ]);
    expect(diff.map((line) => line.marker)).toEqual(["-", " ", "+"]);
    // O tipo do marcador já exclui "~"; o teste compara como string de propósito.
    expect(diff.some((line) => (line.marker as string) === "~")).toBe(false);
    expect(diff.find((line) => line.kind === "removed")?.text).toBe("alpha");
    expect(diff.find((line) => line.kind === "added")?.text).toBe("beta");
  });

  it("highlights words when adjacent lines are similar enough to pair", () => {
    const diff = compareRevisionText("hello world\n", "hello there\n");

    expect(diff).toHaveLength(2);
    expect(diff[0]).toMatchObject({
      kind: "removed",
      marker: "-",
      text: "hello world",
    });
    expect(diff[1]).toMatchObject({
      kind: "added",
      marker: "+",
      text: "hello there",
    });
    expect(diff[0]!.words).toEqual([
      { kind: "unchanged", text: "hello " },
      { kind: "removed", text: "world" },
    ]);
    expect(diff[1]!.words).toEqual([
      { kind: "unchanged", text: "hello " },
      { kind: "added", text: "there" },
    ]);
  });

  it("falls back to line-level when adjacent lines are not safely pairable", () => {
    const diff = compareRevisionText(
      "completely different source line\n",
      "xyz\n",
    );

    expect(diff).toEqual([
      {
        kind: "removed",
        marker: "-",
        text: "completely different source line",
      },
      { kind: "added", marker: "+", text: "xyz" },
    ]);
  });
});

describe("compareRevisionText against in-memory draft", () => {
  // Semântica da função (previous → next), da qual o servidor e o MCP dependem: o que só
  // existe em `next` é `+`.
  it("keeps unchanged lines and marks next-only hunks as added", () => {
    const lines = compareRevisionText(
      "<h1>saved</h1>\n",
      "<h1>saved</h1>\n<p>unsaved</p>\n",
    );
    expect(lines.map((line) => line.kind)).toEqual(["unchanged", "added"]);
    expect(lines[0]?.text).toContain("saved");
    expect(lines[1]?.text).toContain("unsaved");
  });
});

describe("compareRevisionText direction for the editor", () => {
  // O servidor e o MCP chamam (versão A, versão B); o editor chama (conteúdo do editor,
  // versão selecionada). A função é a mesma e não escolhe lado: quem chama escolhe.
  const editor = "<h1>title</h1>\n<p>only in the editor</p>\n";
  const version = "<h1>title</h1>\n<p>only in the version</p>\n";

  it("marks what leaves the draft as - and what comes back with the version as +", () => {
    const lines = compareRevisionText(editor, version);
    expect(lines.find((line) => line.kind === "removed")?.text).toContain(
      "only in the editor",
    );
    expect(lines.find((line) => line.kind === "added")?.text).toContain(
      "only in the version",
    );
    expect(lines.map((line) => line.marker)).toEqual([" ", "-", "+"]);
  });

  it("keeps the same function symmetric for the server callers (previous to next)", () => {
    const lines = compareRevisionText(version, editor);
    expect(lines.find((line) => line.kind === "removed")?.text).toContain(
      "only in the version",
    );
    expect(lines.find((line) => line.kind === "added")?.text).toContain(
      "only in the editor",
    );
  });
});

describe("countRevisionDiff", () => {
  it("counts only added and removed lines", () => {
    const lines = compareRevisionText("a\nb\nc\n", "a\nx\ny\nc\nd\n");
    expect(countRevisionDiff(lines)).toEqual({ added: 3, removed: 1 });
    expect(countRevisionDiff([])).toEqual({ added: 0, removed: 0 });
  });
});

describe("foldRevisionDiff", () => {
  const same = (text: string): RevisionDiffLine => ({
    kind: "unchanged",
    marker: " ",
    text,
  });
  const removed = (text: string): RevisionDiffLine => ({
    kind: "removed",
    marker: "-",
    text,
  });
  const added = (text: string): RevisionDiffLine => ({
    kind: "added",
    marker: "+",
    text,
  });
  const run = (count: number, prefix: string) =>
    Array.from({ length: count }, (_, index) => same(`${prefix}${index}`));

  it("keeps 2 lines of context on each side of a change and folds the rest", () => {
    // índices: 0..9 iguais, 10 removida, 11 adicionada, 12..21 iguais
    const lines = [...run(10, "a"), removed("x"), added("y"), ...run(10, "b")];
    expect(foldRevisionDiff(lines)).toEqual([
      { from: 0, to: 7 },
      { from: 14, to: 21 },
    ]);
  });

  it("does not fold a gap that is too short to save a line", () => {
    // Entre as duas alterações restam 2 linhas iguais: tudo dentro do contexto.
    const lines = [removed("x"), ...run(2, "m"), added("y")];
    expect(foldRevisionDiff(lines)).toEqual([]);
    // 8 linhas entre elas (índices 1..8): 4 escondidas (3..6), acima do mínimo de 3.
    const wide = [removed("x"), ...run(8, "m"), added("y")];
    expect(foldRevisionDiff(wide)).toEqual([{ from: 3, to: 6 }]);
  });

  it("only folds runs of at least minHidden lines", () => {
    // 2 linhas escondidas não compensam o marcador (3 é o mínimo padrão).
    const lines = [removed("x"), ...run(6, "m"), added("y")];
    expect(foldRevisionDiff(lines)).toEqual([]);
    expect(foldRevisionDiff(lines, { minHidden: 2 })).toEqual([
      { from: 3, to: 4 },
    ]);
  });

  it("returns nothing when there is no change to focus on", () => {
    expect(foldRevisionDiff(run(50, "a"))).toEqual([]);
    expect(foldRevisionDiff([])).toEqual([]);
  });

  it("never hides a changed line", () => {
    const lines = [...run(7, "a"), removed("x"), added("y"), ...run(7, "b")];
    const hidden = new Set<number>();
    for (const { from, to } of foldRevisionDiff(lines)) {
      for (let index = from; index <= to; index += 1) hidden.add(index);
    }
    expect(hidden.size).toBeGreaterThan(0);
    lines.forEach((line, index) => {
      if (line.kind !== "unchanged") expect(hidden.has(index)).toBe(false);
    });
  });
});
