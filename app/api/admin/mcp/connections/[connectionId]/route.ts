import {
  mcpConnectionsError,
  mcpConnectionsResponse,
} from "@/lib/Modules/Mcp/ConnectionsApi";
import { requireTrustedPanelMutation } from "@/lib/Modules/Panel/MutationSecurity";
import { revokeMcpConnection } from "@/lib/Modules/Mcp/Connections";

type RouteContext = { params: Promise<{ connectionId: string }> };

export async function DELETE(request: Request, { params }: RouteContext) {
  const gate = await requireTrustedPanelMutation(request);
  if (!gate.ok) return gate.response;

  try {
    const { connectionId } = await params;
    await revokeMcpConnection(connectionId, gate.userId, gate.role);
    return mcpConnectionsResponse({ ok: true });
  } catch (error) {
    return mcpConnectionsError(error);
  }
}
