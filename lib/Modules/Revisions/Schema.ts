/**
 * Schemas de snapshot na borda: allowlist estrita, teto de conteúdo e
 * recusa de campos de controle (autor, pin, ponteiro, tipo polimórfico).
 */
import { z } from "zod";

import {
  injectionPointSchema,
  MAX_SNIPPET_CONTENT_BYTES,
  pageLoadConfigSchema,
  referrerConfigSchema,
  scopeTypeSchema,
  scrollConfigSchema,
  selectorEventConfigSchema,
  triggerFieldsSchema,
  triggerTypeSchema,
} from "@/lib/Modules/CustomCode/Schema";
import { MAX_PAGE_CONTENT_BYTES } from "@/lib/Modules/Pages/Schema";
import type {
  PageSnapshot,
  SnippetSnapshot,
} from "@/lib/Modules/Revisions/Types";

const pageContentSchema = z
  .string()
  .refine(
    (value) => Buffer.byteLength(value, "utf8") <= MAX_PAGE_CONTENT_BYTES,
    "Page content exceeds the allowed size",
  );

const snippetContentSchema = z
  .string()
  .refine(
    (value) => Buffer.byteLength(value, "utf8") <= MAX_SNIPPET_CONTENT_BYTES,
    "Snippet content exceeds the allowed size",
  );

const optionalSeoField = z.string().trim().max(255).nullable();

export const pageSnapshotSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    slug: z.string().trim().min(1).max(200),
    content: pageContentSchema,
    seoTitle: optionalSeoField,
    seoDescription: optionalSeoField,
    seoKeyword: optionalSeoField,
    folderId: z.string().trim().min(1).max(200),
  })
  .strict();

const snippetTriggerConfigSchema = z.union([
  selectorEventConfigSchema.strict(),
  pageLoadConfigSchema.strict(),
  scrollConfigSchema.strict(),
  referrerConfigSchema.strict(),
]);

export const snippetSnapshotSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    location: injectionPointSchema,
    content: snippetContentSchema,
    priority: z.number().int().nonnegative().nullable(),
    scopeType: scopeTypeSchema,
    pageIds: z.array(z.string().trim().min(1).max(200)).max(500),
    triggerType: triggerTypeSchema.nullable(),
    triggerConfig: snippetTriggerConfigSchema.nullable(),
    maxDisplays: z.number().int().min(1).max(1000).nullable(),
    displayResetDays: z.number().int().min(1).max(365).nullable(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.triggerType === null) {
      if (data.triggerConfig !== null) {
        ctx.addIssue({
          code: "custom",
          path: ["triggerConfig"],
          message: "triggerConfig requires a triggerType",
        });
      }
      return;
    }
    const matched = triggerFieldsSchema.safeParse({
      triggerType: data.triggerType,
      triggerConfig: data.triggerConfig,
    });
    if (!matched.success) {
      ctx.addIssue({
        code: "custom",
        path: ["triggerConfig"],
        message: "triggerConfig does not match triggerType",
      });
    }
  });

export const MAX_REVISION_PAGE_SIZE = 50;

export const revisionListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_REVISION_PAGE_SIZE)
      .default(20),
  })
  .strict();

export const revisionDiffQuerySchema = z
  .object({
    from: z.string().trim().min(1).max(200),
    to: z.string().trim().min(1).max(200),
  })
  .strict();

/** Restore exige a versão do rascunho para não sobrescrever edição concorrente. */
export const revisionRestoreSchema = z
  .object({
    expectedUpdatedAt: z.coerce.date(),
  })
  .strict();

export const revisionPinSchema = z
  .object({
    pinned: z.boolean(),
  })
  .strict();

export function parsePageSnapshot(
  input: unknown,
): { success: true; data: PageSnapshot } | { success: false } {
  const parsed = pageSnapshotSchema.safeParse(input);
  if (!parsed.success) return { success: false };
  return { success: true, data: parsed.data };
}

export function parseSnippetSnapshot(
  input: unknown,
): { success: true; data: SnippetSnapshot } | { success: false } {
  const parsed = snippetSnapshotSchema.safeParse(input);
  if (!parsed.success) return { success: false };
  return { success: true, data: parsed.data };
}
