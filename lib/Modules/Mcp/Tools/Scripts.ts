import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { customCodeService } from "@/lib/Modules/CustomCode/Service";
import {
  createSnippetSchema,
  patchSnippetContentSchema,
  triggerFieldsSchema,
  updateSnippetSchema,
} from "@/lib/Modules/CustomCode/Schema";
import { toSnippetRevisionSnapshot } from "@/lib/Modules/CustomCode/lifecycle";
import type {
  SnippetListItem,
  SnippetRecord,
  SnippetWithLifecycle,
} from "@/lib/Modules/CustomCode/Types";
import { MAX_REVISION_PAGE_SIZE } from "@/lib/Modules/Revisions/Schema";
import {
  paginationInputSchema,
  toMcpPageResult,
  type McpPageResult,
} from "@/lib/Modules/Mcp/Schema";
import type { McpToolContext } from "@/lib/Modules/Mcp/Types";
import { mcpAuditContext } from "@/lib/Modules/Mcp/Audit";
import { requireMcpScope } from "@/lib/Modules/Mcp/Policy";
import { McpValidationError } from "@/lib/Modules/Mcp/Errors";
import {
  canMcp,
  mcpConfirmationInputSchema,
  mcpContentIntegrity,
  mcpTextSliceInputSchema,
  readMcpTextSlice,
  requireMcpConfirmation,
  requireReadScope,
  runMcpReadTool,
  runMcpScopedTool,
  toMcpSuccess,
} from "@/lib/Modules/Mcp/Tools/Shared";

const scriptListInputSchema = z
  .object({
    ...paginationInputSchema,
    search: z.string().trim().max(200).optional(),
    status: z.enum(["DRAFT", "PUBLISHED"]).optional(),
    location: z.enum(["HEADER", "BODY_START", "BODY_END"]).optional(),
    scopeType: z.enum(["ALL_PAGES", "SPECIFIC_PAGES"]).optional(),
  })
  .strict();

// Scope selection searches pages; script lifecycle filters do not belong here
// because the delegated service only supports page search and pagination.
const scriptScopePagesListInputSchema = z
  .object({
    ...paginationInputSchema,
    search: z.string().trim().max(200).optional(),
  })
  .strict();

const scriptIdInputSchema = z
  .object({
    scriptId: z.string().trim().min(1),
  })
  .strict();

const confirmedScriptIdInputSchema = scriptIdInputSchema
  .extend({ confirmation: mcpConfirmationInputSchema })
  .strict();

const scriptDetailInputSchema = z
  .object({
    scriptId: z.string().trim().min(1),
    ...mcpTextSliceInputSchema,
  })
  .strict();

const scriptRevisionListInputSchema = z
  .object({
    scriptId: z.string().trim().min(1),
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(1).max(MAX_REVISION_PAGE_SIZE).optional(),
  })
  .strict();

const scriptRevisionGetInputSchema = z
  .object({
    scriptId: z.string().trim().min(1),
    revisionId: z.string().trim().min(1),
    ...mcpTextSliceInputSchema,
  })
  .strict();

const scriptRevisionDiffInputSchema = z
  .object({
    scriptId: z.string().trim().min(1),
    from: z.string().trim().min(1).max(200),
    to: z.string().trim().min(1).max(200),
  })
  .strict();

const scriptRevisionRestoreInputSchema = z
  .object({
    scriptId: z.string().trim().min(1),
    revisionId: z.string().trim().min(1),
    expectedUpdatedAt: z.iso.datetime(),
  })
  .strict();

// `trigger` is a discriminated union, so its JSON Schema is an `anyOf` with no
// top-level `type`. Clients that decide how to serialize an argument from that
// `type` send the object as a JSON string instead, which the union then rejects
// ("expected object, received string"). Parse that form back before validating.
const mcpTriggerSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed === "null") return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value; // let the union report the real validation error
  }
}, triggerFieldsSchema.nullable());

