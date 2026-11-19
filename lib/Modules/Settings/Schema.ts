import { z } from "zod";

import {
  REVISION_RETENTION_MAX,
  REVISION_RETENTION_MIN,
} from "@/lib/Modules/Settings/revisionRetention";

const siteLanguageSchema = z
  .string()
  .trim()
  .regex(
    /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2})?$/,
    "Invalid site language",
  )
  .max(35);

const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => {
    // Real offsets only go UTC-12..UTC+14 — the sign is not symmetric.
    if (/^UTC(?:-(?:[0-9]|1[0-2])|\+(?:[0-9]|1[0-4]))?$/.test(value))
      return true;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, "Invalid IANA timezone");

const nullableIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .nullable()
  .optional();
const optionalUrlSchema = z
  .url()
  .refine(
    (value) => /^https?:$/.test(new URL(value).protocol),
    "URL must use HTTP(S)",
  )
  .transform((value) => value.replace(/\/+$/, ""))
  .nullable()
  .optional();

export const settingsInputSchema = z
  .object({
    siteTitle: z.string().trim().min(1).max(200),
    tagline: z.string().trim().max(200).nullable().optional(),
    seoDescription: z.string().trim().max(320).nullable().optional(),
    faviconMediaId: nullableIdSchema,
    siteUrl: optionalUrlSchema,
    siteLanguage: siteLanguageSchema,
    timezone: timezoneSchema,
    dateFormat: z.enum(["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]),
    timeFormat: z.enum(["24H", "12H"]),
    weekStartsOn: z.enum([
      "SUNDAY",
      "MONDAY",
      "TUESDAY",
      "WEDNESDAY",
      "THURSDAY",
      "FRIDAY",
      "SATURDAY",
    ]),
    homePageId: nullableIdSchema,
    indexable: z.boolean(),
    allowAiCrawlers: z.boolean(),
    sitemapEnabled: z.boolean().default(true),
    notFoundPageId: nullableIdSchema,
    notFoundRedirectToHome: z.boolean().default(false),
    cloudflareApiToken: z.string().trim().min(1).max(500).nullable().optional(),
    cloudflareZoneId: z
      .string()
      .trim()
      .regex(/^[a-f0-9]{32}$/i)
      .nullable()
      .optional(),
    webpConversionEnabled: z.boolean(),
    revisionRetentionLimit: z
      .number()
      .int()
      .min(REVISION_RETENTION_MIN)
      .max(REVISION_RETENTION_MAX),
  })
  .strict();

export const settingsUpdateRequestSchema = settingsInputSchema
  .extend({
    confirmSiteUrl: z.boolean().optional().default(false),
  })
  .strict();

export type ParsedSettingsInput = z.infer<typeof settingsInputSchema>;
export type ParsedSettingsUpdateRequest = z.infer<
  typeof settingsUpdateRequestSchema
>;
