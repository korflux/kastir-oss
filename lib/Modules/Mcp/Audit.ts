import type { LogEventContext } from "@/lib/Logging/logEvent";
import type { McpToolContext } from "@/lib/Modules/Mcp/Types";

export function mcpAuditContext(
  context: McpToolContext,
  tool: string,
  objectId?: string,
): LogEventContext {
  return {
    source: "MCP",
    tool,
    resource: context.resource,
    requestId: context.requestId,
    ...(objectId ? { objectId } : {}),
  };
}
