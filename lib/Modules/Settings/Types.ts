export const SETTINGS_ID = "singleton";

/** Cap for favicon / home page selectors to avoid unbounded admin payloads. */
export const SETTINGS_OPTIONS_LIMIT = 100;

export const SETTINGS_SCOPES = ["NONE", "HOME", "ARTIFACTS", "GLOBAL"] as const;
export type SettingsRebuildScope = (typeof SETTINGS_SCOPES)[number];

export type WeekStart =
  | "SUNDAY"
  | "MONDAY"
  | "TUESDAY"
  | "WEDNESDAY"
  | "THURSDAY"
  | "FRIDAY"
  | "SATURDAY";
export type DateFormat = "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";
export type TimeFormat = "24H" | "12H";

export type SiteSettingsRecord = {
  id: string;
  siteTitle: string;
  tagline: string | null;
  seoDescription: string | null;
  faviconMediaId: string | null;
  siteUrl: string | null;
  siteLanguage: string;
  timezone: string;
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
  weekStartsOn: WeekStart;
  homePageId: string | null;
  indexable: boolean;
  allowAiCrawlers: boolean;
  sitemapEnabled: boolean;
  notFoundPageId: string | null;
  notFoundRedirectToHome: boolean;
  cloudflareApiTokenEncrypted: string | null;
  cloudflareZoneId: string | null;
  webpConversionEnabled: boolean;
  revisionRetentionLimit: number;
  createdAt: Date;
  updatedAt: Date;
};

export type PublicSiteSettings = Omit<
  SiteSettingsRecord,
  "cloudflareApiTokenEncrypted"
> & {
  cloudflareApiTokenConfigured: boolean;
};

export type SettingsInput = {
  siteTitle: string;
  tagline?: string | null;
  seoDescription?: string | null;
  faviconMediaId?: string | null;
  siteUrl?: string | null;
  siteLanguage: string;
  timezone: string;
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
  weekStartsOn: WeekStart;
  homePageId?: string | null;
  indexable: boolean;
  allowAiCrawlers: boolean;
  sitemapEnabled: boolean;
  notFoundPageId?: string | null;
  notFoundRedirectToHome: boolean;
  /** undefined preserves; null explicitly removes; string replaces. */
  cloudflareApiToken?: string | null;
  cloudflareZoneId?: string | null;
  webpConversionEnabled: boolean;
  revisionRetentionLimit: number;
};

export type SettingsUpdateRequest = SettingsInput & {
  confirmSiteUrl?: boolean;
};

export type SettingsErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "CONFLICT"
  | "CONFIRMATION_REQUIRED"
  | "QUEUE_FAILED";

export class SettingsDomainError extends Error {
  constructor(
    public readonly code: SettingsErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "SettingsDomainError";
  }
}