// registerTool() converts inputSchema to JSON Schema for tools/list; z.coerce.date()
// (used by updateSnippetSchema for admin-panel callers) cannot be represented in JSON
// Schema and throws, which fails tools/list for every tool. MCP arguments arrive as
// JSON anyway, so accept the timestamp as an ISO string here instead.
//
// `pageIds` (create and update) is inherited as-is from the panel schemas, so the MCP
// refuses what the panel refuses: cuid items, at most SCOPE_PAGE_IDS_MAX, repeats collapsed.
// The SDK validates this schema before the handler runs, so a refused `pageIds` never reaches
// the Service. Through the `/api/mcp` route, `normalizeMcpToolResponse` turns the SDK refusal
// into VALIDATION_ERROR "Invalid arguments for tool <name>" with neither the field nor the
// value (only an in-memory SDK client sees the raw text, with the field named); the
// scope-specific message built by the Service only exists in the panel path. The limit is
// advertised to agents as `maxItems` in tools/list.
//
// `expectedContentSha256` (64 hex, optional) is inherited from the panel schema through the
// spread: when present it is the only version checked and `expectedUpdatedAt` is ignored.
const updateSnippetMcpInputSchema = z
  .object({
    ...updateSnippetSchema.shape,
    expectedUpdatedAt: z.iso.datetime().optional(),
    trigger: mcpTriggerSchema.optional(),
  })
  .strict();

const createSnippetMcpInputSchema = z
  .object({
    ...createSnippetSchema.shape,
    trigger: mcpTriggerSchema.optional(),
  })
  .strict();

type ScriptListInput = z.infer<typeof scriptListInputSchema>;
type ScriptScopePagesListInput = z.infer<
  typeof scriptScopePagesListInputSchema
>;
type ScriptIdInput = z.infer<typeof scriptIdInputSchema>;
type ConfirmedScriptIdInput = z.infer<typeof confirmedScriptIdInputSchema>;
type ScriptDetailInput = z.infer<typeof scriptDetailInputSchema>;

function scriptListItem(script: SnippetListItem): Record<string, unknown> {
  return {
    id: script.id,
    name: script.name,
    location: script.location,
    status: script.status,
    priority: script.priority,
    scopeType: script.scopeType,
    scopedPageIds: (script.scopedPages ?? []).map((scope) => scope.pageId),
    // Popup activation fields — list keeps type + caps, not full config (noise).
    triggerType: script.triggerType,
    maxDisplays: script.maxDisplays,
    displayResetDays: script.displayResetDays,
  };
}

function scriptDetailMeta(script: SnippetRecord): Record<string, unknown> {
  return {
    ...scriptListItem(script),
    triggerConfig: script.triggerConfig,
    createdAt: script.createdAt,
    updatedAt: script.updatedAt,
  };
}

function scriptMutationData(script: SnippetRecord): Record<string, unknown> {
  return {
    id: script.id,
    name: script.name,
    status: script.status,
    updatedAt: script.updatedAt,
  };
}

/** Estado draft/live sem o HTML/JS do snapshot publicado. */
function scriptPublishedState(
  script: SnippetRecord & Partial<SnippetWithLifecycle>,
): Record<string, unknown> {
  return {
    publishedRevisionId: script.publishedRevisionId ?? null,
    hasUnpublishedChanges:
      script.hasUnpublishedChanges ?? script.status !== "PUBLISHED",
    activated: script.activated ?? script.status === "PUBLISHED",
    published: script.published
      ? {
          name: script.published.name,
          location: script.published.location,
          scopeType: script.published.scopeType,
        }
      : null,
  };
}

function scriptDraftMutationData(
  script: SnippetRecord & Partial<SnippetWithLifecycle>,
): Record<string, unknown> {
  return {
    ...scriptMutationData(script),
    ...scriptPublishedState(script),
  };
}

/**
 * Resposta de update e patch: a de qualquer mutation de rascunho mais o hash e os
 * bytes do código gravado, para o agente conferir o resultado sem reler o script e
 * reaproveitar `contentSha256` como `expectedContentSha256` da próxima edição. Só
 * update e patch gravam conteúdo; as demais mutations não repetem o cálculo.
 */
function scriptContentData(
  script: SnippetRecord & Partial<SnippetWithLifecycle>,
): Record<string, unknown> {
  return {
    ...scriptDraftMutationData(script),
    ...mcpContentIntegrity(script.content),
  };
}

function parseMcpInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new McpValidationError();
  return parsed.data;
}

async function snippetRevisionService() {
  const { revisionService } = await import("@/lib/Modules/Revisions/Api");
  return revisionService();
}

