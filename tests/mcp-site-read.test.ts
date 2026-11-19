import { describe, expect, it, vi } from "vitest";

import {
  NEW_POPUP_TEMPLATE_PT_BR,
  NEW_SCRIPT_TEMPLATE_PT_BR,
} from "@/lib/Modules/CustomCode/newScriptTemplate";
import { NEW_PAGE_TEMPLATE_PT_BR } from "@/lib/Modules/Pages/newPageTemplate";
import packageJson from "@/package.json";

const getSettings = vi.hoisted(() => vi.fn());
const getJob = vi.hoisted(() => vi.fn());

vi.mock("@/lib/Modules/Settings/Service", () => ({
  settingsService: { getSettings },
}));

vi.mock("@/lib/Publishing/queue", () => ({
  TRACKED_JOB_RETENTION: { age: 3600, count: 1000 },
  getPublishingQueue: () => ({ getJob }),
}));

vi.mock("@/lib/env", () => ({
  env: { BETTER_AUTH_URL: "https://configured.example" },
}));

const context = {
  actor: { id: "user-1", name: "Admin", email: "admin@example.test" },
  userId: "user-1",
  role: "ADMIN" as const,
  scopes: ["cms:read" as const],
  clientId: "client-1",
  resource: "https://configured.example/api/mcp",
  requestId: "request-1",
};

const settings = {
  id: "singleton",
  siteTitle: "Kastir",
  tagline: "CMS",
  seoDescription: "Public description",
  faviconMediaId: "media-1",
  siteUrl: "https://public.example",
  siteLanguage: "pt-BR",
  timezone: "America/Sao_Paulo",
  dateFormat: "DD/MM/YYYY",
  timeFormat: "24H",
  weekStartsOn: "MONDAY",
  homePageId: "page-1",
  indexable: true,
  allowAiCrawlers: true,
  sitemapEnabled: true,
  notFoundPageId: null,
  notFoundRedirectToHome: false,
  cloudflareApiTokenEncrypted: "encrypted-secret",
  cloudflareZoneId: "zone-secret",
  webpConversionEnabled: true,
  revisionRetentionLimit: 5,
  cloudflareApiTokenConfigured: true,
  createdAt: new Date("2026-07-20T10:00:00.000Z"),
  updatedAt: new Date("2026-07-22T10:00:00.000Z"),
};

