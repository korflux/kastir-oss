import {
  getMcpConnectionsApiContext,
  mcpConnectionsResponse,
} from "@/lib/Modules/Mcp/ConnectionsApi";
import { listMcpConnections } from "@/lib/Modules/Mcp/Connections";

export async function GET(request: Request) {
  const context = await getMcpConnectionsApiContext(request);
  if (!context) {
    return mcpConnectionsResponse(
      { error: "Unauthorized", code: "UNAUTHORIZED" },
      401,
    );
  }

  try {
    return mcpConnectionsResponse(
      await listMcpConnections(context.userId, context.role),
    );
  } catch {
    return mcpConnectionsResponse(
      {
        error: "Unable to list MCP connections",
        code: "INTERNAL_ERROR",
      },
      500,
    );
  }
}