export async function listMcpScripts(
  context: McpToolContext,
  input: ScriptListInput,
): Promise<McpPageResult<Record<string, unknown>>> {
  requireReadScope(context);
  const result = await customCodeService.listSnippets(input);
  return toMcpPageResult(result.items.map(scriptListItem), result.total, {
    page: result.page,
    pageSize: result.pageSize,
  });
}

export async function getMcpScript(
  context: McpToolContext,
  input: ScriptDetailInput,
): Promise<Record<string, unknown>> {
  requireReadScope(context);
  const script = await customCodeService.getSnippet(input.scriptId);
  const slice = readMcpTextSlice(script.content, {
    contentStart: input.contentStart,
    contentLength: input.contentLength,
  });
  return {
    ...scriptDetailMeta(script),
    ...scriptPublishedState(script),
    // Hash e bytes do código inteiro, mesmo quando só um bloco é devolvido.
    ...mcpContentIntegrity(script.content),
    ...slice,
  };
}

export async function listMcpScriptScopePages(
  context: McpToolContext,
  input: ScriptScopePagesListInput,
): Promise<McpPageResult<{ id: string; title: string; slug: string }>> {
  requireReadScope(context);
  const result = await customCodeService.listScopePages(input);
  return toMcpPageResult(result.items, result.total, {
    page: result.page,
    pageSize: result.pageSize,
  });
}

export async function createMcpScript(context: McpToolContext, input: unknown) {
  requireMcpScope(context, "cms:scripts:write");
  const script = await customCodeService.createSnippet(
    context.userId,
    input,
    mcpAuditContext(context, "kastir_scripts_create"),
  );
  return toMcpSuccess(
    `Script ${script.id} created (${script.status}) — not live yet. Call kastir_scripts_publish to activate.`,
    {
      ...scriptMutationData(script),
      // Create/duplicate stay inactive so clients must choose activation explicitly.
      activationRequired: true,
    },
  );
}

export async function updateMcpScript(context: McpToolContext, input: unknown) {
  requireMcpScope(context, "cms:scripts:write");
  const parsed = updateSnippetMcpInputSchema.safeParse(input);
  const script = await customCodeService.updateSnippet(
    context.userId,
    parsed.success ? parsed.data : input,
    mcpAuditContext(context, "kastir_scripts_update"),
  );
  const dirty = script.hasUnpublishedChanges ? "yes" : "no";
  return toMcpSuccess(
    `Script ${script.id} saved as draft. Unpublished changes: ${dirty}. Call kastir_scripts_publish to make the draft live.`,
    scriptContentData(script),
  );
}

/**
 * Edição parcial do código do rascunho por busca e troca exata (`{id,
 * expectedContentSha256, operations}`). Confere só o escopo de escrita; o serviço
 * valida a entrada, confere o hash, aplica as operações (tudo ou nada) e grava pelo
 * mesmo Save do update, com a trava de linha. Operação inválida não grava nem
 * audita; resultado idêntico ao código atual termina com sucesso e sem escrita.
 * Altera só `content`; nome, escopo e gatilho seguem pelo update. Como o update, não
 * exige confirmação: só publicar e despublicar levam código ao ar.
 */
export async function patchMcpScript(context: McpToolContext, input: unknown) {
  requireMcpScope(context, "cms:scripts:write");
  const script = await customCodeService.patchSnippetContent(
    context.userId,
    input,
    mcpAuditContext(context, "kastir_scripts_patch"),
  );
  const dirty = script.hasUnpublishedChanges ? "yes" : "no";
  return toMcpSuccess(
    `Script ${script.id} draft patched. Unpublished changes: ${dirty}. Call kastir_scripts_publish to make the draft live.`,
    scriptContentData(script),
  );
}

export async function duplicateMcpScript(
  context: McpToolContext,
  input: ScriptIdInput,
) {
  requireMcpScope(context, "cms:scripts:write");
  const script = await customCodeService.duplicateSnippet(
    context.userId,
    input.scriptId,
    mcpAuditContext(context, "kastir_scripts_duplicate"),
  );
  return toMcpSuccess(
    `Script ${script.id} duplicated (${script.status}) — not live yet. Call kastir_scripts_publish to activate.`,
    { ...scriptMutationData(script), activationRequired: true },
  );
}

