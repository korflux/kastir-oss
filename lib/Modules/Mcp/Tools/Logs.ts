import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { logsService } from "@/lib/Modules/Logs/Service";
import { LOG_OBJECT_TYPES } from "@/lib/Modules/Logs/Types";
import type { LogListItem } from "@/lib/Modules/Logs/Types";
import {
  normalizeMcpPagination,
  paginationInputSchema,
  toMcpPageResult,
  type McpPageResult,
} from "@/lib/Modules/Mcp/Schema";
import {
  requireMcpAdministrator,
  requireMcpScope,
} from "@/lib/Modules/Mcp/Policy";
import type { McpToolContext } from "@/lib/Modules/Mcp/Types";
import { canMcp, runMcpTool } from "@/lib/Modules/Mcp/Tools/Shared";

const auditLogsListInputSchema = z
  .object({
    ...paginationInputSchema,
    userId: z.string().trim().min(1).max(191).optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
    objectType: z.enum(LOG_OBJECT_TYPES).optional(),
  })
  .strict();

type AuditLogsListInput = z.infer<typeof auditLogsListInputSchema>;

function auditLogListItem(entry: LogListItem): Record<string, unknown> {
  return {
    id: entry.id,
    userId: entry.userId,
    actor: entry.actor,
    action: entry.action,
    objectType: entry.objectType,
    objectLabel: entry.objectLabel,
    objectId: entry.objectId,
    source: entry.source,
    tool: entry.tool,
    resource: entry.resource,
    requestId: entry.requestId,
    createdAt: entry.createdAt,
  };
}

export async function listMcpAuditLogs(
  context: McpToolContext,
  input: AuditLogsListInput,
): Promise<McpPageResult<Record<string, unknown>>> {
  // Fixed order: administrator gate before scope check, so an EDITOR whose
  // token was somehow granted the scope still never gets past the role gate.
  requireMcpAdministrator(context);
  requireMcpScope(context, "cms:logs:read");
  const { page, pageSize } = normalizeMcpPagination(input);
  const result = await logsService.listLogs(context.userId, {
    page,
    pageSize,
    userId: input.userId,
    from: input.from ? new Date(input.from) : undefined,
    to: input.to ? new Date(input.to) : undefined,
    objectType: input.objectType,
  });
  return toMcpPageResult(result.items.map(auditLogListItem), result.total, {
    page: result.page,
    pageSize: result.pageSize,
  });
}

export function registerLogsTools(
  server: McpServer,
  context: McpToolContext,
): void {
  if (!canMcp(context, "logs", "read")) return;

  server.registerTool(
    "kastir_audit_logs_list",
    {
      title: "List Audit Logs",
      description:
        "List audit log (who/what/when). Admin role. Read-only; no purge/export via MCP.",
      inputSchema: auditLogsListInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) => runMcpTool(() => listMcpAuditLogs(context, input)),
  );
}
