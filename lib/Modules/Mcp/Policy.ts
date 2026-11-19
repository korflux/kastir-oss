import { McpAuthorizationError } from "@/lib/Modules/Mcp/Errors";
import { MCP_SCOPES, type McpScope } from "@/lib/Modules/Mcp/Scopes";
import type { McpToolContext } from "@/lib/Modules/Mcp/Types";
import type { EffectiveRole } from "@/lib/Modules/Panel/Types";

/**
 * Scopes reserved for ADMIN/MASTER that mirror whole-screen panel blocks on
 * EDITOR (Panel/Permissions.ts). Kept out of the EDITOR scope set so a
 * client requesting them never gets them into `grantedScopes`, independent
 * of `requireMcpAdministrator` also gating the handler at call time.
 */
const ADMIN_ONLY_SCOPES: readonly McpScope[] = [
  "cms:settings:write",
  "cms:logs:read",
];

const EDITOR_SCOPES = MCP_SCOPES.filter(
  (scope) => !ADMIN_ONLY_SCOPES.includes(scope),
);

/**
 * The current panel policy grants the MCP-capable domains to every panel
 * role except EDITOR, which is missing the Settings write / Logs read
 * scopes above. Keeping this allowlist role-indexed makes a future role
 * downgrade effective on the next request without trusting consent-time
 * claims.
 */
export const MCP_ROLE_SCOPES: Record<EffectiveRole, readonly McpScope[]> = {
  MASTER: MCP_SCOPES,
  ADMIN: MCP_SCOPES,
  EDITOR: EDITOR_SCOPES,
};

/** EDITOR não recebe refresh persistente — só ADMIN/MASTER. */
export function roleAllowsOfflineAccess(role: EffectiveRole): boolean {
  return role !== "EDITOR";
}

/**
 * Scopes que o POST de consent realmente concede: allowlist do papel
 * mais `offline_access` só quando o papel pode ter refresh token.
 */
export function grantedOAuthConsentScopes(
  role: EffectiveRole,
  grantedScopes: readonly McpScope[],
  requestedScopes: readonly string[],
): string[] {
  return [
    ...grantedScopes,
    ...(requestedScopes.includes("offline_access") &&
    roleAllowsOfflineAccess(role)
      ? (["offline_access"] as const)
      : []),
  ];
}

export function allowedMcpScopes(
  role: EffectiveRole,
  requestedScopes: readonly string[],
): McpScope[] {
  const allowed = new Set(MCP_ROLE_SCOPES[role]);
  const seen = new Set<McpScope>();

  return requestedScopes.filter((scope): scope is McpScope => {
    if (!allowed.has(scope as McpScope) || seen.has(scope as McpScope)) {
      return false;
    }

    seen.add(scope as McpScope);
    return true;
  });
}

/**
 * Política central de papel: impede que scopes forjados no contexto ampliem
 * descoberta ou execução além da allowlist efetiva do usuário.
 */
export function roleAllowsMcpScope(
  role: EffectiveRole,
  scope: McpScope,
): boolean {
  return MCP_ROLE_SCOPES[role].includes(scope);
}

export function requireMcpScope(
  context: McpToolContext,
  scope: McpScope,
): void {
  if (
    !context.scopes.includes(scope) ||
    !roleAllowsMcpScope(context.role, scope)
  ) {
    throw new McpAuthorizationError();
  }
}

export function requireMcpAdministrator(context: McpToolContext): void {
  if (context.role === "EDITOR") {
    throw new McpAuthorizationError();
  }
}
