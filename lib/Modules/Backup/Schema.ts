import { z } from "zod";

import {
  BACKUP_AUTO_INTERVAL_DAYS_MAX,
  PACKAGE_FORMAT,
  RESTORE_CONFIRMATION_PHRASE,
} from "@/lib/Modules/Backup/constants";

const originSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        /^https?:$/.test(url.protocol) &&
        !url.username &&
        !url.password &&
        (url.pathname === "/" || url.pathname === "") &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  }, "Invalid HTTP(S) origin");

export const packageIncludesSchema = z
  .object({
    pages: z.boolean(),
    media: z.boolean(),
    settings: z.boolean(),
    customCode: z.boolean(),
    splitTests: z.boolean(),
    users: z.boolean(),
    publishedHtml: z.boolean(),
  })
  .strict();

export const packageCountsSchema = z
  .object({
    pages: z.number().int().nonnegative(),
    mediaFiles: z.number().int().nonnegative(),
    assetBytes: z.number().int().nonnegative(),
    users: z.number().int().nonnegative(),
  })
  .strict();

export const sitePackageManifestSchema = z
  .object({
    format: z.literal(PACKAGE_FORMAT),
    packageFormatVersion: z.number().int().positive(),
    kastirVersion: z.string().min(1).max(64),
    schemaVersion: z.string().min(1).max(200),
    createdAt: z.string().datetime(),
    origin: originSchema,
    siteTitle: z.string().max(200),
    includes: packageIncludesSchema,
    counts: packageCountsSchema,
    checksums: z.record(z.string(), z.string()),
    secretsOmitted: z.boolean().optional(),
  })
  .strict();

export const restoreConfirmSchema = z
  .object({
    confirmation: z.literal(RESTORE_CONFIRMATION_PHRASE),
    snapshotId: z.string().min(1).max(200),
  })
  .strict();

export const importConfirmSchema = z
  .object({
    confirmation: z.literal(RESTORE_CONFIRMATION_PHRASE),
    jobId: z
      .string()
      .regex(/^[a-zA-Z0-9_-]+$/)
      .max(200)
      .optional(),
    sourceOrigin: originSchema.optional(),
    targetOrigin: originSchema,
  })
  .strict();

export function parseSitePackageManifest(input: unknown) {
  return sitePackageManifestSchema.safeParse(input);
}

/** Payload de POST action=schedule — intervalo em dias + horário no fuso do site. */
export const backupAutoScheduleSchema = z
  .object({
    enabled: z.boolean(),
    intervalDays: z.number().int().min(1).max(BACKUP_AUTO_INTERVAL_DAYS_MAX),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
  })
  .strict();

export type BackupAutoScheduleInput = z.infer<typeof backupAutoScheduleSchema>;
