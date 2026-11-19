import { REVISION_RETENTION_DEFAULT } from "@/lib/Modules/Settings/revisionRetention";
import type {
  PublicSiteSettings,
  WeekStart,
} from "@/lib/Modules/Settings/Types";

/** Estado editável comum às abas General e Settings (PUT manda o objeto inteiro). */
export type SettingsFormState = {
  siteTitle: string;
  tagline: string;
  seoDescription: string;
  faviconMediaId: string;
  siteUrl: string;
  siteLanguage: string;
  timezone: string;
  dateFormat: "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";
  timeFormat: "24H" | "12H";
  weekStartsOn: WeekStart;
  homePageId: string;
  notFoundPageId: string;
  notFoundRedirectToHome: boolean;
  indexable: boolean;
  allowAiCrawlers: boolean;
  sitemapEnabled: boolean;
  cloudflareApiToken: string;
  removeCloudflareToken: boolean;
  cloudflareZoneId: string;
  webpConversionEnabled: boolean;
  revisionRetentionLimit: number;
};

export function initialForm(settings: PublicSiteSettings): SettingsFormState {
  return {
    siteTitle: settings.siteTitle,
    tagline: settings.tagline ?? "",
    seoDescription: settings.seoDescription ?? "",
    faviconMediaId: settings.faviconMediaId ?? "",
    // null siteUrl = origin da request no server; não materializar window.location aqui.
    siteUrl: settings.siteUrl ?? "",
    siteLanguage: settings.siteLanguage,
    timezone: settings.timezone,
    dateFormat: settings.dateFormat,
    timeFormat: settings.timeFormat,
    weekStartsOn: settings.weekStartsOn,
    homePageId: settings.homePageId ?? "",
    notFoundPageId: settings.notFoundPageId ?? "",
    notFoundRedirectToHome: settings.notFoundRedirectToHome,
    indexable: settings.indexable,
    allowAiCrawlers: settings.allowAiCrawlers,
    sitemapEnabled: settings.sitemapEnabled,
    cloudflareApiToken: "",
    removeCloudflareToken: false,
    cloudflareZoneId: settings.cloudflareZoneId ?? "",
    webpConversionEnabled: settings.webpConversionEnabled,
    revisionRetentionLimit:
      settings.revisionRetentionLimit ?? REVISION_RETENTION_DEFAULT,
  };
}

/** Monta o payload strict do PUT — sempre o objeto completo. */
export function buildSettingsPayload(
  form: SettingsFormState,
  confirmSiteUrl = false,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    siteTitle: form.siteTitle,
    tagline: form.tagline || null,
    seoDescription: form.seoDescription || null,
    faviconMediaId: form.faviconMediaId || null,
    siteUrl: form.siteUrl || null,
    siteLanguage: form.siteLanguage,
    timezone: form.timezone,
    dateFormat: form.dateFormat,
    timeFormat: form.timeFormat,
    weekStartsOn: form.weekStartsOn,
    homePageId: form.homePageId || null,
    notFoundPageId: form.notFoundPageId || null,
    notFoundRedirectToHome: form.notFoundRedirectToHome,
    indexable: form.indexable,
    allowAiCrawlers: form.allowAiCrawlers,
    sitemapEnabled: form.sitemapEnabled,
    cloudflareZoneId: form.cloudflareZoneId || null,
    webpConversionEnabled: form.webpConversionEnabled,
    revisionRetentionLimit: form.revisionRetentionLimit,
  };
  if (form.cloudflareApiToken.trim()) {
    payload.cloudflareApiToken = form.cloudflareApiToken.trim();
  } else if (form.removeCloudflareToken) {
    payload.cloudflareApiToken = null;
  }
  if (confirmSiteUrl) payload.confirmSiteUrl = true;
  return payload;
}

/** Aplica resposta do server no form (limpa token digitado). */
export function applySettingsResponse(
  current: SettingsFormState,
  settings: PublicSiteSettings,
): SettingsFormState {
  return {
    ...current,
    siteTitle: settings.siteTitle,
    tagline: settings.tagline ?? "",
    seoDescription: settings.seoDescription ?? "",
    faviconMediaId: settings.faviconMediaId ?? "",
    siteUrl: settings.siteUrl ?? "",
    siteLanguage: settings.siteLanguage,
    timezone: settings.timezone,
    dateFormat: settings.dateFormat,
    timeFormat: settings.timeFormat,
    weekStartsOn: settings.weekStartsOn,
    homePageId: settings.homePageId ?? "",
    notFoundPageId: settings.notFoundPageId ?? "",
    notFoundRedirectToHome: settings.notFoundRedirectToHome,
    indexable: settings.indexable,
    allowAiCrawlers: settings.allowAiCrawlers,
    sitemapEnabled: settings.sitemapEnabled,
    cloudflareZoneId: settings.cloudflareZoneId ?? "",
    webpConversionEnabled: settings.webpConversionEnabled,
    revisionRetentionLimit:
      settings.revisionRetentionLimit ?? REVISION_RETENTION_DEFAULT,
    cloudflareApiToken: "",
    removeCloudflareToken: false,
  };
}

export function fieldClass(): string {
  return "border-input bg-muted/40 focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-3";
}

export function labelClass(): string {
  return "text-muted-foreground shrink-0 text-sm";
}