/** Adaptador MCP reversível: envia o script à lixeira sem expor conteúdo. */
export async function trashMcpScript(
  context: McpToolContext,
  input: ScriptIdInput,
) {
  requireMcpScope(context, "cms:scripts:write");
  const script = await customCodeService.trashSnippet(
    context.userId,
    input.scriptId,
    mcpAuditContext(context, "kastir_scripts_trash"),
  );
  return toMcpSuccess(`Script ${script.id} moved to trash.`, {
    id: script.id,
    status: script.status,
    deletedAt: script.deletedAt,
  });
}

export async function publishMcpScript(
  context: McpToolContext,
  input: ConfirmedScriptIdInput,
) {
  requireMcpScope(context, "cms:scripts:publish");
  requireMcpConfirmation(input.confirmation, "PUBLISH_SCRIPT");
  const script = await customCodeService.publishSnippet(
    context.userId,
    input.scriptId,
    mcpAuditContext(context, "kastir_scripts_publish"),
    { enforceConfirmation: true, confirmationApproved: true },
  );
  return toMcpSuccess(
    `Script ${script.id} published.`,
    scriptMutationData(script),
  );
}

/**
 * "Voltar ao ar" do switch do painel (POST /api/admin/custom-code/:id/activate):
 * religa só a revisão já publicada, sem materializar o rascunho nem criar
 * versão. Complementa publish, que recusa com INVALID_STATE quando não há
 * alteração. Recoloca código de autor no ar, então herda o escopo e a
 * confirmação de publish (PUBLISH_SCRIPT); o serviço já aplica a barreira
 * server-side para o adaptador MCP. Script nunca publicado é recusado pelo
 * serviço (INVALID_STATE).
 */
export async function activateMcpScript(
  context: McpToolContext,
  input: ConfirmedScriptIdInput,
) {
  requireMcpScope(context, "cms:scripts:publish");
  requireMcpConfirmation(input.confirmation, "PUBLISH_SCRIPT");
  const script = await customCodeService.activateSnippet(
    context.userId,
    input.scriptId,
    mcpAuditContext(context, "kastir_scripts_activate"),
    { enforceConfirmation: true, confirmationApproved: true },
  );
  const dirty = script.hasUnpublishedChanges ? "yes" : "no";
  return toMcpSuccess(
    `Script ${script.id} is live on its published revision. Unpublished changes: ${dirty}.`,
    scriptDraftMutationData(script),
  );
}

export async function unpublishMcpScript(
  context: McpToolContext,
  input: ConfirmedScriptIdInput,
) {
  requireMcpScope(context, "cms:scripts:unpublish");
  requireMcpConfirmation(input.confirmation, "UNPUBLISH_SCRIPT");
  const script = await customCodeService.unpublishSnippet(
    context.userId,
    input.scriptId,
    mcpAuditContext(context, "kastir_scripts_unpublish"),
    { enforceConfirmation: true, confirmationApproved: true },
  );
  return toMcpSuccess(
    `Script ${script.id} deactivated.`,
    scriptDraftMutationData(script),
  );
}

/** Lista revisões do script autorizado; itens sem conteúdo executável. */
export async function listMcpScriptRevisions(
  context: McpToolContext,
  input: unknown,
): Promise<McpPageResult<Record<string, unknown>>> {
  requireReadScope(context);
  const parsed = parseMcpInput(scriptRevisionListInputSchema, input);
  const script = await customCodeService.getSnippet(parsed.scriptId);
  const result = await (
    await snippetRevisionService()
  ).listSnippetRevisions({
    snippetId: script.id,
    publishedRevisionId: script.publishedRevisionId ?? null,
    page: parsed.page ?? 1,
    pageSize: parsed.pageSize ?? 20,
  });
  return toMcpPageResult(
    result.items.map((item) => ({
      id: item.id,
      snippetId: item.snippetId,
      authorId: item.authorId,
      authorName: item.authorName ?? null,
      pinned: item.pinned,
      createdAt: item.createdAt,
      name: item.name,
      published: item.published,
      fingerprint: item.fingerprint,
    })),
    result.total,
    { page: result.page, pageSize: result.pageSize },
  );
}

