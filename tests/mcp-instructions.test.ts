import { describe, expect, it } from "vitest";

import {
  buildMcpInstructions,
  buildMcpInstructionsFallback,
  buildMcpInstructionsFromSettings,
  MCP_KASTIR_CONCEPTS,
} from "@/lib/Modules/Mcp/Instructions";
import { MCP_POPUP_PLAYBOOK } from "@/lib/Modules/Mcp/Guide";
import { toMcpPublicSettings } from "@/lib/Modules/Mcp/Tools/publicSiteSettings";
import type { PublicSiteSettings } from "@/lib/Modules/Settings/Types";

const publicSettings = {
  siteTitle: "Kastir Demo",
  tagline: "Ship pages",
  seoDescription: "A demo CMS site",
  faviconMediaId: "media-1",
  siteUrl: "https://demo.example",
  siteLanguage: "pt-BR",
  timezone: "America/Sao_Paulo",
  dateFormat: "DD/MM/YYYY",
  timeFormat: "24H",
  weekStartsOn: "MONDAY",
  homePageId: "page-home",
  indexable: true,
  allowAiCrawlers: false,
  sitemapEnabled: true,
  notFoundPageId: "page-404",
  notFoundRedirectToHome: false,
  webpConversionEnabled: true,
  revisionRetentionLimit: 5,
} as const;

const fullSettings = {
  ...publicSettings,
  id: "singleton",
  cloudflareApiTokenEncrypted: "secret-token",
  cloudflareZoneId: "zone-secret",
  cloudflareApiTokenConfigured: true,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
} as PublicSiteSettings;

describe("buildMcpInstructions", () => {
  it("includes site identity, formats, navigation, indexing and derived URLs", () => {
    const text = buildMcpInstructions({
      settings: { ...publicSettings },
      origin: "https://demo.example",
    });

    expect(text).toContain("Kastir Demo");
    expect(text).toContain("Ship pages");
    expect(text).toContain("A demo CMS site");
    expect(text).toContain("https://demo.example");
    expect(text).toContain("pt-BR");
    expect(text).toContain("America/Sao_Paulo");
    expect(text).toContain("DD/MM/YYYY");
    expect(text).toContain("24H");
    expect(text).toContain("MONDAY");
    expect(text).toContain("page-home");
    expect(text).toContain("page-404");
    expect(text).toContain("indexable: yes");
    expect(text).toContain("allowAiCrawlers: no");
    expect(text).toContain("sitemapEnabled: yes");
    expect(text).toContain("https://demo.example/robots.txt");
    expect(text).toContain("https://demo.example/llms.txt");
    expect(text).toContain("https://demo.example/sitemap.xml");
    expect(text).toContain("kastir_settings_get");
    expect(text).toContain(MCP_KASTIR_CONCEPTS.slice(0, 40));
    expect(text).toContain("kastir_guide_get");
    expect(text).not.toContain(MCP_POPUP_PLAYBOOK.slice(0, 40));
  });

  it("carries the panel switch playbook in the handshake, with and without settings", () => {
    const withSettings = buildMcpInstructions({
      settings: { ...publicSettings },
      origin: "https://demo.example",
    });
    for (const text of [withSettings, buildMcpInstructionsFallback()]) {
      expect(text).toContain("'No ar'");
      expect(text).toContain("'Fora do ar'");
      expect(text).toContain("INVALID_STATE");
      expect(text).toContain("kastir_pages_activate");
      expect(text).toContain("kastir_scripts_activate");
      expect(text).toMatch(/turn off = unpublish/i);
      // Conceitos antigos continuam: publish segue sendo o caminho de "ligar".
      expect(text).toContain("kastir_pages_publish");
      expect(text).toContain("kastir_scripts_publish");
    }
  });

  it("omits sitemap.xml when sitemapEnabled is false and nothing else", () => {
    const text = buildMcpInstructions({
      settings: { ...publicSettings, sitemapEnabled: false },
      origin: "https://demo.example",
    });
    expect(text).not.toContain("sitemap.xml");
    expect(text).toContain("robots.txt");
    expect(text).toContain("llms.txt");
    expect(text).toContain("sitemapEnabled: no");
  });

  it("never leaks Cloudflare token/zone when built from full settings", () => {
    const text = buildMcpInstructionsFromSettings(
      fullSettings,
      "https://demo.example",
    );
    expect(text).not.toContain("secret-token");
    expect(text).not.toContain("zone-secret");
    expect(text).not.toContain("cloudflare");
    // Projection still only public keys
    const projected = toMcpPublicSettings(fullSettings);
    expect(projected).not.toHaveProperty("cloudflareApiTokenEncrypted");
    expect(projected).not.toHaveProperty("cloudflareZoneId");
  });

  it("stays within the handshake byte budget", () => {
    const text = buildMcpInstructions({
      settings: { ...publicSettings },
      origin: "https://demo.example",
    });
    const bytes = Buffer.byteLength(text, "utf8");
    expect(bytes).toBeGreaterThan(200);
    expect(bytes).toBeLessThanOrEqual(3_000);
  });

  it("fallback still carries concepts and points to the guide", () => {
    const text = buildMcpInstructionsFallback();
    expect(text).toContain("kastir_settings_get");
    expect(text).toContain("Draft vs published");
    expect(text).toContain("kastir_guide_get");
    expect(text).not.toContain(MCP_POPUP_PLAYBOOK.slice(0, 40));
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(3_000);
  });

  it("truncates long free-text fields so the budget cannot be blown by SEO copy", () => {
    const text = buildMcpInstructions({
      settings: {
        ...publicSettings,
        siteTitle: "T".repeat(400),
        tagline: "G".repeat(400),
        seoDescription: "D".repeat(800),
      },
      origin: "https://demo.example",
    });
    expect(text).toContain("…");
    expect(text).not.toContain("T".repeat(200));
    expect(text).not.toContain("D".repeat(300));
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(3_000);
  });
});
