import { describe, expect, it } from "vitest";

/**
 * Fonte comum pura de patch e hash de conteúdo (`Shared/ContentPatch`), usada
 * por páginas e scripts. Sem `vi.mock` de propósito: o módulo não pode puxar
 * Prisma, fila nem `server-only`, porque a guarda de versão de
 * `Revisions/lifecycle` o importa.
 *
 * Cobre as tabelas de A2 (patch) e A4 (tamanhos) e o hash de `abc` de A3, da
 * spec phase-5. Os "nada gravado" e "sem escrita" de A2 são do save de cada
 * domínio (passos 2a, 2b e 4); aqui se prova que a função devolve o resultado
 * ou lança o erro tipado, sem estado nem efeito.
 */
import {
  CONTENT_SHA256_PATTERN,
  ContentPatchError,
  applyContentPatch,
  contentBytes,
  contentSha256,
  isWithinContentBytes,
  type ContentPatchOperation,
} from "@/lib/Modules/Shared/ContentPatch";

const MAX = 2 * 1024 * 1024;

const op = (from: string, to: string): ContentPatchOperation => ({
  old: from,
  new: to,
});

/** Executa o patch e devolve o erro lançado, para asserir o objeto inteiro. */
function patchError(
  content: string,
  operations: ContentPatchOperation[],
  maxBytes = MAX,
): ContentPatchError {
  try {
    applyContentPatch(content, operations, { maxBytes });
  } catch (error) {
    expect(error).toBeInstanceOf(ContentPatchError);
    return error as ContentPatchError;
  }
  throw new Error("applyContentPatch deveria ter lançado");
}