/** GET de uma revisão de script; conteúdo só por slice e nunca executado. */
export async function getMcpScriptRevision(
  context: McpToolContext,
  input: unknown,
): Promise<Record<string, unknown>> {
  requireReadScope(context);
  const parsed = parseMcpInput(scriptRevisionGetInputSchema, input);
  await customCodeService.getSnippet(parsed.scriptId);
  const revision = await (
    await snippetRevisionService()
  ).getSnippetRevisionForSnippet(parsed.revisionId, parsed.scriptId);
  const { content, fingerprint, ...meta } = revision;
  void fingerprint;
  const slice = readMcpTextSlice(content, {
    contentStart: parsed.contentStart,
    contentLength: parsed.contentLength,
  });
  return { ...meta, ...slice };
}

/** Diff revisão↔draft ou revisão↔revisão do mesmo snippet. */
export async function diffMcpScriptRevisions(
  context: McpToolContext,
  input: unknown,
): Promise<Record<string, unknown>> {
  requireReadScope(context);
  const parsed = parseMcpInput(scriptRevisionDiffInputSchema, input);
  const script = await customCodeService.getSnippet(parsed.scriptId);
  return (await snippetRevisionService()).diffSnippetRevision({
    snippetId: script.id,
    fromRevisionId: parsed.from,
    to:
      parsed.to === "draft"
        ? { kind: "draft", snapshot: toSnippetRevisionSnapshot(script) }
        : { kind: "revision", revisionId: parsed.to },
  });
}

/** Copia a revisão para o rascunho; nunca publica. */
export async function restoreMcpScriptRevision(
  context: McpToolContext,
  input: unknown,
) {
  requireMcpScope(context, "cms:scripts:write");
  const parsed = parseMcpInput(scriptRevisionRestoreInputSchema, input);
  const script = await customCodeService.restoreSnippetRevision(
    context.userId,
    parsed.scriptId,
    parsed.revisionId,
    new Date(parsed.expectedUpdatedAt),
    mcpAuditContext(context, "kastir_scripts_revisions_restore"),
  );
  return toMcpSuccess(
    `Script ${script.id} restored into the draft. Call kastir_scripts_publish to make the draft live.`,
    scriptDraftMutationData(script),
  );
}

