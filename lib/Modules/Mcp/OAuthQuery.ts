export type OAuthSearchParams = Record<string, string | string[] | undefined>;

function toSearchParams(searchParams: OAuthSearchParams): URLSearchParams {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "next" || value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        query.append(key, item);
      }
    } else {
      query.set(key, value);
    }
  }

  return query;
}

export function getMcpOAuthQuery(
  searchParams: OAuthSearchParams,
): string | null {
  const query = toSearchParams(searchParams);

  if (
    !query.get("client_id") ||
    !query.get("redirect_uri") ||
    !query.get("exp") ||
    !query.get("sig")
  ) {
    return null;
  }

  return query.toString();
}

export function getMcpConsentPath(
  searchParams: OAuthSearchParams,
): string | null {
  const query = getMcpOAuthQuery(searchParams);
  return query ? "/admin/mcp/consent?" + query : null;
}

export function getMcpOAuthRequest(query: string): {
  clientId: string;
  redirectUri: string;
  resource: string | null;
  requestedScopes: string[];
} {
  const params = new URLSearchParams(query);

  return {
    clientId: params.get("client_id") ?? "",
    redirectUri: params.get("redirect_uri") ?? "",
    resource: params.get("resource"),
    requestedScopes: (params.get("scope") ?? "").split(" ").filter(Boolean),
  };
}
