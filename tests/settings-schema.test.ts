import { describe, expect, it } from "vitest";

import {
  settingsInputSchema,
  settingsUpdateRequestSchema,
} from "@/lib/Modules/Settings/Schema";

const validSettings = {
  siteTitle: "Kastir",
  tagline: "Efficient CMS",
  seoDescription: "A static site",
  faviconMediaId: null,
  siteUrl: "https://example.com",
  siteLanguage: "pt-BR",
  timezone: "America/Sao_Paulo",
  dateFormat: "DD/MM/YYYY",
  timeFormat: "24H",
  weekStartsOn: "SUNDAY" as const,
  homePageId: null,
  indexable: true,
  allowAiCrawlers: true,
  sitemapEnabled: false,
  notFoundPageId: null,
  notFoundRedirectToHome: false,
  cloudflareZoneId: null,
  webpConversionEnabled: true,
  revisionRetentionLimit: 5,
};

describe("site settings schema", () => {
  it("accepts the complete public form payload and keeps token replacement optional", () => {
    expect(settingsInputSchema.parse(validSettings)).toMatchObject(
      validSettings,
    );
    expect(
      settingsInputSchema.parse({
        ...validSettings,
        cloudflareApiToken: "token-to-replace",
      }).cloudflareApiToken,
    ).toBe("token-to-replace");
    expect(
      settingsInputSchema.parse({
        ...validSettings,
        cloudflareApiToken: null,
      }).cloudflareApiToken,
    ).toBeNull();
  });

  it("rejects empty titles, invalid URLs, timezones, enums and unknown client fields", () => {
    expect(() =>
      settingsInputSchema.parse({ ...validSettings, siteTitle: " " }),
    ).toThrow();
    expect(() =>
      settingsInputSchema.parse({
        ...validSettings,
        siteUrl: "javascript:alert(1)",
      }),
    ).toThrow();
    expect(() =>
      settingsInputSchema.parse({
        ...validSettings,
        timezone: "Not/A_Timezone",
      }),
    ).toThrow();
    expect(() =>
      settingsInputSchema.parse({ ...validSettings, timeFormat: "AMPM" }),
    ).toThrow();
    expect(() =>
      settingsInputSchema.parse({ ...validSettings, role: "ADMIN" }),
    ).toThrow();
    expect(() =>
      settingsInputSchema.parse({
        ...validSettings,
        cloudflareApiTokenEncrypted: "ciphertext",
      }),
    ).toThrow();
  });

  it("rejects UTC offsets past the real -12..+14 range even though the regex is offset-symmetric", () => {
    // UTC-13/UTC-14 aren't real offsets (real range is -12..+14), but a naive
    // regex allows the same magnitude on both signs. These must be rejected,
    // not silently accepted and later crash Intl.DateTimeFormat with an
    // "Etc/GMT+13"/"Etc/GMT+14" zone that doesn't exist.
    expect(() =>
      settingsInputSchema.parse({ ...validSettings, timezone: "UTC-13" }),
    ).toThrow();
    expect(() =>
      settingsInputSchema.parse({ ...validSettings, timezone: "UTC-14" }),
    ).toThrow();
    // Boundary values on both sides must still be accepted.
    expect(
      settingsInputSchema.parse({ ...validSettings, timezone: "UTC-12" })
        .timezone,
    ).toBe("UTC-12");
    expect(
      settingsInputSchema.parse({ ...validSettings, timezone: "UTC+14" })
        .timezone,
    ).toBe("UTC+14");
  });

  it("accepts revision retention at 5 and 30 and rejects values outside the allowlist", () => {
    expect(
      settingsInputSchema.parse({ ...validSettings, revisionRetentionLimit: 5 })
        .revisionRetentionLimit,
    ).toBe(5);
    expect(
      settingsInputSchema.parse({
        ...validSettings,
        revisionRetentionLimit: 30,
      }).revisionRetentionLimit,
    ).toBe(30);
    expect(() =>
      settingsInputSchema.parse({
        ...validSettings,
        revisionRetentionLimit: 4,
      }),
    ).toThrow();
    expect(() =>
      settingsInputSchema.parse({
        ...validSettings,
        revisionRetentionLimit: 31,
      }),
    ).toThrow();
    expect(() =>
      settingsInputSchema.parse({
        ...validSettings,
        revisionRetentionLimit: 5.5,
      }),
    ).toThrow();
    expect(() =>
      settingsInputSchema.parse({
        ...validSettings,
        revisionRetentionLimit: "5",
      }),
    ).toThrow();
  });

  it("keeps URL confirmation as an explicit request concern", () => {
    expect(
      settingsUpdateRequestSchema.parse({
        ...validSettings,
        confirmSiteUrl: true,
      }).confirmSiteUrl,
    ).toBe(true);
    expect(() =>
      settingsUpdateRequestSchema.parse({
        ...validSettings,
        confirmSiteUrl: "yes",
      }),
    ).toThrow();
  });
});