export function registerScriptTools(
  server: McpServer,
  context: McpToolContext,
): void {
  if (canMcp(context, "scripts", "read")) {
    server.registerTool(
      "kastir_scripts_list",
      {
        title: "List Scripts",
        description: "List scripts without content or triggerConfig.",
        inputSchema: scriptListInputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      (input) => runMcpReadTool(context, () => listMcpScripts(context, input)),
    );
    server.registerTool(
      "kastir_scripts_get",
      {
        title: "Get Script",
        description:
          "Get script metadata + triggerConfig + contentSha256/contentBytes. Server does not execute content; browsers may after publish. Default omits content; contentStart reads a block.",
        inputSchema: scriptDetailInputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      (input) => runMcpReadTool(context, () => getMcpScript(context, input)),
    );
    server.registerTool(
      "kastir_scripts_scope_pages_list",
      {
        title: "List Script Scope Pages",
        description: "List pages eligible for script scope selection.",
        inputSchema: scriptScopePagesListInputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      (input) =>
        runMcpReadTool(context, () => listMcpScriptScopePages(context, input)),
    );
    server.registerTool(
      "kastir_scripts_revisions_list",
      {
        title: "List Script Revisions",
        description:
          "List script revisions (author, date, pinned, published). Items omit content.",
        inputSchema: scriptRevisionListInputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      (input) =>
        runMcpReadTool(context, () => listMcpScriptRevisions(context, input)),
    );
    server.registerTool(
      "kastir_scripts_revisions_get",
      {
        title: "Get Script Revision",
        description:
          "Get one script revision. Default omits content. Server does not execute it; browsers may after publish.",
        inputSchema: scriptRevisionGetInputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      (input) =>
        runMcpReadTool(context, () => getMcpScriptRevision(context, input)),
    );
    server.registerTool(
      "kastir_scripts_revisions_diff",
      {
        title: "Diff Script Revisions",
        description:
          'Diff two script revisions or a revision vs the current draft (to="draft", e.g. from publishedRevisionId). Lines are -/+.',
        inputSchema: scriptRevisionDiffInputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      (input) =>
        runMcpReadTool(context, () => diffMcpScriptRevisions(context, input)),
    );
  }

  if (canMcp(context, "scripts", "write")) {
    server.registerTool(
      "kastir_scripts_create",
      {
        title: "Create Script",
        description:
          "Create a draft script; not live until kastir_scripts_publish. Optional popup trigger; maxDisplays/displayResetDays need it. Overlay is author HTML.",
        inputSchema: createSnippetMcpInputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      (input) =>
        runMcpScopedTool(context, "cms:scripts:write", () =>
          createMcpScript(context, input),
        ),
    );
    server.registerTool(
      "kastir_scripts_update",
      {
        title: "Update Script",
        description:
          "Save script draft only; does not publish. Returns contentSha256; optional expectedContentSha256. Server does not execute content; browsers may after publish.",
        inputSchema: updateSnippetMcpInputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      (input) =>
        runMcpScopedTool(context, "cms:scripts:write", () =>
          updateMcpScript(context, input),
        ),
    );
    // O schema do serviço é a fonte única dos limites (1 a 50 operações, `old` não vazio,
    // hash de 64 hex, bytes do domínio): a recusa acontece antes do handler, e pela rota
    // /api/mcp chega como VALIDATION_ERROR sem campo nem valor. Idempotente porque o hash
    // esperado barra a repetição: repetir um patch já aplicado dá CONFLICT, sem novo efeito.
    server.registerTool(
      "kastir_scripts_patch",
      {
        title: "Patch Script",
        description:
          "Edit script code by exact search/replace: 1-50 {old,new} ops, old non-empty, each old once. Needs expectedContentSha256 (64 hex). Result max 2 MiB UTF-8.",
        inputSchema: patchSnippetContentSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      (input) =>
        runMcpScopedTool(context, "cms:scripts:write", () =>
          patchMcpScript(context, input),
        ),
    );
    server.registerTool(
      "kastir_scripts_duplicate",
      {
        title: "Duplicate Script",
        description:
          "Duplicate a script as a draft; call kastir_scripts_publish to activate.",
        inputSchema: scriptIdInputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      (input) =>
        runMcpScopedTool(context, "cms:scripts:write", () =>
          duplicateMcpScript(context, input),
        ),
    );
    server.registerTool(
      "kastir_scripts_trash",
      {
        title: "Trash Script",
        description: "Move a script to the reversible trash as a draft.",
        inputSchema: scriptIdInputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      (input) =>
        runMcpScopedTool(context, "cms:scripts:write", () =>
          trashMcpScript(context, input),
        ),
    );
    server.registerTool(
      "kastir_scripts_revisions_restore",
      {
        title: "Restore Script Revision",
        description:
          "Copy a script revision into the draft. Requires expectedUpdatedAt. Does not publish.",
        inputSchema: scriptRevisionRestoreInputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      (input) =>
        runMcpScopedTool(context, "cms:scripts:write", () =>
          restoreMcpScriptRevision(context, input),
        ),
    );
  }

  if (canMcp(context, "scripts", "publish")) {
    server.registerTool(
      "kastir_scripts_publish",
      {
        title: "Publish Script",
        description:
          "Publish the draft after PUBLISH_SCRIPT. Server does not execute it; browsers may. INVALID_STATE if unchanged: use kastir_scripts_activate.",
        inputSchema: confirmedScriptIdInputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      (input) =>
        runMcpScopedTool(context, "cms:scripts:publish", () =>
          publishMcpScript(context, input),
        ),
    );
    // Activate vive no mesmo gate de publish: o escopo concedido é o mesmo.
    server.registerTool(
      "kastir_scripts_activate",
      {
        title: "Activate Script",
        description:
          "Reactivate a script on its last published revision after PUBLISH_SCRIPT (draft not published). Browsers may run it. INVALID_STATE if never published.",
        inputSchema: confirmedScriptIdInputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      (input) =>
        runMcpScopedTool(context, "cms:scripts:publish", () =>
          activateMcpScript(context, input),
        ),
    );
  }

  if (canMcp(context, "scripts", "unpublish")) {
    server.registerTool(
      "kastir_scripts_unpublish",
      {
        title: "Unpublish Script",
        description:
          "Deactivate a script after UNPUBLISH_SCRIPT. Removes live code; keeps publishedRevisionId.",
        inputSchema: confirmedScriptIdInputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      (input) =>
        runMcpScopedTool(context, "cms:scripts:unpublish", () =>
          unpublishMcpScript(context, input),
        ),
    );
  }
}
