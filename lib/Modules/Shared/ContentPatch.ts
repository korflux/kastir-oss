/**
 * Fonte comum pura de patch e hash de conteúdo, usada por páginas e scripts.
 *
 * Responsabilidades (e só estas):
 *  - hash e tamanho do conteúdo (`contentSha256`, `contentBytes`) e a checagem
 *    do limite em bytes UTF-8 (`isWithinContentBytes`), para que as tools de
 *    leitura e gravação, a guarda de versão e o patch concordem byte a byte;
 *  - aplicar uma lista de operações `{old, new}` de busca e troca exata
 *    (`applyContentPatch`), em sequência e tudo ou nada.
 *
 * Contrato do patch (spec phase-5, decisões 2, 7 e 8):
 *  - cada `old` precisa ocorrer exatamente uma vez no conteúdo corrente, que é
 *    o resultado da operação anterior; 0 ou mais de 1 ocorrência é erro;
 *  - o casamento é por unidade de código UTF-16, sem normalizar CRLF nem
 *    Unicode; ocorrências sobrepostas contam como repetição (`aa` em `aaa`);
 *  - `old` ou `new` com surrogate isolado é recusado: trocaria metade de um
 *    caractere e gravaria texto inválido;
 *  - só o resultado final é limitado em bytes, nunca o intermediário;
 *  - o erro lançado (`ContentPatchError`) leva o índice (base 0) da operação e
 *    a contagem, e nunca repete conteúdo nem textos enviados. Quem converte
 *    para o erro de domínio (`VALIDATION_ERROR`) é o chamador.
 *
 * Sem Prisma, fila nem `server-only` de propósito: `Revisions/lifecycle`
 * importa este arquivo e é carregado até pelo backfill. Não valida a
 * quantidade de operações nem o tamanho de cada `old` e `new`; isso é da
 * validação de borda dos schemas dos domínios e da tool (decisão 6), que usam
 * `CONTENT_PATCH_MAX_OPERATIONS` e `CONTENT_SHA256_PATTERN` de
 * `ContentPatchContract`.
 */
import { createHash } from "node:crypto";

/** Uma operação de busca e troca; `old` não vazio, `new` pode ser vazio. */
export type ContentPatchOperation = { old: string; new: string };

/**
 * O padrão do hash mora em `ContentPatchContract` (sem `node:crypto`, seguro
 * para o bundle do cliente, onde os schemas de páginas e scripts também
 * entram) e é reexportado aqui para os consumidores de servidor.
 */
export { CONTENT_SHA256_PATTERN } from "@/lib/Modules/Shared/ContentPatchContract";

/** SHA-256 em hexadecimal minúsculo dos bytes UTF-8 do conteúdo. */
export function contentSha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Bytes UTF-8 do conteúdo inteiro; `contentTotal` segue em unidades UTF-16. */
export function contentBytes(content: string): number {
  return Buffer.byteLength(content, "utf8");
}

/** Checagem única do limite de conteúdo em bytes UTF-8 (`<=` o limite passa). */
export function isWithinContentBytes(
  content: string,
  maxBytes: number,
): boolean {
  return contentBytes(content) <= maxBytes;
}

export type ContentPatchErrorKind =
  "EMPTY_OLD" | "LONE_SURROGATE" | "OCCURRENCES" | "CONTENT_TOO_LARGE";

/**
 * Falha tipada do patch. `operationIndex` (base 0) existe nos erros de
 * operação, `occurrences` (0 ou maior que 1) em `OCCURRENCES` e `maxBytes` em
 * `CONTENT_TOO_LARGE`.
 */
export class ContentPatchError extends Error {
  readonly kind: ContentPatchErrorKind;
  readonly operationIndex?: number;
  readonly occurrences?: number;
  readonly maxBytes?: number;

  constructor(
    kind: ContentPatchErrorKind,
    message: string,
    detail: {
      operationIndex?: number;
      occurrences?: number;
      maxBytes?: number;
    },
  ) {
    super(message);
    this.name = "ContentPatchError";
    this.kind = kind;
    this.operationIndex = detail.operationIndex;
    this.occurrences = detail.occurrences;
    this.maxBytes = detail.maxBytes;
  }
}

