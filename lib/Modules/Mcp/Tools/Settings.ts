import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { settingsInputSchema } from "@/lib/Modules/Settings/Schema";
import { settingsService } from "@/lib/Modules/Settings/Service";
import { mcpAuditContext } from "@/lib/Modules/Mcp/Audit";
import {
  requireMcpAdministrator,
  requireMcpScope,
} from "@/lib/Modules/Mcp/Policy";
import type { McpToolContext } from "@/lib/Modules/Mcp/Types";
import { toMcpPublicSettings } from "@/lib/Modules/Mcp/Tools/publicSiteSettings";
import {
  canMcp,
  runMcpTool,
  toMcpSuccess,
} from "@/lib/Modules/Mcp/Tools/Shared";

// Cloudflare credentials are deliberately omitted from the schema itself
// (not just dropped from the response) — a client can never even attempt
// to set them through this tool. The full SettingsInput type still allows
// them because the panel form uses the same schema; only the MCP-facing
// object below narrows it.
const settingsUpdateMcpInputSchema = settingsInputSchema
  .omit({ cloudflareApiToken: true, cloudflareZoneId: true })
  .extend({
    // Campo novo na fase 45: omitir preserva o valor vigente (não default 5).
    revisionRetentionLimit:
      settingsInputSchema.shape.revisionRetentionLimit.optional(),
    // Mesmo gate do painel: trocar siteUrl exige confirmação explícita.
    confirmSiteUrl: z.boolean().optional().default(false),
  })
  .strict();

export async function updateMcpSettings(
  context: McpToolContext,
  input: unknown,
) {
  // Fixed order: administrator gate before scope check, so an EDITOR whose
  // token was somehow granted the scope still never gets past the role gate.
  requireMcpAdministrator(context);
  requireMcpScope(context, "cms:settings:write");
  const parsed = settingsUpdateMcpInputSchema.parse(input);
  const revisionRetentionLimit =
    parsed.revisionRetentionLimit ??
    (await settingsService.getSettings()).revisionRetentionLimit;
  const result = await settingsService.updateSettings(
    context.userId,
    {
      ...parsed,
      revisionRetentionLimit,
    },
    mcpAuditContext(context, "kastir_settings_update"),
  );
  // Slim mutation payload — never return zone/token; full settings via get.
  const publicSettings = toMcpPublicSettings(result.settings);
  return toMcpSuccess("Site settings updated.", {
    scope: result.scope,
    operationId: result.operationId,
    queueStatus: result.queueStatus,
    siteTitle: publicSettings.siteTitle,
    siteLanguage: publicSettings.siteLanguage,
    timezone: publicSettings.timezone,
  });
}

export function registerSettingsTools(
  server: McpServer,
  context: McpToolContext,
): void {
  if (!canMcp(context, "settings", "write")) return;

  server.registerTool(
    "kastir_settings_update",
    {
      title: "Update Site Settings",
      description:
        "Admin only. Update non-sensitive settings; Cloudflare is panel-only. Changing siteUrl needs confirmSiteUrl=true. Omitted revisionRetentionLimit keeps its value.",
      inputSchema: settingsUpdateMcpInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) => runMcpTool(() => updateMcpSettings(context, input)),
  );
}