describe("A3: contentSha256", () => {
  it("A3: devolve o SHA-256 de `abc` em hexadecimal minúsculo com 64 caracteres", () => {
    const hash = contentSha256("abc");
    expect(hash).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("A3: calcula sobre os bytes UTF-8 (valores de referência fixos), sem normalizar CRLF nem Unicode", () => {
    // Referências calculadas fora do código sob teste (digest SHA-256 do
    // `node:crypto` sobre os bytes UTF-8 literais), não pela função.
    expect(contentSha256("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(contentSha256("é")).toBe(
      "4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c",
    );
    expect(contentSha256("🚀")).toBe(
      "ebbc0b2870eb323f2b6cffa5c493ceef81ae7eb36afc73d4e0367301631daec5",
    );
    expect(contentSha256("<p>\r\n</p>")).toBe(
      "33e64180f23d3f7039633d733b7f1237c1f553a19dd694157b5158188e873abd",
    );
    // Sem normalização: LF não vira CRLF e "é" composto não vira decomposto.
    expect(contentSha256("<p>\n</p>")).not.toBe(contentSha256("<p>\r\n</p>"));
    expect(contentSha256("é")).not.toBe(contentSha256("é"));
  });
});

describe("A4: contentBytes e unidade de contentTotal", () => {
  // `contentTotal` é `text.length` (unidades UTF-16, `Mcp/Tools/Shared.ts`); a
  // coluna fica na tabela para fixar o contraste com os bytes UTF-8.
  it.each([
    { content: "abc", contentTotal: 3, bytes: 3 },
    { content: "é", contentTotal: 1, bytes: 2 },
    { content: "🚀", contentTotal: 2, bytes: 4 },
    { content: "<p>\r\n</p>", contentTotal: 9, bytes: 9 },
  ])(
    "A4: $content tem $bytes bytes UTF-8 e $contentTotal unidades UTF-16",
    ({ content, contentTotal, bytes }) => {
      expect(contentBytes(content)).toBe(bytes);
      expect(content.length).toBe(contentTotal);
    },
  );
});

describe("isWithinContentBytes", () => {
  it("aceita o próprio limite e recusa o primeiro byte acima", () => {
    expect(isWithinContentBytes("a".repeat(10), 10)).toBe(true);
    expect(isWithinContentBytes("a".repeat(11), 10)).toBe(false);
  });

  it("conta bytes UTF-8, não caracteres", () => {
    // 5 × "é" = 5 caracteres e 10 bytes.
    expect(isWithinContentBytes("é".repeat(5), 10)).toBe(true);
    expect(isWithinContentBytes("é".repeat(5), 9)).toBe(false);
    // "🚀" = 2 unidades UTF-16 e 4 bytes.
    expect(isWithinContentBytes("🚀", 4)).toBe(true);
    expect(isWithinContentBytes("🚀", 3)).toBe(false);
  });
});

describe("CONTENT_SHA256_PATTERN", () => {
  it("aceita 64 hexadecimais em qualquer caixa e recusa o resto", () => {
    const lower =
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    expect(CONTENT_SHA256_PATTERN.test(lower)).toBe(true);
    expect(CONTENT_SHA256_PATTERN.test(lower.toUpperCase())).toBe(true);
    expect(CONTENT_SHA256_PATTERN.test(lower.slice(1))).toBe(false);
    expect(CONTENT_SHA256_PATTERN.test(`${lower}0`)).toBe(false);
    expect(CONTENT_SHA256_PATTERN.test(`g${lower.slice(1)}`)).toBe(false);
    expect(CONTENT_SHA256_PATTERN.test(`${lower}\n`)).toBe(false);
    expect(CONTENT_SHA256_PATTERN.test("")).toBe(false);
  });
});

describe("A2: applyContentPatch, linhas de sucesso", () => {
  it.each([
    { name: "troca única", content: "AB", ops: [op("A", "X")], result: "XB" },
    {
      name: "a segunda operação opera sobre o resultado da primeira",
      content: "AB",
      ops: [op("A", "B"), op("BB", "C")],
      result: "C",
    },
    {
      name: "CRLF casa exatamente quando o `old` também tem CRLF",
      content: "<p>\r\n</p>",
      ops: [op("<p>\r\n</p>", "<p></p>")],
      result: "<p></p>",
    },
    {
      name: "emoji inteiro (par substituto) é trocado por inteiro",
      content: "🚀 x",
      ops: [op("🚀", "✅")],
      result: "✅ x",
    },
    {
      name: "resultado idêntico ao atual devolve o mesmo conteúdo",
      content: "AB",
      ops: [op("A", "A")],
      result: "AB",
    },
  ])("A2: $name", ({ content, ops, result }) => {
    expect(applyContentPatch(content, ops, { maxBytes: MAX })).toBe(result);
  });

  it("A2: `new` vazio remove o trecho", () => {
    expect(
      applyContentPatch("fill:#111;", [op("#111", "")], { maxBytes: MAX }),
    ).toBe("fill:;");
  });

  it("A2: `new` é inserido literalmente, sem os padrões especiais de replace", () => {
    const result = applyContentPatch("[x]", [op("x", "$& $1 $$ $` $'")], {
      maxBytes: MAX,
    });
    expect(result).toBe("[$& $1 $$ $` $']");
  });

  it("A2: troca só a ocorrência única, preservando o que vem antes e depois", () => {
    const content = "<a>1</a><b>2</b><c>3</c>";
    expect(
      applyContentPatch(content, [op("<b>2</b>", "<b>9</b>")], {
        maxBytes: MAX,
      }),
    ).toBe("<a>1</a><b>9</b><c>3</c>");
  });

  it("A2: trocas em sequência chegam ao mesmo resultado que o conteúdo reescrito à mão", () => {
    // Caso do relato: trocar paleta e dois logos sem reenviar o resto.
    const content = "fill:#111;fill:#222;<img src=a.png><img src=b.png>";
    const result = applyContentPatch(
      content,
      [
        op("#111", "#0A0"),
        op("#222", "#0B0"),
        op("a.png", "novo-a.png"),
        op("b.png", "novo-b.png"),
      ],
      { maxBytes: MAX },
    );
    expect(result).toBe(
      "fill:#0A0;fill:#0B0;<img src=novo-a.png><img src=novo-b.png>",
    );
  });
});

describe("A2: applyContentPatch, linhas de erro (tudo ou nada)", () => {
  it("A2: `old` ausente na segunda operação recusa a chamada inteira, operação 1 com 0 ocorrências", () => {
    const error = patchError("AB", [op("A", "X"), op("Z", "Y")]);
    expect(error).toMatchObject({
      kind: "OCCURRENCES",
      operationIndex: 1,
      occurrences: 0,
    });
    expect(error.message).toBe(
      "Operation 1: old text occurs 0 times, expected exactly 1",
    );
  });

  it("A2: `old` repetido recusa a operação 0 com 2 ocorrências", () => {
    const error = patchError("a b a", [op("a", "x")]);
    expect(error).toMatchObject({
      kind: "OCCURRENCES",
      operationIndex: 0,
      occurrences: 2,
    });
    expect(error.message).toBe(
      "Operation 0: old text occurs 2 times, expected exactly 1",
    );
  });

  it("A2: ocorrências sobrepostas contam como repetição (`aa` em `aaa` são 2)", () => {
    expect(patchError("aaa", [op("aa", "b")])).toMatchObject({
      kind: "OCCURRENCES",
      operationIndex: 0,
      occurrences: 2,
    });
  });

  it("A2: a contagem de sobrepostas é exata (`aa` em `aaaa` são 3)", () => {
    expect(patchError("aaaa", [op("aa", "b")])).toMatchObject({
      kind: "OCCURRENCES",
      occurrences: 3,
    });
  });

  it("A2: a contagem de sobrepostas continua exata e rápida com `old` longo e repetitivo", () => {
    // 200 mil `a` contra 100 mil `a` têm 100.001 casamentos sobrepostos; uma
    // busca por indexOf em laço compara 100 mil caracteres por casamento
    // (10^10 comparações) e estouraria o timeout do teste.
    expect(
      patchError("a".repeat(200_000), [op("a".repeat(100_000), "b")]),
    ).toMatchObject({ kind: "OCCURRENCES", occurrences: 100_001 });
  });

  it("A2: LF no `old` não casa com CRLF do conteúdo (0 ocorrências, sem normalização)", () => {
    expect(
      patchError("<p>\r\n</p>", [op("<p>\n</p>", "<p></p>")]),
    ).toMatchObject({ kind: "OCCURRENCES", operationIndex: 0, occurrences: 0 });
  });

  it("A2: sem normalização Unicode (`é` composto não casa com `e` + acento combinante)", () => {
    expect(patchError("é", [op("é", "x")])).toMatchObject({
      kind: "OCCURRENCES",
      occurrences: 0,
    });
  });

  it("A2: surrogate isolado no `old` é recusado e não troca metade do emoji", () => {
    // Sem a recusa, "\ud83d" casaria com a primeira metade de "🚀".
    const error = patchError("🚀 x", [op("\ud83d", "y")]);
    expect(error).toMatchObject({ kind: "LONE_SURROGATE", operationIndex: 0 });
    expect(error.message).toContain("Operation 0");
  });

  it.each([
    { name: "alto no `new`", old: "x", new: "\ud83d" },
    { name: "baixo no `old`", old: "\ude80", new: "y" },
    { name: "baixo no `new`", old: "x", new: "\ude80" },
  ])(
    "A2: surrogate isolado ($name) é recusado",
    ({ old, new: replacement }) => {
      expect(patchError("🚀 x", [op(old, replacement)])).toMatchObject({
        kind: "LONE_SURROGATE",
        operationIndex: 0,
      });
    },
  );

  it("A2: surrogate isolado numa operação posterior leva o índice dela", () => {
    expect(patchError("AB", [op("A", "X"), op("B", "\ud83d")])).toMatchObject({
      kind: "LONE_SURROGATE",
      operationIndex: 1,
    });
  });

  it("A2: `old` vazio é recusado com o índice da operação", () => {
    expect(patchError("AB", [op("A", "X"), op("", "Y")])).toMatchObject({
      kind: "EMPTY_OLD",
      operationIndex: 1,
    });
  });

  it("A2: a mensagem de erro não repete o conteúdo nem os textos enviados", () => {
    const error = patchError("segredo-no-conteudo", [
      op("trecho-ausente", "novo-segredo"),
    ]);
    expect(error.message).not.toContain("segredo-no-conteudo");
    expect(error.message).not.toContain("trecho-ausente");
    expect(error.message).not.toContain("novo-segredo");
  });
});

describe("A10: limite de bytes do resultado", () => {
  it("A10: aceita o resultado exatamente no limite", () => {
    expect(applyContentPatch("Xa", [op("X", "bb")], { maxBytes: 3 })).toBe(
      "bba",
    );
  });

  it("A10: recusa o resultado um byte acima do limite e cita o limite em bytes", () => {
    const error = patchError("Xa", [op("X", "bbb")], 3);
    expect(error).toMatchObject({ kind: "CONTENT_TOO_LARGE", maxBytes: 3 });
    expect(error.message).toBe("Patched content must be at most 3 bytes");
  });

  it("A10: o limite é em bytes UTF-8, não em caracteres", () => {
    // "éa" tem 2 caracteres e 3 bytes: cabe em 3 bytes e não em 2, embora
    // 2 caracteres coubessem em um limite contado em caracteres.
    expect(applyContentPatch("Xa", [op("X", "é")], { maxBytes: 3 })).toBe("éa");
    expect(patchError("Xa", [op("X", "é")], 2)).toMatchObject({
      kind: "CONTENT_TOO_LARGE",
      maxBytes: 2,
    });
  });

  it("A10: só o resultado final conta (excesso intermediário que volta ao limite passa)", () => {
    // Depois da primeira operação o conteúdo tem 7 bytes (limite 3); depois da
    // segunda, 1 byte.
    const result = applyContentPatch(
      "Xa",
      [op("X", "bbbbbb"), op("bbbbbb", "")],
      { maxBytes: 3 },
    );
    expect(result).toBe("a");
  });

  it("A10: o erro de operação vem antes do erro de tamanho", () => {
    expect(patchError("a", [op("a", "bbbbbb"), op("z", "y")], 3)).toMatchObject(
      {
        kind: "OCCURRENCES",
        operationIndex: 1,
      },
    );
  });
});
