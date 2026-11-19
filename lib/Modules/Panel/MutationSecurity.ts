import { z } from "zod";

import { auth } from "@/lib/auth";
import { toEffectiveRole } from "@/lib/Modules/Panel/Permissions";
import type { EffectiveRole } from "@/lib/Modules/Panel/Types";
import { NextResponse } from "next/server";

/** Limite de entrada para mutações administrativas JSON; evita leitura ilimitada antes do Zod. */
export const PANEL_MUTATION_BODY_MAX_BYTES = 256 * 1024;
/** Rotas de editor aceitam conteúdo de até 2 MiB definido pelo schema, mais o envelope JSON. */
export const PANEL_EDITOR_BODY_MAX_BYTES = 3 * 1024 * 1024;

export type PanelMutationAuthResult =
  | { status: "unauthenticated" }
  | { status: "invalid-role" }
  | { status: "authenticated"; userId: string; role: EffectiveRole };

export type TrustedPanelMutationAuthResult =
  PanelMutationAuthResult | { status: "untrusted-origin" };

/** O contrato único para endpoints destrutivos que exigem confirmação explícita. */
export const confirmedPanelMutationSchema = z
  .object({ confirmed: z.literal(true) })
  .strict();

export class PanelMutationBodyError extends Error {
  constructor(public readonly code: "INVALID_BODY" | "PAYLOAD_TOO_LARGE") {
    super(code);
    this.name = "PanelMutationBodyError";
  }
}

/** Mantém os erros de fronteira genéricos para o cliente e diferencia só o status HTTP. */
export function panelMutationBodyErrorResponse(error: unknown): NextResponse {
  const tooLarge =
    error instanceof PanelMutationBodyError &&
    error.code === "PAYLOAD_TOO_LARGE";

  return NextResponse.json(
    {
      error: tooLarge ? "Payload too large" : "Invalid JSON",
      code: "VALIDATION_ERROR",
    },
    { status: tooLarge ? 413 : 400 },
  );
}

/** Autentica uma mutação e mantém papel inválido separado de sessão ausente. */
export async function getPanelMutationAuth(
  request: Request,
): Promise<PanelMutationAuthResult> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) {
    return { status: "unauthenticated" };
  }

  try {
    return {
      status: "authenticated",
      userId: session.user.id,
      role: toEffectiveRole(session.user),
    };
  } catch {
    return { status: "invalid-role" };
  }
}

function httpOrigin(value: string | null): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Confere Origin/Referer contra a origem pública configurada, sem confiar no Host recebido. */
export function isTrustedPanelOrigin(
  request: Request,
  trustedOrigin: string,
): boolean {
  const requestOrigin = httpOrigin(
    request.headers.get("origin") ?? request.headers.get("referer"),
  );
  const configuredOrigin = httpOrigin(trustedOrigin);

  return requestOrigin !== null && requestOrigin === configuredOrigin;
}

/** Centraliza autenticação e CSRF por origem para toda mutação do painel. */
export async function getTrustedPanelMutationAuth(
  request: Request,
): Promise<TrustedPanelMutationAuthResult> {
  const authContext = await getPanelMutationAuth(request);
  if (authContext.status !== "authenticated") return authContext;

  return isTrustedPanelOrigin(request, process.env.BETTER_AUTH_URL ?? "")
    ? authContext
    : { status: "untrusted-origin" };
}

/**
 * Gate único das mutações do painel: sessão + origem confiável.
 * GETs continuam só com getXxxApiContext.
 */
export async function requireTrustedPanelMutation(
  request: Request,
): Promise<
  | { ok: true; userId: string; role: EffectiveRole }
  | { ok: false; response: NextResponse }
> {
  const authContext = await getTrustedPanelMutationAuth(request);
  if (authContext.status !== "authenticated") {
    return {
      ok: false,
      response: panelMutationAuthErrorResponse(authContext),
    };
  }
  return { ok: true, userId: authContext.userId, role: authContext.role };
}

/** Recusa multipart sem Content-Length ou acima do teto, antes de bufferizar. */
export function assertPanelMultipartLength(
  request: Request,
  maxBytes: number,
): void {
  const contentLength = request.headers.get("content-length")?.trim();
  if (contentLength === undefined || !/^\d+$/.test(contentLength)) {
    throw new PanelMutationBodyError("INVALID_BODY");
  }
  const declaredBytes = Number(contentLength);
  if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maxBytes) {
    throw new PanelMutationBodyError(
      declaredBytes > maxBytes ? "PAYLOAD_TOO_LARGE" : "INVALID_BODY",
    );
  }
}

/** Converte qualquer falha de fronteira de mutação em resposta segura e uniforme. */
export function panelMutationAuthErrorResponse(
  context: Exclude<TrustedPanelMutationAuthResult, { status: "authenticated" }>,
): NextResponse {
  return NextResponse.json(
    {
      error:
        context.status === "unauthenticated" ? "Unauthorized" : "Forbidden",
      code: context.status === "unauthenticated" ? "UNAUTHORIZED" : "FORBIDDEN",
    },
    { status: context.status === "unauthenticated" ? 401 : 403 },
  );
}

/** Resposta única para autorização de papel falhar depois da autenticação. */
export function panelMutationForbiddenResponse(): NextResponse {
  return NextResponse.json(
    { error: "Forbidden", code: "FORBIDDEN" },
    { status: 403 },
  );
}

/** Lê JSON em streaming para aplicar o teto também a requests sem Content-Length. */
export async function readPanelMutationJson(
  request: Request,
  maxBytes = PANEL_MUTATION_BODY_MAX_BYTES,
): Promise<unknown> {
  const contentLength = request.headers.get("content-length")?.trim();
  if (contentLength !== undefined) {
    if (!/^\d+$/.test(contentLength)) {
      throw new PanelMutationBodyError("INVALID_BODY");
    }

    const declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes)) {
      throw new PanelMutationBodyError("INVALID_BODY");
    }
    if (declaredBytes > maxBytes) {
      throw new PanelMutationBodyError("PAYLOAD_TOO_LARGE");
    }
  }

  if (!request.body) {
    throw new PanelMutationBodyError("INVALID_BODY");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        throw new PanelMutationBodyError("PAYLOAD_TOO_LARGE");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof PanelMutationBodyError) {
      await reader.cancel();
      throw error;
    }
    throw new PanelMutationBodyError("INVALID_BODY");
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new PanelMutationBodyError("INVALID_BODY");
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new PanelMutationBodyError("INVALID_BODY");
  }
}

/** Lê e valida a confirmação sem permitir campos extras ou ausência do literal true. */
export async function readConfirmedPanelMutation(
  request: Request,
): Promise<void> {
  const body = await readPanelMutationJson(request);
  if (!confirmedPanelMutationSchema.safeParse(body).success) {
    throw new PanelMutationBodyError("INVALID_BODY");
  }
}
