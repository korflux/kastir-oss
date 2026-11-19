import { beforeEach, describe, expect, it, vi } from "vitest";

const { rebuildSettings } = vi.hoisted(() => ({
  rebuildSettings: vi.fn(async () => undefined),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/Publishing/settingsRebuild", () => ({ rebuildSettings }));

import { encryptCloudflareToken } from "@/lib/Modules/Settings/Crypto";
import { SettingsService } from "@/lib/Modules/Settings/Service";
import type { SiteSettingsRecord } from "@/lib/Modules/Settings/Types";

const secret = "a-stable-test-secret-with-at-least-32-bytes";

function createDatabase(initialOverrides: Partial<SiteSettingsRecord> = {}) {
  const now = new Date("2026-01-01T00:00:00.000Z");
  let row: SiteSettingsRecord = {
    id: "singleton",
    siteTitle: "Initial",
    tagline: null,
    seoDescription: null,
    faviconMediaId: null,
    siteUrl: null,
    siteLanguage: "en",
    timezone: "UTC",
    dateFormat: "DD/MM/YYYY",
    timeFormat: "24H",
    weekStartsOn: "SUNDAY",
    homePageId: null,
    indexable: true,
    allowAiCrawlers: true,
    sitemapEnabled: true,
    notFoundPageId: null,
    notFoundRedirectToHome: false,
    cloudflareApiTokenEncrypted: null,
    cloudflareZoneId: null,
    webpConversionEnabled: true,
    revisionRetentionLimit: 5,
    createdAt: now,
    updatedAt: now,
    ...initialOverrides,
  };
  const database = {
    siteSettings: {
      findUnique: vi.fn(async () => row),
      update: vi.fn(async ({ data }: { data: Partial<SiteSettingsRecord> }) => {
        row = {
          ...row,
          ...data,
          updatedAt: new Date("2026-01-02T00:00:00.000Z"),
        };
        return row;
      }),
    },
    page: {
      findUnique: vi.fn(async () => ({
        id: "home-page",
        status: "PUBLISHED",
        deletedAt: null,
      })),
      findMany: vi.fn(async () => []),
    },
    mediaFile: {
      findUnique: vi.fn(async () => ({
        id: "favicon",
        url: "/uploads/favicon.png",
        category: "IMAGE_RASTER",
        processingStatus: "READY",
      })),
      findMany: vi.fn(async () => []),
    },
    logEntry: { create: vi.fn(async () => undefined) },
    $transaction: vi.fn(
      async <T>(callback: (tx: typeof database) => Promise<T>) =>
        callback(database),
    ),
  };
  return { database, getRow: () => row };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    siteTitle: "Changed",
    seoDescription: "Description",
    faviconMediaId: null,
    siteUrl: null,
    siteLanguage: "en",
    timezone: "UTC",
    dateFormat: "DD/MM/YYYY",
    timeFormat: "24H",
    weekStartsOn: "SUNDAY",
    homePageId: null,
    indexable: true,
    allowAiCrawlers: true,
    cloudflareZoneId: null,
    webpConversionEnabled: true,
    revisionRetentionLimit: 5,
    ...overrides,
  };
}

describe("SettingsService", () => {
  beforeEach(() => {
    rebuildSettings.mockReset();
    rebuildSettings.mockResolvedValue(undefined);
  });

  it.each([
    ["siteTitle", "GLOBAL"],
    // Tagline only affects the compiled home page (see compile.ts's
    // `settings.isHome && settings.tagline` check), so it must route through
    // HOME like homePageId, not GLOBAL — a GLOBAL scope would rewrite every
    // published page on disk for a change that's invisible outside the home.
    ["tagline", "HOME"],
    ["seoDescription", "GLOBAL"],
    ["siteLanguage", "GLOBAL"],
    ["faviconMediaId", "GLOBAL"],
    ["indexable", "GLOBAL"],
    ["allowAiCrawlers", "ARTIFACTS"],
    ["sitemapEnabled", "ARTIFACTS"],
    ["notFoundPageId", "ARTIFACTS"],
    ["notFoundRedirectToHome", "ARTIFACTS"],
    ["homePageId", "HOME"],
    ["siteUrl", "ARTIFACTS"],
    ["timezone", "NONE"],
    ["dateFormat", "NONE"],
    ["timeFormat", "NONE"],
    ["weekStartsOn", "NONE"],
    ["webpConversionEnabled", "NONE"],
    ["revisionRetentionLimit", "NONE"],
  ])("maps %s to %s", async (field, expectedScope) => {
    vi.stubEnv("NEXTAUTH_SECRET", secret);
    const { database } = createDatabase();
    const add = vi.fn(async () => ({}) as never);
    const service = new SettingsService(database, { add });
    const values: Record<string, unknown> = {
      siteTitle: "Initial",
      tagline: null,
      seoDescription: null,
      siteLanguage: "en",
      faviconMediaId: null,
      indexable: true,
      allowAiCrawlers: true,
      homePageId: null,
      siteUrl: null,
      timezone: "UTC",
      dateFormat: "DD/MM/YYYY",
      timeFormat: "24H",
      weekStartsOn: "SUNDAY",
      webpConversionEnabled: true,
      revisionRetentionLimit: 5,
      sitemapEnabled: true,
      notFoundPageId: null,
      notFoundRedirectToHome: false,
    };
    const valuesForChange: Record<string, unknown> = {
      siteTitle: "Changed",
      tagline: "Short phrase",
      seoDescription: "Description",
      siteLanguage: "pt-BR",
      faviconMediaId: "favicon",
      indexable: false,
      allowAiCrawlers: false,
      homePageId: "home-page",
      siteUrl: "https://example.com",
      timezone: "America/Sao_Paulo",
      dateFormat: "YYYY-MM-DD",
      timeFormat: "12H",
      weekStartsOn: "MONDAY",
      webpConversionEnabled: false,
      revisionRetentionLimit: 30,
      sitemapEnabled: false,
      notFoundPageId: "home-page",
      notFoundRedirectToHome: true,
    };
    const result = await service.updateSettings(
      "admin",
      input({
        ...values,
        [field]: valuesForChange[field],
        ...(field === "siteUrl" ? { confirmSiteUrl: true } : {}),
      }),
    );
    expect(result.scope).toBe(expectedScope);
    expect(rebuildSettings).toHaveBeenCalledTimes(
      expectedScope === "NONE" ? 0 : 1,
    );
    expect(add).toHaveBeenCalledTimes(expectedScope === "NONE" ? 0 : 1);
  });

  it("rejects a public URL change without confirmSiteUrl", async () => {
    const { database } = createDatabase({
      siteUrl: "https://current.example.com",
    });
    const service = new SettingsService(database, {
      add: vi.fn(async () => ({}) as never),
    });

    await expect(
      service.updateSettings(
        "admin",
        input({ siteUrl: "https://other.example.com" }),
      ),
    ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    expect(database.siteSettings.update).not.toHaveBeenCalled();
  });

  it("persists a public URL change when confirmSiteUrl is true", async () => {
    const { database, getRow } = createDatabase({
      siteUrl: "https://current.example.com",
    });
    const service = new SettingsService(database, {
      add: vi.fn(async () => ({}) as never),
    });

    const result = await service.updateSettings(
      "admin",
      input({
        siteTitle: "Initial",
        seoDescription: null,
        siteUrl: "https://other.example.com",
        confirmSiteUrl: true,
      }),
    );

    expect(result.settings.siteUrl).toBe("https://other.example.com");
    expect(getRow().siteUrl).toBe("https://other.example.com");
  });

  it("persists revision retention without enqueueing a public rebuild", async () => {
    const { database, getRow } = createDatabase();
    const add = vi.fn(async () => ({}) as never);
    const service = new SettingsService(database, { add });
    const result = await service.updateSettings(
      "admin",
      input({
        siteTitle: "Initial",
        seoDescription: null,
        revisionRetentionLimit: 30,
      }),
    );
    expect(result.scope).toBe("NONE");
    expect(result.settings.revisionRetentionLimit).toBe(30);
    expect(getRow().revisionRetentionLimit).toBe(30);
    expect(rebuildSettings).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it("rejects setting a custom 404 page and redirect-to-home at the same time", async () => {
    // Mutual exclusivity is enforced client-side (SettingsWorkspace disables
    // one control while the other is on), but the API is a boundary of its
    // own — a direct PUT must not be able to set both, since
    // regeneratePublicArtifacts would then silently discard the custom page.
    const { database } = createDatabase();
    const service = new SettingsService(database, {
      add: vi.fn(async () => ({}) as never),
    });
    await expect(
      service.updateSettings(
        "admin",
        input({ notFoundPageId: "home-page", notFoundRedirectToHome: true }),
      ),
    ).rejects.toThrow(/mutually exclusive|both/i);
  });

  it("raises a combined home and global change to one GLOBAL job and one audit event", async () => {
    const { database } = createDatabase();
    const add = vi.fn(async () => ({}) as never);
    const result = await new SettingsService(database, { add }).updateSettings(
      "admin",
      input({
        siteTitle: "New title",
        homePageId: "home-page",
      }),
    );

    expect(result.scope).toBe("GLOBAL");
    expect(add).toHaveBeenCalledTimes(1);
    expect(database.logEntry.create).toHaveBeenCalledTimes(1);
    expect(database.logEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "SETTINGS_UPDATED",
        objectType: "SETTINGS",
      }),
    });
  });

  it("preserves, replaces and explicitly clears the encrypted token without returning it", async () => {
    vi.stubEnv("NEXTAUTH_SECRET", secret);
    const encrypted = encryptCloudflareToken("old-token", secret);
    const { database, getRow } = createDatabase({
      cloudflareApiTokenEncrypted: encrypted,
    });
    const service = new SettingsService(database, {
      add: vi.fn(async () => ({}) as never),
    });

    const base = input();
    await service.updateSettings("admin", base);
    expect(getRow().cloudflareApiTokenEncrypted).toBe(encrypted);
    expect((await service.getSettings()).cloudflareApiTokenConfigured).toBe(
      true,
    );

    await service.updateSettings("admin", {
      ...base,
      cloudflareApiToken: "new-token",
    });
    expect(getRow().cloudflareApiTokenEncrypted).not.toBe(encrypted);
    expect(getRow().cloudflareApiTokenEncrypted).not.toContain("new-token");

    await service.updateSettings("admin", {
      ...base,
      cloudflareApiToken: null,
    });
    expect(getRow().cloudflareApiTokenEncrypted).toBeNull();
  });

  it("preserves the zone id when omitted, replaces it when given, clears it when null", async () => {
    const { database, getRow } = createDatabase({
      cloudflareZoneId: "abcd1234abcd1234abcd1234abcd1234",
    });
    const service = new SettingsService(database, {
      add: vi.fn(async () => ({}) as never),
    });

    const { cloudflareZoneId: _omit, ...withoutZoneField } = input();
    void _omit;
    await service.updateSettings("admin", withoutZoneField);
    expect(getRow().cloudflareZoneId).toBe("abcd1234abcd1234abcd1234abcd1234");

    await service.updateSettings("admin", {
      ...withoutZoneField,
      cloudflareZoneId: "1234abcd1234abcd1234abcd1234abcd",
    });
    expect(getRow().cloudflareZoneId).toBe("1234abcd1234abcd1234abcd1234abcd");

    await service.updateSettings("admin", {
      ...withoutZoneField,
      cloudflareZoneId: null,
    });
    expect(getRow().cloudflareZoneId).toBeNull();
  });

  it("propagates an MCP audit context onto the SETTINGS_UPDATED log entry", async () => {
    const { database } = createDatabase();
    const service = new SettingsService(database, {
      add: vi.fn(async () => ({}) as never),
    });

    await service.updateSettings("admin", input(), {
      source: "MCP",
      tool: "kastir_settings_update",
      resource: "https://public.example/api/mcp",
      requestId: "request-1",
    });

    expect(database.logEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "SETTINGS_UPDATED",
        source: "MCP",
        tool: "kastir_settings_update",
        resource: "https://public.example/api/mcp",
        requestId: "request-1",
      }),
    });
  });

  it("includes userId and audit in the enqueued settings-rebuild job for MCP-originated updates", async () => {
    const { database } = createDatabase();
    const add = vi.fn(async () => ({}) as never);
    const service = new SettingsService(database, { add });

    await service.updateSettings(
      "admin",
      input({ siteTitle: "Renamed via MCP" }),
      {
        source: "MCP",
        tool: "kastir_settings_update",
        resource: "https://public.example/api/mcp",
        requestId: "request-1",
      },
    );

    expect(add).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        type: "settings-rebuild",
        userId: "admin",
        audit: expect.objectContaining({
          source: "MCP",
          tool: "kastir_settings_update",
        }),
      }),
      expect.anything(),
    );
  });

  it("always rebuilds inline after save so published HTML updates immediately", async () => {
    const { database, getRow } = createDatabase();
    const add = vi.fn(async () => ({}) as never);
    const result = await new SettingsService(database, { add }).updateSettings(
      "admin",
      input({ siteTitle: "Persisted" }),
    );

    expect(getRow().siteTitle).toBe("Persisted");
    expect(result.queueStatus).toBe("ENQUEUED");
    expect(rebuildSettings).toHaveBeenCalledWith("GLOBAL", []);
    expect(add).toHaveBeenCalledTimes(1);
    expect(database.logEntry.create).toHaveBeenCalledTimes(1);
    const enqueueArgs = add.mock.calls[0] as unknown as [
      string,
      unknown,
      { jobId?: string },
    ];
    expect(enqueueArgs[2].jobId).toMatch(/^settings-rebuild-/);
    expect(enqueueArgs[2].jobId).not.toContain(":");
    // A plain panel call (no audit context) must not tag the job as MCP-owned —
    // kastir_operation_get otherwise couldn't tell PANEL and MCP jobs apart.
    expect(enqueueArgs[1]).not.toHaveProperty("audit");
  });

  it("still succeeds when the optional queue enqueue fails after inline rebuild", async () => {
    const { database, getRow } = createDatabase();
    const result = await new SettingsService(database, {
      add: vi.fn(async () => {
        throw new Error("redis unavailable");
      }),
    }).updateSettings("admin", input({ siteTitle: "Persisted" }));

    expect(getRow().siteTitle).toBe("Persisted");
    expect(result.queueStatus).toBe("ENQUEUED");
    expect(rebuildSettings).toHaveBeenCalledWith("GLOBAL", []);
  });

  it("reports FAILED when the inline rebuild fails", async () => {
    rebuildSettings.mockRejectedValueOnce(new Error("disk full"));
    const { database, getRow } = createDatabase();
    const result = await new SettingsService(database, {
      add: vi.fn(async () => ({}) as never),
    }).updateSettings("admin", input({ siteTitle: "Still saved" }));

    expect(getRow().siteTitle).toBe("Still saved");
    expect(result.queueStatus).toBe("FAILED");
  });

  it("caps selector options for favicon and home pages", async () => {
    const { database } = createDatabase();
    database.mediaFile.findMany = vi.fn(async () => []);
    database.page.findMany = vi.fn(async () => []);
    await new SettingsService(database).listOptions();
    expect(database.mediaFile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100, orderBy: { name: "asc" } }),
    );
    expect(database.page.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100, orderBy: { title: "asc" } }),
    );
  });
});
