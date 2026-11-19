import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { env } from "@/lib/env";
import {
  authenticateMcpRequest,
  getMcpBearerToken,
} from "@/lib/Modules/Mcp/TokenVerification";
import {
  assertMcpBatchSize,
  assertMcpRateLimit,
  getMcpRateLimitKind,
} from "@/lib/Modules/Mcp/RateLimit";
import { normalizeMcpToolResponse } from "@/lib/Modules/Mcp/ResponseNormalization";
import { createMcpServer } from "@/lib/Modules/Mcp/ToolRegistry";

export const runtime = "nodejs";

// 20 MiB binários viram ~26,7 MiB em base64; o restante cobre o envelope JSON.
const MCP_MAX_REQUEST_BODY_BYTES = 28 * 1024 * 1024;

type McpHttpError = {
  status: number;
  code: string;
  message: string;
};

function isMcpHttpError(error: unknown): error is McpHttpError {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    "code" in error &&
    "message" in error &&
    typeof error.status === "number" &&
    typeof error.code === "string" &&
    typeof error.message === "string"
  );
}

function getResourceMetadataUrl(): string {
  return new URL(
    "/.well-known/oauth-protected-resource",
    env.BETTER_AUTH_URL,
  ).toString();
}

function getErrorResponse(error: unknown): Response {
  const knownError = isMcpHttpError(error) ? error : null;
  const status = knownError?.status ?? 500;
  const code = knownError?.code ?? "INTERNAL_ERROR";
  const message = knownError?.message ?? "MCP request failed";
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json",
  });

  if (status === 401) {
    headers.set(
      "www-authenticate",
      "Bearer resource_metadata=" +
        String.fromCharCode(34) +
        getResourceMetadataUrl() +
        String.fromCharCode(34),
    );
  }

  return new Response(
    JSON.stringify({
      error: {
        code,
        message,
      },
    }),
    { status, headers },
  );
}

/** Cria o erro público estável usado quando o transporte excede seu teto. */
function requestBodyTooLargeError(): McpHttpError {
  return {
    status: 413,
    code: "PAYLOAD_TOO_LARGE",
    message: "MCP request body too large",
  };
}

/** Junta somente os chunks já limitados para decodificação UTF-8/JSON. */
function concatenateBodyChunks(
  chunks: Uint8Array[],
  totalBytes: number,
): Uint8Array {
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** Lê JSON não confiável com teto real, inclusive sem Content-Length confiável. */
async function parseRequestBody(request: Request): Promise<unknown> {
  if (request.method !== "POST") {
    return undefined;
  }

  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) ||
      Number(declaredLength) > MCP_MAX_REQUEST_BODY_BYTES)
  ) {
    throw requestBodyTooLargeError();
  }

  const reader = request.body?.getReader();
  if (!reader) return undefined;

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MCP_MAX_REQUEST_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw requestBodyTooLargeError();
      }
      chunks.push(value);
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      concatenateBodyChunks(chunks, totalBytes),
    );
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (isMcpHttpError(error)) throw error;
    return undefined;
  }
}

async function handleMcpRequest(request: Request): Promise<Response> {
  let token: string;
  try {
    token = getMcpBearerToken(request.headers.get("authorization"));
  } catch (error) {
    return getErrorResponse(error);
  }

  try {
    const body = await parseRequestBody(request);
    assertMcpBatchSize(body);
    await assertMcpRateLimit(request, token, getMcpRateLimitKind(body));
    const context = await authenticateMcpRequest(request);
    const server = await createMcpServer(context);
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
    });

    await server.connect(transport);
    const response = await transport.handleRequest(request, {
      parsedBody: body,
    });
    return normalizeMcpToolResponse(response, body);
  } catch (error) {
    return getErrorResponse(error);
  }
}

export const GET = handleMcpRequest;
export const POST = handleMcpRequest;
export const DELETE = handleMcpRequest;
