import { Parser } from "htmlparser2";
import { z } from "zod";

import type { InjectionPoint, ScopeType } from "@/lib/Modules/CustomCode/Types";
import { bulkIdsSchema, normalizeBulkIds } from "@/lib/Modules/Shared/Bulk";
import {
  CONTENT_PATCH_MAX_OPERATIONS,
  CONTENT_SHA256_PATTERN,
} from "@/lib/Modules/Shared/ContentPatchContract";

export const MAX_SNIPPET_CONTENT_BYTES = 2 * 1024 * 1024;

export const injectionPointSchema = z.enum([
  "HEADER",
  "BODY_START",
  "BODY_END",
]);

export const listSnippetsQuerySchema = z
  .object({
    search: z.string().optional(),
    status: z.enum(["DRAFT", "PUBLISHED"]).optional(),
    location: injectionPointSchema.optional(),
    trash: z.enum(["1", "true"]).optional(),
    page: z.coerce.number().int().min(1).max(10_000).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
  })
  .transform((value) => ({
    search: value.search,
    status: value.status,
    location: value.location,
    includeDeleted: value.trash === "1" || value.trash === "true",
    page: value.page,
    pageSize: value.pageSize,
  }));

/** Teto do texto de busca do seletor de páginas do escopo (título de página tem até 200). */
export const SCOPE_PAGES_SEARCH_MAX = 200;

/**
 * Query do `GET /api/admin/custom-code/pages` (seletor de páginas do escopo e comparação de
 * versões). Dois usos na mesma rota:
 *   - busca paginada: `q` (limitado), `page` e `pageSize`;
 *   - resolução por id: `ids`, lista separada por vírgula validada como o bulk (cuid, de 1 a
 *     `BULK_IDS_MAX`). Com `ids` a rota ignora `q`/`page`/`pageSize` (não há paginação).
 * Valor fora do contrato vira ZodError, que `customCodeApiError` responde como 400.
 */
