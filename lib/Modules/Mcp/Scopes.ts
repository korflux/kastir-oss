export const MCP_SCOPES = [
  "cms:read",
  "cms:pages:write",
  "cms:pages:publish",
  "cms:pages:unpublish",
  "cms:media:write",
  "cms:scripts:write",
  "cms:scripts:publish",
  "cms:scripts:unpublish",
  "cms:split-tests:write",
  "cms:settings:write",
  "cms:logs:read",
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

export const MCP_RESOURCE_PATH = "/api/mcp";
export const MCP_ISSUER_PATH = "/api/auth";

/**
 * Domain → action → scope map used by site_get_context capabilities and
 * tools/list filtering in register*Tools. Single source of truth for "what
 * can this caller do" derived from granted scopes.
 */
export const MCP_DOMAIN_CAPABILITY_SCOPES = {
  pages: {
    read: "cms:read",
    write: "cms:pages:write",
    publish: "cms:pages:publish",
    unpublish: "cms:pages:unpublish",
  },
  media: {
    read: "cms:read",
    write: "cms:media:write",
  },
  scripts: {
    read: "cms:read",
    write: "cms:scripts:write",
    publish: "cms:scripts:publish",
    unpublish: "cms:scripts:unpublish",
  },
  splitTests: {
    read: "cms:read",
    write: "cms:split-tests:write",
  },
  settings: {
    read: "cms:read",
    write: "cms:settings:write",
  },
  logs: {
    read: "cms:logs:read",
  },
} as const satisfies Record<string, Record<string, McpScope>>;

export type McpDomainCapabilities = {
  [Domain in keyof typeof MCP_DOMAIN_CAPABILITY_SCOPES]: {
    [Action in keyof (typeof MCP_DOMAIN_CAPABILITY_SCOPES)[Domain]]: boolean;
  };
};

/**
 * Project granted scopes onto domain capability flags. Generic walk over the
 * map above so a new domain/action needs no second edit here; the cast is the
 * price of Object.fromEntries losing the literal keys.
 */
export function deriveMcpCapabilities(
  scopes: readonly string[],
): McpDomainCapabilities {
  const granted = new Set(scopes);

  return Object.fromEntries(
    Object.entries(MCP_DOMAIN_CAPABILITY_SCOPES).map(([domain, actions]) => [
      domain,
      Object.fromEntries(
        Object.entries(actions).map(([action, scope]) => [
          action,
          granted.has(scope),
        ]),
      ),
    ]),
  ) as McpDomainCapabilities;
}

export function getMcpResourceUrl(baseUrl: string): string {
  return new URL(MCP_RESOURCE_PATH, baseUrl).toString();
}

export function getMcpIssuerUrl(baseUrl: string): string {
  return new URL(MCP_ISSUER_PATH, baseUrl).toString();
}
