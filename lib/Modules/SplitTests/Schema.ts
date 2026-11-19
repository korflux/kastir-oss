import { z } from "zod";

import {
  assertCampaignSlug,
  normalizeSlug,
} from "@/lib/Modules/SplitTests/slug";
import { bulkIdsSchema } from "@/lib/Modules/Shared/Bulk";

export const listCampaignsQuerySchema = z
  .object({
    search: z.string().optional(),
    status: z.enum(["ACTIVE", "PAUSED"]).optional(),
    trash: z.enum(["1", "true"]).optional(),
    page: z.coerce.number().int().min(1).max(10_000).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
  })
  .transform((value) => ({
    search: value.search,
    status: value.status,
    includeDeleted: value.trash === "1" || value.trash === "true",
    page: value.page,
    pageSize: value.pageSize,
  }));

/**
 * Destination may be a same-site path (`/…`) or an absolute http(s) URL.
 * External absolute URLs are intentional open redirects configured by panel
 * users (MASTER/ADMIN/EDITOR) — not end-user input on the public path.
 */
export function assertDestinationUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Destination URL is required");
  }

  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("vbscript:")
  ) {
    throw new Error("Destination URL scheme is not allowed");
  }

  if (trimmed.startsWith("//")) {
    throw new Error("Protocol-relative destination URLs are not allowed");
  }

  if (trimmed.startsWith("/")) {
    if (trimmed.startsWith("//") || trimmed.includes("\\")) {
      throw new Error("Invalid internal destination path");
    }
    return trimmed;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Destination URL is invalid");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Destination URL must use http or https");
  }

  return trimmed;
}

const destinationUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .superRefine((value, ctx) => {
    try {
      assertDestinationUrl(value);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Invalid URL",
      });
    }
  });

/** Name (label) obrigatório no create — Figma SplitTests EDIT. */
const destinationLabelSchema = z.string().trim().min(1).max(200);

const destinationInputSchema = z.object({
  url: destinationUrlSchema,
  label: destinationLabelSchema,
});

export const createCampaignSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => (value ? normalizeSlug(value) : undefined)),
  destinations: z.array(destinationInputSchema).min(1),
});

export const updateCampaignSchema = z
  .object({
    expectedUpdatedAt: z.coerce.date().optional(),
    name: z.string().trim().min(1).max(200).optional(),
    slug: z.string().trim().min(1).max(200).optional(),
    status: z.enum(["ACTIVE", "PAUSED"]).optional(),
  })
  .strict();

export const createDestinationSchema = destinationInputSchema;

export const updateDestinationSchema = z.object({
  expectedUpdatedAt: z.coerce.date().optional(),
  url: destinationUrlSchema.optional(),
  // Update: se enviar label, não pode ser vazio (null limpa — bloqueado aqui).
  label: destinationLabelSchema.optional(),
  status: z.enum(["ACTIVE", "PAUSED"]).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export const reorderDestinationsSchema = z.object({
  orderedIds: z.array(z.string().trim().min(1)).min(1),
});

/** Contrato estrito do bulk; exclusão permanente exige confirmação explícita. */
export const bulkSplitTestsSchema = z.discriminatedUnion("action", [
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

export type BulkSplitTestsInput = z.infer<typeof bulkSplitTestsSchema>;

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;
export type CreateDestinationInput = z.infer<typeof createDestinationSchema>;
export type UpdateDestinationInput = z.infer<typeof updateDestinationSchema>;

export function parseCampaignSlug(value: string): string {
  return assertCampaignSlug(value);
}
