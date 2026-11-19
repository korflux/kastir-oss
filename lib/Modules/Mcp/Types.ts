import type { McpScope } from "@/lib/Modules/Mcp/Scopes";
import type { EffectiveRole } from "@/lib/Modules/Panel/Types";
import type { LogEventContext } from "@/lib/Logging/logEvent";

export type McpActor = {
  id: string;
  name: string;
  email: string;
};

export type McpToolContext = {
  actor: McpActor;
  userId: string;
  role: EffectiveRole;
  scopes: readonly McpScope[];
  clientId: string;
  resource: string;
  requestId: string;
};

export type McpMutationAuditContext = Required<
  Pick<LogEventContext, "source" | "tool" | "resource" | "requestId">
>;
