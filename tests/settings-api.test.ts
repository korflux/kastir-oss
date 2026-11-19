import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, getSettings, listOptions, updateSettings } = vi.hoisted(
  () => ({
    getSession: vi.fn(),
    getSettings: vi.fn(),
    listOptions: vi.fn(),
    updateSettings: vi.fn(),
  }),
);

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));
vi.mock("@/lib/Modules/Settings/Service", () => ({
  settingsService: { getSettings, listOptions, updateSettings },
}));

import { GET, PUT } from "@/app/api/admin/settings/route";
import { SettingsDomainError } from "@/lib/Modules/Settings/Types";

const trustedOrigin = "https://panel.example.com";

const settings = {
  id: "singleton",
  siteTitle: "Kastir",
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
  cloudflareZoneId: null,
  webpConversionEnabled: true,
  revisionRetentionLimit: 5,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  cloudflareApiTokenConfigured: true,
};

function payload(overrides: Record<string, unknown> = {}) {
  return {
    siteTitle: "Kastir",
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
    cloudflareZoneId: null,
    webpConversionEnabled: true,
    revisionRetentionLimit: 5,
    ...overrides,
  };
}

describe("admin settings API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("BETTER_AUTH_URL", trustedOrigin);
    getSettings.mockResolvedValue(settings);
    listOptions.mockResolvedValue({ faviconMedia: [], homePages: [] });
    updateSettings.mockResolvedValue({
      settings,
      scope: "NONE",
      operationId: null,
      affectedPageIds: [],
      queueStatus: "NONE",
    });
  });

  it("returns 401 for an anonymous request and 403 for an Editor", async () => {
    getSession.mockResolvedValueOnce(null).mockResolvedValueOnce({
      user: { id: "editor", role: "EDITOR", isMaster: false },
    });
    await expect(
      (await GET(new Request("http://localhost/api/admin/settings"))).status,
    ).toBe(401);
    const response = await GET(
      new Request("http://localhost/api/admin/settings"),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(getSettings).not.toHaveBeenCalled();
  });

  it("requires confirmation before persisting a URL divergent from the request origin", async () => {
    getSession.mockResolvedValue({
      user: { id: "admin", role: "ADMIN", isMaster: false },
    });
    updateSettings.mockRejectedValueOnce(
      new SettingsDomainError(
        "CONFIRMATION_REQUIRED",
        "Confirm the public URL before saving it",
      ),
    );
    const response = await PUT(
      new Request("https://panel.example.com/api/admin/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          origin: trustedOrigin,
        },
        body: JSON.stringify(payload({ siteUrl: "https://other.example.com" })),
      }),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("CONFIRMATION_REQUIRED");
    expect(updateSettings).toHaveBeenCalledOnce();
  });

  it("does not require confirmation when the submitted URL matches the saved public URL", async () => {
    getSession.mockResolvedValue({
      user: { id: "admin", role: "ADMIN", isMaster: false },
    });
    getSettings.mockResolvedValueOnce({
      ...settings,
      siteUrl: "https://public.example.com",
    });

    const response = await PUT(
      new Request("https://panel.example.com/api/admin/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          origin: trustedOrigin,
        },
        body: JSON.stringify(
          payload({ siteUrl: "https://public.example.com" }),
        ),
      }),
    );

    expect(response.status).toBe(200);
    expect(updateSettings).toHaveBeenCalledOnce();
  });

  it("does not require confirmation when no public URL is saved or submitted", async () => {
    getSession.mockResolvedValue({
      user: { id: "admin", role: "ADMIN", isMaster: false },
    });

    const response = await PUT(
      new Request("https://panel.example.com/api/admin/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          origin: trustedOrigin,
        },
        body: JSON.stringify(payload({ siteUrl: null })),
      }),
    );

    expect(response.status).toBe(200);
    expect(updateSettings).toHaveBeenCalledOnce();
  });

  it("accepts explicit URL confirmation and strips client-controlled fields", async () => {
    getSession.mockResolvedValue({
      user: { id: "admin", role: "ADMIN", isMaster: false },
    });
    await PUT(
      new Request("https://panel.example.com/api/admin/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          origin: trustedOrigin,
        },
        body: JSON.stringify(
          payload({
            siteUrl: "https://other.example.com",
            confirmSiteUrl: true,
            role: "MASTER",
            userId: "attacker",
            cloudflareApiTokenEncrypted: "leak",
          }),
        ),
      }),
    );

    expect(updateSettings).toHaveBeenCalledWith(
      "admin",
      expect.not.objectContaining({
        role: "MASTER",
        userId: "attacker",
        cloudflareApiTokenEncrypted: "leak",
      }),
      expect.objectContaining({ requestOrigin: "https://panel.example.com" }),
    );
  });
});
