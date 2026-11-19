import { z } from "zod";

import { requireMcpScope, roleAllowsMcpScope } from "@/lib/Modules/Mcp/Policy";
import { MCP_DOMAIN_CAPABILITY_SCOPES } from "@/lib/Modules/Mcp/Scopes";
import type { McpScope } from "@/lib/Modules/Mcp/Scopes";
import type { McpToolContext } from "@/lib/Modules/Mcp/Types";
import { McpConfirmationRequiredError } from "@/lib/Modules/Mcp/Errors";
import { contentBytes, contentSha256 } from "@/lib/Modules/Shared/ContentPatch";

export function requireReadScope(context: McpToolContext): void {
  requireMcpScope(context, "cms:read");
}

/**
 * Gate de descoberta via mapa único domínio → scope e allowlist do papel;
 * um scope forjado no contexto não pode tornar a capability visível.
 */
export function canMcp<
  Domain extends keyof typeof MCP_DOMAIN_CAPABILITY_SCOPES,
  Action extends keyof (typeof MCP_DOMAIN_CAPABILITY_SCOPES)[Domain] & string,
>(context: McpToolContext, domain: Domain, action: Action): boolean {
  const scope = MCP_DOMAIN_CAPABILITY_SCOPES[domain][action];
  return (
    context.scopes.includes(scope as McpScope) &&
    roleAllowsMcpScope(context.role, scope as McpScope)
  );
}

// Block sizes for long page/script/preview text. Sized against MCP_RATE_LIMITS
// read (120 req / 60 s): 2MB at 50k chars ≈ 42 calls (~35% of the window).
export const MCP_TEXT_SLICE_DEFAULT = 50_000;
export const MCP_TEXT_SLICE_MAX = 100_000;

/** Optional slice params shared by pages_get / pages_preview / scripts_get. */
export const mcpTextSliceInputSchema = {
  contentStart: z.number().int().min(0).optional(),
  contentLength: z.number().int().positive().optional(),
};

// Confirmação continua opcional no schema para que ausência e literal errado
// retornem o erro de política próprio, em vez de uma falha genérica de shape.
export const mcpConfirmationInputSchema = z.string().max(64).optional();

/** Confere no servidor o literal que autoriza uma mutation MCP sensível. */
export function requireMcpConfirmation(value: unknown, expected: string): void {
  if (value !== expected) {
    throw new McpConfirmationRequiredError(expected);
  }
}

export type McpTextSliceOptions = {
  contentStart?: number;
  contentLength?: number;
};

export type McpTextSlice = {
  contentTotal: number;
  content?: string;
  contentStart?: number;
  contentLength?: number;
  nextStart?: number;
};

/**
 * Partial text read for long fields. Without contentStart, only contentTotal
 * is returned so the agent can decide whether to fetch blocks. `contentTotal`
 * is `text.length`, in UTF-16 code units (CRLF counts 2, a character outside the
 * BMP counts 2); UTF-8 bytes and the SHA-256 come from `mcpContentIntegrity`.
 */
export function readMcpTextSlice(
  text: string,
  options?: McpTextSliceOptions,
): McpTextSlice {
  const contentTotal = text.length;
  if (options?.contentStart === undefined) {
    return { contentTotal };
  }

  const start = options.contentStart;
  const requested = options.contentLength ?? MCP_TEXT_SLICE_DEFAULT;
  const length = Math.min(Math.max(requested, 1), MCP_TEXT_SLICE_MAX);

  if (start >= contentTotal) {
    return {
      content: "",
      contentStart: start,
      contentLength: 0,
      contentTotal,
    };
  }

  const content = text.slice(start, start + length);
  const end = start + content.length;
  return {
    content,
    contentStart: start,
    contentLength: content.length,
    contentTotal,
    ...(end < contentTotal ? { nextStart: end } : {}),
  };
}

/**
 * Prova de integridade do conteúdo INTEIRO de uma página ou script, devolvida
 * por get, update e patch: `contentSha256` (SHA-256 hexadecimal minúsculo dos
 * bytes UTF-8, o valor que o agente reenvia como `expectedContentSha256`) e
 * `contentBytes` (bytes UTF-8, a unidade do limite de 2 MiB). Fica fora de
 * `readMcpTextSlice` de propósito: aquele helper conhece só o texto do bloco
 * pedido e o seu contrato (`contentTotal` em unidades UTF-16) não muda; hash e
 * bytes valem sempre para o conteúdo inteiro, mesmo quando o get devolve só
 * um bloco. Calculado na hora, sem coluna nem migration (decisão 4 da spec).
 */
export function mcpContentIntegrity(content: string): {
  contentSha256: string;
  contentBytes: number;
} {
  return {
    contentSha256: contentSha256(content),
    contentBytes: contentBytes(content),
  };
}

/**
 * Plain success payload for mutations; runMcp* wraps with toMcpToolJson once.
 * `summary` is prose the agent reads as an assertion, so callers identify the
 * record by id — user-controlled titles/names belong in `data`, as data.
 */
export function toMcpSuccess(
  summary: string,
  data?: Record<string, unknown>,
): { ok: true; summary: string; data?: Record<string, unknown> } {
  return data === undefined
    ? { ok: true, summary }
    : { ok: true, summary, data };
}

// Text-only payload: clients that also render structuredContent would pay 2×
// context cost for every tool result. No tool declares outputSchema today.
export function toMcpToolJson(value: unknown): {
  content: [{ type: "text"; text: string }];
} {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value),
      },
    ],
  };
}

export function toMcpToolError(error: unknown): {
  content: [{ type: "text"; text: string }];
  isError: true;
} {
  const known =
    error instanceof Error && "code" in error && typeof error.code === "string"
      ? { code: error.code, message: error.message }
      : { code: "INTERNAL_ERROR", message: "MCP tool failed" };

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ error: known }),
      },
    ],
    isError: true,
  };
}

type McpToolResult =
  | { content: [{ type: "text"; text: string }] }
  | { content: [{ type: "text"; text: string }]; isError: true };

export async function runMcpReadTool<T>(
  context: McpToolContext,
  handler: () => Promise<T>,
): Promise<McpToolResult> {
  try {
    requireReadScope(context);
    return toMcpToolJson(await handler());
  } catch (error) {
    return toMcpToolError(error);
  }
}

export async function runMcpScopedTool<T>(
  context: McpToolContext,
  scope: McpScope,
  handler: () => Promise<T>,
): Promise<McpToolResult> {
  try {
    ensureScope(context, scope);
    return toMcpToolJson(await handler());
  } catch (error) {
    return toMcpToolError(error);
  }
}

export function ensureScope(context: McpToolContext, scope: McpScope): void {
  requireMcpScope(context, scope);
}

/**
 * For handlers that must run their own authorization checks in a specific
 * order (e.g. requireMcpAdministrator before requireMcpScope, so an EDITOR
 * never reaches the scope check at all) — unlike runMcpReadTool/
 * runMcpScopedTool, this performs no precheck itself.
 */
export async function runMcpTool<T>(
  handler: () => Promise<T>,
): Promise<McpToolResult> {
  try {
    return toMcpToolJson(await handler());
  } catch (error) {
    return toMcpToolError(error);
  }
}
