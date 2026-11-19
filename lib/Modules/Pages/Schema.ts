import { z } from "zod";

import {
  FOLDER_PRESET_COLORS,
  folderColorSchema,
} from "@/lib/Modules/Shared/FolderSchema";
import { bulkIdsSchema } from "@/lib/Modules/Shared/Bulk";
import {
  CONTENT_PATCH_MAX_OPERATIONS,
  CONTENT_SHA256_PATTERN,
} from "@/lib/Modules/Shared/ContentPatchContract";

export {
  assertPublishableSlug,
  nextAvailableSlug,
  normalizeSlug,
  pageObjectLabel,
} from "@/lib/Modules/Pages/slug";

export const MAX_PAGE_CONTENT_BYTES = 2 * 1024 * 1024;

export const PAGE_FOLDER_PRESET_COLORS = FOLDER_PRESET_COLORS;
export { folderColorSchema };

export const pageStatusSchema = z.enum(["DRAFT", "PUBLISHED"]);

const pageContentSchema = z
  .string()
  .refine(
    (value) => Buffer.byteLength(value, "utf8") <= MAX_PAGE_CONTENT_BYTES,
    `Page content must be at most ${MAX_PAGE_CONTENT_BYTES} bytes`,
  );

/**
 * Hash esperado do rascunho: SHA-256 em hexadecimal, 64 caracteres em qualquer
 * caixa (a guarda de versão compara em minúsculas). O padrão vem de
 * `ContentPatchContract`, e não de `ContentPatch`, porque este arquivo também
 * entra no bundle do cliente (`ColorPicker`) e `ContentPatch` importa
 * `node:crypto`.
 */
const expectedContentSha256Schema = z.string().regex(CONTENT_SHA256_PATTERN);

const optionalSeoField = z.string().trim().max(255).nullable().optional();

export const createPageSchema = z.object({
  title: z.string().trim().min(1).max(200),
  slug: z.string().trim().max(200).optional().default(""),
  content: pageContentSchema,
  folderId: z.string().trim().min(1),
  seoTitle: optionalSeoField,
  seoDescription: optionalSeoField,
  seoKeyword: optionalSeoField,
});

/**
 * Versão esperada do rascunho no Save: `expectedContentSha256` (hash do
 * conteúdo lido) vence `expectedUpdatedAt` quando os dois chegam; sem nenhum
 * dos dois o Save não confere versão.
 */
export const updatePageSchema = z.object({
  id: z.string().trim().min(1),
  expectedUpdatedAt: z.coerce.date().optional(),
  expectedContentSha256: expectedContentSha256Schema.optional(),
  title: z.string().trim().min(1).max(200).optional(),
  slug: z.string().trim().max(200).optional(),
  content: pageContentSchema.optional(),
  folderId: z.string().trim().min(1).optional(),
  seoTitle: optionalSeoField,
  seoDescription: optionalSeoField,
  seoKeyword: optionalSeoField,
});

/**
 * Patch de conteúdo da página: lista de buscas e trocas exatas `{old, new}`
 * aplicadas em sequência sobre o rascunho cujo hash é `expectedContentSha256`
 * (obrigatório). Allowlist estrita de campos; de 1 a
 * `CONTENT_PATCH_MAX_OPERATIONS` operações; `old` não vazio; `old` e `new`
 * limitados ao tamanho de conteúdo da página, e o resultado final é limitado
 * de novo no patch (`applyContentPatch`). Só `content` muda.
 */
export const patchPageSchema = z
  .object({
    id: z.string().trim().min(1),
    expectedContentSha256: expectedContentSha256Schema,
    operations: z
      .array(
        z
          .object({ old: pageContentSchema.min(1), new: pageContentSchema })
          .strict(),
      )
      .min(1)
      .max(CONTENT_PATCH_MAX_OPERATIONS),
  })
  .strict();

export const createFolderSchema = z.object({
  name: z.string().trim().min(1).max(100),
  parentId: z.string().trim().min(1).nullable().optional(),
  color: folderColorSchema.nullable().optional(),
});

export const updateFolderSchema = createFolderSchema.partial().extend({
  id: z.string().trim().min(1),
});

/** Scope 3 — delete exige destino de realocação (não cai mais em Base). */
export const deleteFolderSchema = z.object({
  id: z.string().trim().min(1),
  reassignToFolderId: z.string().trim().min(1),
});

/** Scope 3 — mover pasta (newParentId null = vira raiz). */
export const moveFolderSchema = z.object({
  id: z.string().trim().min(1),
  newParentId: z.string().trim().min(1).nullable(),
});

/** Query de listagem (Scope 1 — busca por título/slug). */
export const listPagesQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  trash: z
    .enum(["0", "1"])
    .optional()
    .transform((value) => value === "1"),
});

/** Contracto estrito das ações em massa; campos de identidade nunca chegam ao serviço. */
export const bulkPagesSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("move-folder"),
      ids: bulkIdsSchema,
      folderId: z.string().trim().cuid(),
    })
    .strict(),
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

export type CreatePageInput = z.infer<typeof createPageSchema>;
export type UpdatePageInput = z.infer<typeof updatePageSchema>;
export type PatchPageInput = z.infer<typeof patchPageSchema>;
export type CreateFolderInput = z.infer<typeof createFolderSchema>;
export type UpdateFolderInput = z.infer<typeof updateFolderSchema>;
export type DeleteFolderInput = z.infer<typeof deleteFolderSchema>;
export type MoveFolderInput = z.infer<typeof moveFolderSchema>;
export type ListPagesQuery = z.infer<typeof listPagesQuerySchema>;
export type BulkPagesInput = z.infer<typeof bulkPagesSchema>;