/**
 * Conta as ocorrências de `needle` em `text`, inclusive sobrepostas, e devolve
 * a posição da primeira, em uma passada linear (KMP). O caminho óbvio, um laço
 * de `indexOf` a partir de `idx + 1`, é quadrático quando `needle` é longo e
 * repetitivo (200 mil `a` contra 100 mil `a` comparam 10^10 caracteres) e
 * deixaria uma única chamada com `old` grande ocupar o processo. `needle` não
 * pode ser vazio.
 */
function findOccurrences(
  text: string,
  needle: string,
): { count: number; firstIndex: number } {
  const m = needle.length;
  // failure[i]: tamanho do maior prefixo próprio de needle[0..i] que também é
  // sufixo dele; é o que evita recomparar o já casado depois de um desvio.
  const failure = new Int32Array(m);
  for (let i = 1, k = 0; i < m; i++) {
    while (k > 0 && needle.charCodeAt(i) !== needle.charCodeAt(k)) {
      k = failure[k - 1];
    }
    if (needle.charCodeAt(i) === needle.charCodeAt(k)) k++;
    failure[i] = k;
  }

  let count = 0;
  let firstIndex = -1;
  for (let i = 0, k = 0; i < text.length; i++) {
    while (k > 0 && text.charCodeAt(i) !== needle.charCodeAt(k)) {
      k = failure[k - 1];
    }
    if (text.charCodeAt(i) === needle.charCodeAt(k)) k++;
    if (k === m) {
      if (count === 0) firstIndex = i - m + 1;
      count++;
      // Continua a partir do maior sufixo que ainda é prefixo: é isso que faz
      // as ocorrências sobrepostas serem contadas.
      k = failure[k - 1];
    }
  }
  return { count, firstIndex };
}

/**
 * Aplica as operações em sequência sobre `content` e devolve o resultado, ou
 * lança `ContentPatchError` sem devolver resultado parcial (tudo ou nada). Não
 * grava nada: a função é pura e a gravação é do save do domínio. A troca é por
 * fatiamento, não por `String.replace`, porque `new` com `$&`, `$1` ou `$$`
 * seria interpretado como padrão de substituição e corromperia o conteúdo.
 * Resultado idêntico ao `content` é sucesso; o chamador decide que não há
 * escrita.
 *
 * `options.maxBytes` é o limite de bytes UTF-8 do domínio, aplicado só ao
 * resultado final. Em cada operação a ordem das checagens é: `old` vazio,
 * surrogate isolado, ocorrências; o erro é o da primeira operação que falha.
 */
export function applyContentPatch(
  content: string,
  operations: readonly ContentPatchOperation[],
  options: { maxBytes: number },
): string {
  let current = content;

  operations.forEach((operation, operationIndex) => {
    if (operation.old.length === 0) {
      throw new ContentPatchError(
        "EMPTY_OLD",
        `Operation ${operationIndex}: old text must not be empty`,
        { operationIndex },
      );
    }
    if (!operation.old.isWellFormed() || !operation.new.isWellFormed()) {
      throw new ContentPatchError(
        "LONE_SURROGATE",
        `Operation ${operationIndex}: old and new text must not contain an unpaired surrogate`,
        { operationIndex },
      );
    }

    const { count, firstIndex } = findOccurrences(current, operation.old);
    if (count !== 1) {
      throw new ContentPatchError(
        "OCCURRENCES",
        `Operation ${operationIndex}: old text occurs ${count} times, expected exactly 1`,
        { operationIndex, occurrences: count },
      );
    }

    current =
      current.slice(0, firstIndex) +
      operation.new +
      current.slice(firstIndex + operation.old.length);
  });

  if (!isWithinContentBytes(current, options.maxBytes)) {
    throw new ContentPatchError(
      "CONTENT_TOO_LARGE",
      `Patched content must be at most ${options.maxBytes} bytes`,
      { maxBytes: options.maxBytes },
    );
  }
  return current;
}
