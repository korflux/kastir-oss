import { beforeEach, describe, expect, it, vi } from "vitest";

const updateSettings = vi.hoisted(() => vi.fn());
const getSettings = vi.hoisted(() => vi.fn());

vi.mock("@/lib/Modules/Settings/Service", () => ({
  settingsService: { updateSettings, getSettings },
}));

beforeEach(() => {
  updateSettings.mockReset();
  getSettings.mockReset();
  getSettings.mockResolvedValue({ revisionRetentionLimit: 30 });
});

const adminContext = {
  actor: { id: "user-1", name: "Admin", email: "admin@example.test" },
  userId: "user-1",
  role: "ADMIN" as const,
  scopes: ["cms:read", "cms:settings:write"] as const,
  clientId: "client-1",
  resource: "https://public.example/api/mcp",
  requestId: "request-1",
};

const validInput = {
  siteTitle: "My Site",
  siteLanguage: "en",
  timezone: "UTC",
  dateFormat: "DD/MM/YYYY" as const,
  timeFormat: "24H" as const,
  weekStartsOn: "SUNDAY" as const,
  indexable: true,
  allowAiCrawlers: true,
  sitemapEnabled: true,
  notFoundRedirectToHome: false,
  webpConversionEnabled: true,
  revisionRetentionLimit: 5,
};

const updateResult = {
  settings: {
    siteTitle: "My Site",
    tagline: null,
    seoDescription: null,
    faviconMediaId: null,
    siteUrl: null,
    siteLanguage: "en",
    timezone: "UTC",
    dateFormat: "DD/MM/YYYY" as const,
    timeFormat: "24H" as const,
    weekStartsOn: "SUNDAY" as const,
    homePageId: null,
    indexable: true,
    allowAiCrawlers: true,
    sitemapEnabled: true,
    notFoundPageId: null,
    notFoundRedirectToHome: false,
    webpConversionEnabled: true,
    revisionRetentionLimit: 5,
    cloudflareApiTokenConfigured: true,
    cloudflareZoneId: "abcd1234abcd1234abcd1234abcd1234",
    cloudflareApiTokenEncrypted: "encrypted-secret",
  },
  scope: "GLOBAL" as const,
  operationId: "op-1",
  affectedPageIds: [],
  queueStatus: "ENQUEUED" as const,
};

describe("MCP kastir_settings_update", () => {
  it("passes the parsed input and MCP audit context to the service", async () => {
    updateSettings.mockResolvedValueOnce(updateResult);
    const { updateMcpSettings } =
      await import("@/lib/Modules/Mcp/Tools/Settings");

    const result = await updateMcpSettings(adminContext, validInput);

    expect(updateSettings).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ siteTitle: "My Site" }),
      expect.objectContaining({
        source: "MCP",
        tool: "kastir_settings_update",
        requestId: "request-1",
      }),
    );
    // Proves the Zod .omit() actually drops the keys rather than merely
    // leaving them undefined — a typo re-including one of these in the
    // schema would silently reopen the Cloudflare write path.
    const [, parsedInput] = updateSettings.mock.calls[0];
    expect(parsedInput).not.toHaveProperty("cloudflareApiToken");
    expect(parsedInput).not.toHaveProperty("cloudflareZoneId");
    expect(result).toMatchObject({
      ok: true,
      summary: expect.stringContaining("updated"),
      data: {
        scope: "GLOBAL",
        operationId: "op-1",
        siteTitle: "My Site",
        timezone: "UTC",
      },
    });
    expect(JSON.stringify(result)).not.toContain("cloudflare");
  });

  it("rejects cloudflareApiToken and cloudflareZoneId as unknown keys", async () => {
    const { updateMcpSettings } =
      await import("@/lib/Modules/Mcp/Tools/Settings");

    await expect(
      updateMcpSettings(adminContext, {
        ...validInput,
        cloudflareApiToken: "secret",
      }),
    ).rejects.toThrow();
    await expect(
      updateMcpSettings(adminContext, {
        ...validInput,
        cloudflareZoneId: "abcd1234abcd1234abcd1234abcd1234",
      }),
    ).rejects.toThrow();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("rejects a new siteUrl without confirmSiteUrl", async () => {
    const { SettingsDomainError } =
      await import("@/lib/Modules/Settings/Types");
    updateSettings.mockRejectedValueOnce(
      new SettingsDomainError(
        "CONFIRMATION_REQUIRED",
        "Confirm the public URL before saving it",
      ),
    );
    const { updateMcpSettings } =
      await import("@/lib/Modules/Mcp/Tools/Settings");

    await expect(
      updateMcpSettings(adminContext, {
        ...validInput,
        siteUrl: "https://other.example.com",
      }),
    ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    expect(updateSettings).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        siteUrl: "https://other.example.com",
        confirmSiteUrl: false,
      }),
      expect.anything(),
    );
  });

  it("updates siteUrl when confirmSiteUrl is true", async () => {
    updateSettings.mockResolvedValueOnce({
      ...updateResult,
      settings: {
        ...updateResult.settings,
        siteUrl: "https://other.example.com",
      },
    });
    const { updateMcpSettings } =
      await import("@/lib/Modules/Mcp/Tools/Settings");

    const result = await updateMcpSettings(adminContext, {
      ...validInput,
      siteUrl: "https://other.example.com",
      confirmSiteUrl: true,
    });

    expect(updateSettings).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        siteUrl: "https://other.example.com",
        confirmSiteUrl: true,
      }),
      expect.anything(),
    );
    expect(result).toMatchObject({ ok: true });
  });

  it("blocks EDITOR even if the token somehow carries the scope", async () => {
    const editorWithScope = { ...adminContext, role: "EDITOR" as const };
    const { updateMcpSettings } =
      await import("@/lib/Modules/Mcp/Tools/Settings");

    await expect(
      updateMcpSettings(editorWithScope, validInput),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("blocks ADMIN when the scope itself is missing", async () => {
    const adminNoScope = { ...adminContext, scopes: ["cms:read"] as const };
    const { updateMcpSettings } =
      await import("@/lib/Modules/Mcp/Tools/Settings");

    await expect(
      updateMcpSettings(adminNoScope, validInput),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("keeps the current revisionRetentionLimit when the field is omitted", async () => {
    updateSettings.mockResolvedValueOnce({
      ...updateResult,
      settings: {
        ...updateResult.settings,
        revisionRetentionLimit: 30,
      },
    });
    const { updateMcpSettings } =
      await import("@/lib/Modules/Mcp/Tools/Settings");
    const { revisionRetentionLimit: _omitted, ...withoutRetention } =
      validInput;

    const result = await updateMcpSettings(adminContext, withoutRetention);

    expect(getSettings).toHaveBeenCalled();
    expect(updateSettings).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ revisionRetentionLimit: 30 }),
      expect.anything(),
    );
    expect(result).toMatchObject({ ok: true });
  });

  it("does not register the tool under any name other than kastir_settings_update", async () => {
    const server = { registerTool: vi.fn() };
    const { registerSettingsTools } =
      await import("@/lib/Modules/Mcp/Tools/Settings");

    registerSettingsTools(server as never, adminContext);

    const registeredNames = server.registerTool.mock.calls.map(
      ([name]) => name,
    );
    expect(registeredNames).toEqual(["kastir_settings_update"]);
  });
});
