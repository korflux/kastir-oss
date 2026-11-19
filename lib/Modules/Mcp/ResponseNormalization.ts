type JsonObject = Record<string, unknown>;

/** Restringe leituras do envelope MCP a objetos JSON não nulos. */
function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null;
}

/** Relaciona o id da resposta ao nome da ferramenta chamada no request. */
function toolNameForResponse(body: unknown, id: unknown): string | null {
  const requests = Array.isArray(body) ? body : [body];
  for (const request of requests) {
    if (!isJsonObject(request) || request.method !== "tools/call") continue;
    if (!Object.is(request.id, id)) continue;
    const params = request.params;
    if (!isJsonObject(params) || typeof params.name !== "string") return null;
    return params.name;
  }
  return null;
}

/**
 * Prefixo que o `McpError` do SDK acrescenta a toda mensagem (`MCP error <código>: `).
 * O SDK captura a recusa de validação dentro do handler de `tools/call` e a devolve como
 * resultado `isError` com `error.message` em texto puro, sem o código estruturado; por isso
 * o reconhecimento é pelo texto, ancorado no início e restrito ao código -32602.
 */
const SDK_INVALID_PARAMS_PREFIX = "MCP error -32602: ";

/** Início da mensagem de validação de entrada emitida pelo SDK (`validateToolInput`). */
const SDK_INPUT_VALIDATION_PREFIX =
  "Input validation error: Invalid arguments for tool";

/**
 * Reconhece somente a mensagem de validação emitida pelo SDK MCP, com ou sem o prefixo do
 * `McpError`. Não usa `includes`: texto de ferramenta que apenas cite a frase não casa.
 * ponytail: depende do texto do SDK (fixado por teste com o SDK instalado), trocar por
 * checagem estrutural se o SDK passar a expor o código no resultado da ferramenta.
 */
function isSdkInputValidationMessage(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const message = value.startsWith(SDK_INVALID_PARAMS_PREFIX)
    ? value.slice(SDK_INVALID_PARAMS_PREFIX.length)
    : value;
  return message.startsWith(SDK_INPUT_VALIDATION_PREFIX);
}

/** Monta o erro de ferramenta estável exposto pelos endpoints MCP do Kastir. */
function validationToolError(toolName: string | null): JsonObject {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          error: {
            code: "VALIDATION_ERROR",
            message: toolName
              ? `Invalid arguments for tool ${toolName}`
              : "Invalid MCP tool arguments",
          },
        }),
      },
    ],
    isError: true,
  };
}

/** Normaliza uma resposta unitária e informa se ela foi alterada. */
function normalizeToolValidationResponse(
  value: unknown,
  body: unknown,
): { value: unknown; changed: boolean } {
  if (!isJsonObject(value)) return { value, changed: false };

  const toolName = toolNameForResponse(body, value.id);
  const result = value.result;
  if (isJsonObject(result) && result.isError === true) {
    const content = result.content;
    const hasSdkValidationMessage =
      Array.isArray(content) &&
      content.some(
        (block) =>
          isJsonObject(block) && isSdkInputValidationMessage(block.text),
      );
    if (hasSdkValidationMessage) {
      return {
        value: { ...value, result: validationToolError(toolName) },
        changed: true,
      };
    }
  }

  const error = value.error;
  if (
    isJsonObject(error) &&
    error.code === -32602 &&
    isSdkInputValidationMessage(error.message)
  ) {
    return {
      value: {
        jsonrpc: value.jsonrpc,
        id: value.id,
        result: validationToolError(toolName),
      },
      changed: true,
    };
  }

  return { value, changed: false };
}

/**
 * Converte a validação pré-handler do SDK para o envelope MCP do Kastir;
 * mantém intactas respostas que não sejam chamadas de ferramenta.
 */
export async function normalizeMcpToolResponse(
  response: Response,
  body: unknown,
): Promise<Response> {
  const requests = Array.isArray(body) ? body : [body];
  if (
    !requests.some(
      (request) => isJsonObject(request) && request.method === "tools/call",
    )
  ) {
    return response;
  }

  let payload: unknown;
  try {
    payload = await response.clone().json();
  } catch {
    return response;
  }

  const values = Array.isArray(payload) ? payload : [payload];
  let changed = false;
  const normalized = values.map((value) => {
    const result = normalizeToolValidationResponse(value, body);
    changed ||= result.changed;
    return result.value;
  });
  if (!changed) return response;

  return new Response(
    JSON.stringify(Array.isArray(payload) ? normalized : normalized[0]),
    {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    },
  );
}
