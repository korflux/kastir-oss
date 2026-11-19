import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { env } from "@/lib/env";
import { allowedMcpScopes } from "@/lib/Modules/Mcp/Policy";
import { GUIDE_TOPIC_NAMES, getGuide } from "@/lib/Modules/Mcp/Guide";
import { McpOperationNotFoundError } from "@/lib/Modules/Mcp/Errors";
import { MCP_SERVER_INFO } from "@/lib/Modules/Mcp/Constants";
import { deriveMcpCapabilities } from "@/lib/Modules/Mcp/Scopes";
import { getPublishingQueue } from "@/lib/Publishing/queue";
import {
  getNewPageTemplate,
  resolveNewPageTemplateLocale,
} from "@/lib/Modules/Pages/newPageTemplate";
import {
  getNewScriptTemplate,
  resolveNewScriptTemplateLocale,
} from "@/lib/Modules/CustomCode/newScriptTemplate";
import { settingsService } from "@/lib/Modules/Settings/Service";
import { getPublicOrigin } from "@/lib/Modules/Settings/publicOrigin";
import type { McpToolContext } from "@/lib/Modules/Mcp/Types";
import {
  canMcp,
  requireReadScope,
  runMcpReadTool,
} from "@/lib/Modules/Mcp/Tools/Shared";
import { toMcpPublicSettings } from "@/lib/Modules/Mcp/Tools/publicSiteSettings";

const operationInputSchema = z
  .object({
    operationId: z.string().trim().min(1).max(200),
  })
  .strict();

const siteContextInputSchema = z
  .object({
    // When true, include starters.pageTemplate.content (HTML seed for pages_create).
    includePageTemplate: z.boolean().optional(),
    // When true, include starters.scriptTemplate.content + popupContent.
    includeScriptTemplate: z.boolean().optional(),
  })
  .strict();

const guideInputSchema = z
  .object({
    topic: z.enum(GUIDE_TOPIC_NAMES).optional(),
  })
  .strict();

type OperationInput = z.infer<typeof operationInputSchema>;
type SiteContextInput = z.infer<typeof siteContextInputSchema>;
type GuideInput = z.infer<typeof guideInputSchema>;

export async function getMcpGuide(
  context: McpToolContext,
  input: GuideInput = {},
) {
  requireReadScope(context);
  return getGuide(input.topic);
}

export async function getMcpSiteContext(
  context: McpToolContext,
  input: SiteContextInput = {},
): Promise<{
  origin: string;
  title: string;
  version: string;
  timezone: string;
  capabilities: ReturnType<typeof deriveMcpCapabilities>;
  starters: {
    pageTemplate: {
      locale: string;
      description: string;
      content?: string;
    };
    scriptTemplate: {
      locale: string;
      description: string;
      /** Base snippet (no trigger). */
      content?: string;
      /** Accessible popup overlay — paste as content when scripts_create has trigger. */
      popupContent?: string;
    };
  };
}> {
  requireReadScope(context);
  const settings = await settingsService.getSettings();
  const pageTemplateLocale = resolveNewPageTemplateLocale(
    settings.siteLanguage,
  );
  const scriptTemplateLocale = resolveNewScriptTemplateLocale(
    settings.siteLanguage,
  );
  return {
    origin: getPublicOrigin({
      siteUrl: settings.siteUrl,
      fallbackOrigin: env.BETTER_AUTH_URL,
    }),
    title: settings.siteTitle,
    version: MCP_SERVER_INFO.version,
    timezone: settings.timezone,
    capabilities: deriveMcpCapabilities(
      allowedMcpScopes(context.role, context.scopes),
    ),
    starters: {
      pageTemplate: {
        locale: pageTemplateLocale,
        description:
          "Didactic HTML starter for new pages; used when kastir_pages_create omits content. Pass includePageTemplate=true to load content here.",
        ...(input.includePageTemplate
          ? { content: getNewPageTemplate(settings.siteLanguage) }
          : {}),
      },
      scriptTemplate: {
        locale: scriptTemplateLocale,
        description:
          "Script starters: content=base (no trigger); popupContent=accessible overlay (use as scripts_create content when setting trigger). scripts_create never auto-seeds — load with includeScriptTemplate=true.",
        ...(input.includeScriptTemplate
          ? {
              content: getNewScriptTemplate(settings.siteLanguage),
              popupContent: getNewScriptTemplate(settings.siteLanguage, {
                popup: true,
              }),
            }
          : {}),
      },
    },
  };
}

export async function getMcpPublicSettings(
  context: McpToolContext,
): Promise<Record<string, unknown>> {
  requireReadScope(context);
  return toMcpPublicSettings(await settingsService.getSettings());
}

function operationStatus(
  state: string,
): "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" {
  if (state === "active") return "RUNNING";
  if (state === "completed") return "SUCCEEDED";
  if (state === "failed") return "FAILED";
  return "PENDING";
}

export async function getMcpOperation(
  context: McpToolContext,
  input: OperationInput,
): Promise<{
  operationId: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  resourceId?: string;
}> {
  requireReadScope(context);
  const queue = getPublishingQueue();
  // media-webp jobs use the bare operationId as their BullMQ jobId; settings-rebuild
  // jobs prefix it (`settings-rebuild-<operationId>`, enforced by a jobId-format test)
  // to avoid colliding with the ":" convention BullMQ forbids. Try both.
  const job =
    (await queue.getJob(input.operationId)) ??
    (await queue.getJob(`settings-rebuild-${input.operationId}`));
  if (!job) throw new McpOperationNotFoundError();
  const data = job.data as {
    type?: string;
    userId?: string;
    audit?: { source?: string };
    mediaFileId?: string;
  };
  const isTrackedMcpOperation =
    data.userId === context.userId &&
    data.audit?.source === "MCP" &&
    (data.type === "media-webp" || data.type === "settings-rebuild");
  if (!isTrackedMcpOperation) {
    throw new McpOperationNotFoundError();
  }
  const state = await job.getState();
  const resourceId = data.type === "media-webp" ? data.mediaFileId : undefined;
  return {
    operationId: input.operationId,
    status: operationStatus(state),
    ...(resourceId ? { resourceId } : {}),
  };
}

export function registerSiteTools(
  server: McpServer,
  context: McpToolContext,
): void {
  // Site tools share cms:read with settings.read in the capability map.
  if (!canMcp(context, "settings", "read")) return;

  server.registerTool(
    "kastir_guide_get",
    {
      title: "Get Kastir Guide",
      description:
        "Get product guidance by topic; omit topic for the topic index.",
      inputSchema: guideInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) => runMcpReadTool(context, () => getMcpGuide(context, input)),
  );

  server.registerTool(
    "kastir_site_get_context",
    {
      title: "Get Site Context",
      description:
        "Site origin/title/version, caller capabilities, starters metadata. Optional includePageTemplate / includeScriptTemplate (base + popupContent).",
      inputSchema: siteContextInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) => runMcpReadTool(context, () => getMcpSiteContext(context, input)),
  );
  server.registerTool(
    "kastir_settings_get",
    {
      title: "Get Site Settings",
      description: "Public site settings projection (no credentials/tokens).",
      inputSchema: z.object({}).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    () => runMcpReadTool(context, () => getMcpPublicSettings(context)),
  );
  server.registerTool(
    "kastir_operation_get",
    {
      title: "Get Operation Status",
      description: "Safe status for a queued MCP operation (no job payload).",
      inputSchema: operationInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) => runMcpReadTool(context, () => getMcpOperation(context, input)),
  );
}
