import { z } from "zod";

import {
  FOLDER_PRESET_COLORS,
  folderColorSchema,
} from "@/lib/Modules/Shared/FolderSchema";
import { BULK_IDS_MAX } from "@/lib/Modules/Shared/BulkConstants";

export { FOLDER_PRESET_COLORS, folderColorSchema };

export const MEDIA_NAME_MAX_LENGTH = 255;
export const MEDIA_ALT_MAX_LENGTH = 500;
export const MEDIA_DESCRIPTION_MAX_LENGTH = 5000;

export const createMediaFolderSchema = z.object({
  name: z.string().trim().min(1).max(100),
  parentId: z.string().trim().min(1).nullable().optional(),
  color: folderColorSchema.nullable().optional(),
});

export const updateMediaFolderSchema = createMediaFolderSchema
  .partial()
  .extend({
    id: z.string().trim().min(1),
  });

/** Scope 3 — delete exige destino de realocação. */
export const deleteMediaFolderSchema = z.object({
  id: z.string().trim().min(1),
  reassignToFolderId: z.string().trim().min(1),
});

/** Scope 3 — mover pasta (newParentId null = vira raiz). */
export const moveMediaFolderSchema = z.object({
  id: z.string().trim().min(1),
  newParentId: z.string().trim().min(1).nullable(),
});

export const updateMediaMetadataSchema = z.object({
  id: z.string().trim().min(1),
  folderId: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).max(MEDIA_NAME_MAX_LENGTH).optional(),
  alt: z.string().trim().max(MEDIA_ALT_MAX_LENGTH).nullable().optional(),
  description: z
    .string()
    .trim()
    .max(MEDIA_DESCRIPTION_MAX_LENGTH)
    .nullable()
    .optional(),
});

// MediaFile usa UUID gerado pelo serviço; páginas/scripts usam CUID no schema compartilhado.
const bulkMediaIdsSchema = z
  .array(z.string().trim().uuid())
  .min(1)
  .max(BULK_IDS_MAX);

/** Allowlist canônica de Mídia: cada ação continua no serviço individual. */
export const bulkMediaSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("move-folder"),
      ids: bulkMediaIdsSchema,
      folderId: z.string().trim().cuid(),
    })
    .strict(),
  z
    .object({ action: z.literal("convert-webp"), ids: bulkMediaIdsSchema })
    .strict(),
  z.object({ action: z.literal("delete"), ids: bulkMediaIdsSchema }).strict(),
]);

export type BulkMediaInput = z.infer<typeof bulkMediaSchema>;

export type CreateMediaFolderInput = z.infer<typeof createMediaFolderSchema>;
export type UpdateMediaFolderInput = z.infer<typeof updateMediaFolderSchema>;
export type DeleteMediaFolderInput = z.infer<typeof deleteMediaFolderSchema>;
export type MoveMediaFolderInput = z.infer<typeof moveMediaFolderSchema>;
export type UpdateMediaMetadataInput = z.infer<
  typeof updateMediaMetadataSchema
>;
