import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { env } from "@/lib/env";
import { MCP_SERVER_INFO } from "@/lib/Modules/Mcp/Constants";
import {
  buildMcpInstructionsFallback,
  buildMcpInstructionsFromSettings,
} from "@/lib/Modules/Mcp/Instructions";
import { registerLogsTools } from "@/lib/Modules/Mcp/Tools/Logs";
import { registerMediaTools } from "@/lib/Modules/Mcp/Tools/Media";
import { registerPageTools } from "@/lib/Modules/Mcp/Tools/Pages";
import { registerSettingsTools } from "@/lib/Modules/Mcp/Tools/Settings";
import { registerSiteTools } from "@/lib/Modules/Mcp/Tools/Site";
import { registerScriptTools } from "@/lib/Modules/Mcp/Tools/Scripts";
import { registerSplitTestTools } from "@/lib/Modules/Mcp/Tools/SplitTests";
import { settingsService } from "@/lib/Modules/Settings/Service";
import { getPublicOrigin } from "@/lib/Modules/Settings/publicOrigin";
import type { McpToolContext } from "@/lib/Modules/Mcp/Types";

export { MCP_SERVER_INFO } from "@/lib/Modules/Mcp/Constants";

/**
 * Snapshot of settings for handshake instructions. Failure degrades the text
 * — never aborts the MCP connection (agents still get concepts/playbook).
 */
async function resolveMcpInstructions(): Promise<string> {
  try {
    const settings = await settingsService.getSettings();
    const origin = getPublicOrigin({
      siteUrl: settings.siteUrl,
      fallbackOrigin: env.BETTER_AUTH_URL,
    });
    return buildMcpInstructionsFromSettings(settings, origin);
  } catch (error) {
    // Degrade text only — connection must still open (concepts + playbook).
    console.warn(
      "[mcp] instructions snapshot unavailable; using fallback",
      error,
    );
    return buildMcpInstructionsFallback();
  }
}

export async function createMcpServer(
  context: McpToolContext,
): Promise<McpServer> {
  const instructions = await resolveMcpInstructions();
  const server = new McpServer(MCP_SERVER_INFO, { instructions });
  // tools/list surface follows granted scopes; runtime guards stay in handlers.
  registerSiteTools(server, context);
  registerPageTools(server, context);
  registerMediaTools(server, context);
  registerScriptTools(server, context);
  registerSplitTestTools(server, context);
  registerSettingsTools(server, context);
  registerLogsTools(server, context);
  return server;
}