export const listScopePagesQuerySchema = z.object({
  q: z.string().trim().max(SCOPE_PAGES_SEARCH_MAX).optional(),
  ids: z
    .string()
    .transform((value) => value.split(","))
    .pipe(bulkIdsSchema)
    .optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const scopeTypeSchema = z.enum(["ALL_PAGES", "SPECIFIC_PAGES"]);

export const triggerTypeSchema = z.enum([
  "SELECTOR_EVENT",
  "PAGE_LOAD",
  "SCROLL",
  "REFERRER",
]);

export const selectorEventConfigSchema = z.object({
  selector: z.string().trim().min(1).max(300),
  event: z.enum(["click", "submit"]),
});
export const pageLoadConfigSchema = z.object({
  delaySeconds: z.number().int().min(0).max(600),
});
export const scrollConfigSchema = z.object({
  percentage: z.number().int().min(1).max(100),
});
export const referrerConfigSchema = z.object({
  matches: z.string().trim().min(1).max(500),
});

// Shape-only: whether maxDisplays/displayResetDays are consistent with an
// existing trigger depends on DB state for partial updates, so that
// cross-field check lives in Service.ts, not here.
export const triggerFieldsSchema = z.discriminatedUnion("triggerType", [
  z.object({
    triggerType: z.literal("SELECTOR_EVENT"),
    triggerConfig: selectorEventConfigSchema,
  }),
  z.object({
    triggerType: z.literal("PAGE_LOAD"),
    triggerConfig: pageLoadConfigSchema,
  }),
  z.object({
    triggerType: z.literal("SCROLL"),
    triggerConfig: scrollConfigSchema,
  }),
  z.object({
    triggerType: z.literal("REFERRER"),
    triggerConfig: referrerConfigSchema,
  }),
]);

const maxDisplaysSchema = z
  .number()
  .int()
  .min(1)
  .max(1000)
  .nullable()
  .optional();
const displayResetDaysSchema = z
  .number()
  .int()
  .min(1)
  .max(365)
  .nullable()
  .optional();

const optionalPrioritySchema = z
  .number()
  .int()
  .nonnegative()
  .nullable()
  .optional();

const snippetContentSchema = z
  .string()
  .refine(
    (value) => Buffer.byteLength(value, "utf8") <= MAX_SNIPPET_CONTENT_BYTES,
    `Snippet content must be at most ${MAX_SNIPPET_CONTENT_BYTES} bytes`,
  );

/**
 * Teto de páginas no escopo de um script (`pageIds` de `SPECIFIC_PAGES`). Fonte única do
 * número: schema, mensagem de recusa, JSON Schema das tools MCP (`maxItems`) e docs citam
 * este valor.
 *
 * ponytail: o seletor de escopo do painel não limita a seleção, a recusa só acontece ao
 * salvar (VALIDATION_ERROR), adicionar contador ou bloqueio no seletor se alguém passar do
 * teto na prática.
 */
export const SCOPE_PAGE_IDS_MAX = 1000;

/**
 * Mensagem fixa e segura para qualquer recusa de `pageIds` (id fora do formato, tipo errado
 * ou acima do teto). Nunca ecoa o payload; o `Service` a usa no lugar do erro genérico
 * "Invalid snippet data" e o painel a mostra como veio.
 */
export const SCOPE_PAGE_IDS_INVALID_MESSAGE = `Invalid script page scope: pageIds must contain at most ${SCOPE_PAGE_IDS_MAX} valid page ids`;

/**
 * Escopo de páginas na borda: cada item é cuid (formato do `Page.id` do Prisma) aparado, a
 * lista tem de 0 a `SCOPE_PAGE_IDS_MAX` itens (teto aplicado ao payload bruto, antes do
 * dedupe, para limitar o trabalho sobre entrada hostil) e repetições viram uma ocorrência
 * (`normalizeBulkIds`, mesma regra do bulk). No JSON Schema das tools MCP o transform é
 * ignorado e o campo aparece como array de strings com `maxItems`.
 */
const pageIdsSchema = z
  .array(z.string().trim().cuid())
  .max(SCOPE_PAGE_IDS_MAX)
  .transform((ids) => normalizeBulkIds(ids));

// Shared, default-free base: Zod applies a field's .default() even when
// .partial() makes it optional, so scopeType/pageIds defaults are added only
// on createSnippetSchema below — an update omitting them must leave them
// `undefined` (unchanged), not silently reset to ALL_PAGES/[].
const snippetFieldsSchema = z.object({
  name: z.string().trim().min(1).max(200),
  location: injectionPointSchema,
  content: snippetContentSchema,
  priority: optionalPrioritySchema,
  scopeType: scopeTypeSchema,
  pageIds: pageIdsSchema,
  trigger: triggerFieldsSchema.nullable().optional(),
  maxDisplays: maxDisplaysSchema,
  displayResetDays: displayResetDaysSchema,
});

export const createSnippetSchema = snippetFieldsSchema.extend({
  scopeType: scopeTypeSchema.default("ALL_PAGES"),
  pageIds: pageIdsSchema.default([]),
});

/**
 * Hash esperado do conteúdo: 64 hexadecimais em qualquer caixa (a guarda de versão compara em
 * minúsculas). Com ele presente o Save confere só o hash do rascunho lido e ignora
 * `expectedUpdatedAt`, porque publicar, ativar e desativar mudam o `updatedAt` sem mudar o
 * conteúdo.
 */
const expectedContentSha256Schema = z.string().regex(CONTENT_SHA256_PATTERN);

export const updateSnippetSchema = snippetFieldsSchema.partial().extend({
  id: z.string().trim().min(1),
  expectedUpdatedAt: z.coerce.date().optional(),
  expectedContentSha256: expectedContentSha256Schema.optional(),
});

/**
 * Uma operação de busca e troca: `old` não vazio; `old` e `new` até o limite de bytes do
 * conteúdo do script. Campo fora da allowlist é recusado (`.strict()`).
 */
const snippetPatchOperationSchema = z
  .object({
    old: snippetContentSchema.min(1),
    new: snippetContentSchema,
  })
  .strict();

/**
 * Entrada do patch de conteúdo de script: o hash do rascunho lido é obrigatório (sem ele o
 * patch poderia valer sobre um conteúdo que o chamador nunca viu) e são de 1 a
 * `CONTENT_PATCH_MAX_OPERATIONS` operações. O patch altera só `content`; o resto segue pelo
 * update. Aplicar as operações (ocorrência única, tudo ou nada, limite do resultado) é de
 * `applyContentPatch`.
 */
export const patchSnippetContentSchema = z
  .object({
    id: z.string().trim().min(1),
    expectedContentSha256: expectedContentSha256Schema,
    operations: z
      .array(snippetPatchOperationSchema)
      .min(1)
      .max(CONTENT_PATCH_MAX_OPERATIONS),
  })
  .strict();

/** Contrato estrito do bulk; exclusão permanente exige confirmação explícita. */
export const bulkCustomCodeSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("trash"),
      ids: bulkIdsSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("restore"),
      ids: bulkIdsSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("permanently-delete"),
      ids: bulkIdsSchema,
      confirmed: z.literal(true),
    })
    .strict(),
]);

export type BulkCustomCodeInput = z.infer<typeof bulkCustomCodeSchema>;

export type CreateSnippetInput = z.infer<typeof createSnippetSchema>;
export type UpdateSnippetInput = z.infer<typeof updateSnippetSchema>;
export type PatchSnippetContentInput = z.infer<
  typeof patchSnippetContentSchema
>;

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

export function validateSnippetContent(content: string): void {
  if (Buffer.byteLength(content, "utf8") > MAX_SNIPPET_CONTENT_BYTES) {
    throw new Error("Snippet content exceeds the 2 MiB limit");
  }

  const stack: string[] = [];
  let parserError: Error | null = null;

  const parser = new Parser(
    {
      onopentag(name, _attributes, isImplied) {
        const normalized = name.toLowerCase();
        if (!isImplied && !VOID_ELEMENTS.has(normalized)) {
          stack.push(normalized);
        }
      },
      onclosetag(name, isImplied) {
        const normalized = name.toLowerCase();
        if (VOID_ELEMENTS.has(normalized)) return;

        if (isImplied) {
          parserError = new Error("Snippet tags must be explicitly closed");
          return;
        }

        const last = stack.pop();
        if (last !== normalized) {
          parserError = new Error(
            "Snippet tags are not balanced or well-formed",
          );
        }
      },
      onerror(error) {
        parserError = error;
      },
    },
    {
      decodeEntities: false,
      lowerCaseTags: true,
      recognizeSelfClosing: true,
    },
  );

  parser.parseComplete(content);

  if (parserError) throw parserError;
  if (stack.length > 0) {
    throw new Error("Snippet tags are not balanced or well-formed");
  }
}

export function isInjectionPoint(value: string): value is InjectionPoint {
  return injectionPointSchema.safeParse(value).success;
}

export function isScopeType(value: string): value is ScopeType {
  return scopeTypeSchema.safeParse(value).success;
}