describe("MCP site read tools", () => {
  it("derives capabilities from the caller's scopes", async () => {
    getSettings.mockResolvedValue(settings);
    const { getMcpSiteContext } = await import("@/lib/Modules/Mcp/Tools/Site");

    const editor = await getMcpSiteContext({
      ...context,
      role: "EDITOR",
      scopes: [
        "cms:read",
        "cms:pages:write",
        "cms:pages:publish",
        "cms:pages:unpublish",
        "cms:media:write",
        "cms:scripts:write",
        "cms:scripts:publish",
        "cms:scripts:unpublish",
        "cms:split-tests:write",
      ],
    });
    expect(editor.capabilities.pages.publish).toBe(true);
    expect(editor.capabilities.settings.write).toBe(false);
    expect(editor.capabilities.logs.read).toBe(false);

    const forgedEditor = await getMcpSiteContext({
      ...context,
      role: "EDITOR",
      scopes: ["cms:read", "cms:settings:write", "cms:logs:read"],
    });
    expect(forgedEditor.capabilities.settings.write).toBe(false);
    expect(forgedEditor.capabilities.logs.read).toBe(false);

    const master = await getMcpSiteContext({
      ...context,
      role: "MASTER",
      scopes: [
        "cms:read",
        "cms:pages:write",
        "cms:pages:publish",
        "cms:pages:unpublish",
        "cms:media:write",
        "cms:scripts:write",
        "cms:scripts:publish",
        "cms:scripts:unpublish",
        "cms:split-tests:write",
        "cms:settings:write",
        "cms:logs:read",
      ],
    });
    expect(master.capabilities.settings.write).toBe(true);
    expect(master.capabilities.logs.read).toBe(true);
    expect(master.capabilities.pages.publish).toBe(true);
  });

  it("returns public context and settings without Cloudflare material", async () => {
    getSettings.mockResolvedValue(settings);
    const { getMcpSiteContext, getMcpPublicSettings } =
      await import("@/lib/Modules/Mcp/Tools/Site");

    const siteContext = await getMcpSiteContext(context);
    expect(siteContext).toMatchObject({
      origin: "https://public.example",
      title: "Kastir",
      version: packageJson.version,
      timezone: "America/Sao_Paulo",
      capabilities: {
        pages: { read: true, write: false, publish: false, unpublish: false },
        media: { read: true, write: false },
        scripts: { read: true, write: false, publish: false, unpublish: false },
        splitTests: { read: true, write: false },
        settings: { read: true, write: false },
        logs: { read: false },
      },
      starters: {
        pageTemplate: {
          locale: "pt-BR",
        },
        scriptTemplate: {
          locale: "pt-BR",
        },
      },
    });
    expect(siteContext).not.toHaveProperty("concepts");
    expect(siteContext.starters.pageTemplate).not.toHaveProperty("content");
    expect(siteContext.starters.scriptTemplate).not.toHaveProperty("content");

    const withTemplate = await getMcpSiteContext(context, {
      includePageTemplate: true,
      includeScriptTemplate: true,
    });
    expect(withTemplate.starters.pageTemplate.content).toBe(
      NEW_PAGE_TEMPLATE_PT_BR,
    );
    expect(withTemplate.starters.scriptTemplate.content).toBe(
      NEW_SCRIPT_TEMPLATE_PT_BR,
    );
    expect(withTemplate.starters.scriptTemplate.popupContent).toBe(
      NEW_POPUP_TEMPLATE_PT_BR,
    );
    expect(withTemplate.starters.scriptTemplate.description).toMatch(
      /popupContent/i,
    );
    expect(withTemplate.starters.scriptTemplate.description).toMatch(
      /never auto-seeds/i,
    );

    const result = await getMcpPublicSettings(context);
    expect(result).toMatchObject({
      siteTitle: "Kastir",
      siteUrl: "https://public.example",
    });
    expect(result).not.toHaveProperty("cloudflareApiTokenEncrypted");
    expect(result).not.toHaveProperty("cloudflareZoneId");
    expect(result).not.toHaveProperty("cloudflareApiTokenConfigured");
  });

  it("returns only safe operation state and not the BullMQ payload", async () => {
    getJob.mockResolvedValueOnce({
      data: {
        type: "media-webp",
        mediaFileId: "media-1",
        userId: "user-1",
        audit: { source: "MCP" },
        secret: "must-not-leak",
      },
      getState: vi.fn().mockResolvedValue("active"),
    });
    const { getMcpOperation } = await import("@/lib/Modules/Mcp/Tools/Site");
    await expect(
      getMcpOperation(context, { operationId: "job-1" }),
    ).resolves.toEqual({
      operationId: "job-1",
      status: "RUNNING",
      resourceId: "media-1",
    });
  });

  it("does not reveal another user's or a non-MCP operation", async () => {
    getJob.mockResolvedValue({
      data: {
        type: "media-webp",
        mediaFileId: "media-1",
        userId: "other-user",
        audit: { source: "MCP" },
      },
      getState: vi.fn(),
    });
    const { getMcpOperation } = await import("@/lib/Modules/Mcp/Tools/Site");
    await expect(
      getMcpOperation(context, { operationId: "job-2" }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });

  it("tracks a settings-rebuild operation via the prefixed BullMQ jobId", async () => {
    getJob.mockReset();
    getJob.mockResolvedValueOnce(null); // bare operationId lookup misses...
    getJob.mockResolvedValueOnce({
      // ...the settings-rebuild-<operationId> lookup hits.
      data: {
        type: "settings-rebuild",
        operationId: "op-1",
        userId: "user-1",
        audit: { source: "MCP" },
      },
      getState: vi.fn().mockResolvedValue("completed"),
    });
    const { getMcpOperation } = await import("@/lib/Modules/Mcp/Tools/Site");

    await expect(
      getMcpOperation(context, { operationId: "op-1" }),
    ).resolves.toEqual({
      operationId: "op-1",
      status: "SUCCEEDED",
    });
    expect(getJob).toHaveBeenNthCalledWith(1, "op-1");
    expect(getJob).toHaveBeenNthCalledWith(2, "settings-rebuild-op-1");
  });

  it("does not reveal another user's settings-rebuild operation", async () => {
    getJob.mockReset();
    getJob.mockResolvedValueOnce(null);
    getJob.mockResolvedValueOnce({
      data: {
        type: "settings-rebuild",
        operationId: "op-2",
        userId: "other-user",
        audit: { source: "MCP" },
      },
      getState: vi.fn(),
    });
    const { getMcpOperation } = await import("@/lib/Modules/Mcp/Tools/Site");

    await expect(
      getMcpOperation(context, { operationId: "op-2" }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });

  it("does not track a panel-originated settings-rebuild job (no MCP audit)", async () => {
    getJob.mockReset();
    getJob.mockResolvedValueOnce(null);
    getJob.mockResolvedValueOnce({
      data: {
        type: "settings-rebuild",
        operationId: "op-3",
        scope: "GLOBAL",
        pageIds: [],
      },
      getState: vi.fn(),
    });
    const { getMcpOperation } = await import("@/lib/Modules/Mcp/Tools/Site");

    await expect(
      getMcpOperation(context, { operationId: "op-3" }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });
});
