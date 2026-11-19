import { env } from "@/lib/env";
import { getMcpResourceUrl } from "@/lib/Modules/Mcp/Scopes";

const OAUTH_RESOURCE_ERROR =
  "resource must be provided and must match the MCP resource server";

function expectedResource(): string {
  return getMcpResourceUrl(env.BETTER_AUTH_URL);
}

function isMcpOAuthEndpoint(request: Request): "authorize" | "token" | null {
  const pathname = new URL(request.url).pathname.replace(/\/+$/, "");

  if (pathname === "/api/auth/oauth2/authorize") return "authorize";
  if (pathname === "/api/auth/oauth2/token") return "token";
  return null;
}

/** Strip trailing slashes so clients that send `/api/mcp/` still match. */
function normalizeResourceUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function hasExpectedResource(values: string[]): boolean {
  if (values.length !== 1) return false;
  return (
    normalizeResourceUrl(values[0]) === normalizeResourceUrl(expectedResource())
  );
}

function invalidResourceResponse(): Response {
  return Response.json(
    {
      error: "invalid_request",
      error_description: OAUTH_RESOURCE_ERROR,
    },
    {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

type TokenRequestFields = { grantType: string | null; resources: string[] };

const TOKEN_MAX_BODY_BYTES = 8 * 1024;

function payloadTooLargeResponse(): Response {
  return Response.json(
    {
      error: "invalid_request",
      error_description: "token request body too large",
    },
    {
      status: 413,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

/** Lê o corpo do /token com teto local — nginx 210m não serve pra exchange. */
async function readTokenRequestText(request: Request): Promise<string | null> {
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) ||
      Number(declaredLength) > TOKEN_MAX_BODY_BYTES)
  ) {
    return null;
  }

  const reader = request.clone().body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > TOKEN_MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(body);
}

async function getTokenRequestFields(
  request: Request,
): Promise<TokenRequestFields | "too-large"> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  const text = await readTokenRequestText(request);
  if (text === null) return "too-large";

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const body = new URLSearchParams(text);
    return {
      grantType: body.get("grant_type"),
      resources: body.getAll("resource"),
    };
  }

  if (contentType.includes("application/json")) {
    try {
      const body = JSON.parse(text) as {
        grant_type?: unknown;
        resource?: unknown;
      };
      return {
        grantType: typeof body.grant_type === "string" ? body.grant_type : null,
        resources: typeof body.resource === "string" ? [body.resource] : [],
      };
    } catch {
      // Corpo externo inválido não pode virar 500 nem alcançar o provider.
      return { grantType: null, resources: [] };
    }
  }

  return { grantType: null, resources: [] };
}

/**
 * Better Auth treats OAuth's resource parameter as optional. MCP requires it
 * on authorization-code exchanges; refresh exchanges may inherit the resource
 * pinned at authorization, but an explicit value must still match this server.
 */
export async function validateMcpOAuthResourceRequest(
  request: Request,
): Promise<Response | null> {
  const endpoint = isMcpOAuthEndpoint(request);
  if (!endpoint) return null;

  if (endpoint === "authorize") {
    const resources = new URL(request.url).searchParams.getAll("resource");
    return hasExpectedResource(resources) ? null : invalidResourceResponse();
  }

  const fields = await getTokenRequestFields(request);
  if (fields === "too-large") return payloadTooLargeResponse();
  const { grantType, resources } = fields;

  // RFC 8707 §2.2: on refresh the resource is optional and inherits the original
  // grant, which /authorize already pinned to this server. Requiring it here only
  // breaks clients that omit it on renewal — the audience stays enforced by the
  // provider's persisted grant either way. A resource sent anyway must still match.
  if (grantType === "refresh_token" && resources.length === 0) return null;

  return hasExpectedResource(resources) ? null : invalidResourceResponse();
}
