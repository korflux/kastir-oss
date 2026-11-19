import { describe, expect, it, vi } from "vitest";

import { cloudflarePurge } from "@/lib/Cdn/cloudflarePurge";
import { LOG_EVENT_LIMITS, logEvent } from "@/lib/Logging/logEvent";

describe("pages audit adapters", () => {
  it("writes metadata without accepting page content", async () => {
    const create = vi.fn().mockResolvedValue({ id: "log-id" });

    await logEvent(
      { logEntry: { create } },
      {
        userId: "master-id",
        action: "PAGE_CREATED",
        objectType: "PAGE",
        objectLabel: "Landing page",
      },
    );

    expect(create).toHaveBeenCalledWith({
      data: {
        userId: "master-id",
        action: "PAGE_CREATED",
        objectType: "PAGE",
        objectLabel: "Landing page",
      },
    });
    expect(create.mock.calls[0]?.[0]?.data).not.toHaveProperty("content");
  });

  it("clips audit strings and strips CR/LF before write", async () => {
    const create = vi.fn().mockResolvedValue({ id: "log-id" });

    await logEvent(
      { logEntry: { create } },
      {
        userId: "master-id",
        action: `PAGE_CREATED${"A".repeat(200)}`,
        objectType: "PAGE",
        objectLabel: `Landing\r\npage${"x".repeat(600)}`,
        tool: `kastir_pages_update\n${"t".repeat(200)}`,
        resource: `https://example/${"r".repeat(3000)}`,
      },
    );

    const data = create.mock.calls[0]?.[0]?.data as {
      action: string;
      objectLabel: string;
      tool: string;
      resource: string;
    };
    expect(data.action.length).toBeLessThanOrEqual(LOG_EVENT_LIMITS.action);
    expect(data.objectLabel.length).toBeLessThanOrEqual(
      LOG_EVENT_LIMITS.objectLabel,
    );
    expect(data.objectLabel).not.toMatch(/[\r\n]/);
    expect(data.tool.length).toBeLessThanOrEqual(LOG_EVENT_LIMITS.tool);
    expect(data.tool).not.toMatch(/[\r\n]/);
    expect(data.resource.length).toBeLessThanOrEqual(LOG_EVENT_LIMITS.resource);
  });

  it("persists MCP audit context without accepting arbitrary payloads", async () => {
    const create = vi.fn().mockResolvedValue({ id: "log-id" });

    await logEvent(
      { logEntry: { create } },
      {
        userId: "user-1",
        action: "PAGE_UPDATED",
        objectType: "PAGE",
        objectLabel: "Landing page",
        source: "MCP",
        tool: "kastir_pages_update",
        resource: "https://public.example/api/mcp",
        requestId: "request-1",
        objectId: "page-1",
      },
    );

    expect(create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        action: "PAGE_UPDATED",
        objectType: "PAGE",
        objectLabel: "Landing page",
        source: "MCP",
        tool: "kastir_pages_update",
        resource: "https://public.example/api/mcp",
        requestId: "request-1",
        objectId: "page-1",
      },
    });
  });

  it("rejects relative purge targets without making a provider request", async () => {
    await expect(cloudflarePurge("landing-page")).resolves.toEqual({
      status: "FAILED",
      message: "Cloudflare purge requires an absolute HTTP(S) URL",
    });
  });
});
