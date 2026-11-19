import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { listDailyStats } from "@/lib/Modules/SplitTests/Aggregation";
import { splitTestsService } from "@/lib/Modules/SplitTests/Service";
import {
  createCampaignSchema,
  createDestinationSchema,
  reorderDestinationsSchema,
  updateCampaignSchema,
  updateDestinationSchema,
} from "@/lib/Modules/SplitTests/Schema";
import type {
  SplitCampaignDetail,
  SplitCampaignListItem,
} from "@/lib/Modules/SplitTests/Types";
import {
  paginationInputSchema,
  toMcpPageResult,
  type McpPageResult,
} from "@/lib/Modules/Mcp/Schema";
import { mcpAuditContext } from "@/lib/Modules/Mcp/Audit";
import { requireMcpScope } from "@/lib/Modules/Mcp/Policy";
import type { McpToolContext } from "@/lib/Modules/Mcp/Types";
import {
  canMcp,
  requireReadScope,
  runMcpReadTool,
  runMcpScopedTool,
  toMcpSuccess,
} from "@/lib/Modules/Mcp/Tools/Shared";

const splitTestListInputSchema = z
  .object({
    ...paginationInputSchema,
    search: z.string().trim().max(200).optional(),
    status: z.enum(["ACTIVE", "PAUSED"]).optional(),
  })
  .strict();

const splitTestDetailInputSchema = z
  .object({
    campaignId: z.string().trim().min(1),
  })
  .strict();

const splitTestStatsInputSchema = z
  .object({
    ...paginationInputSchema,
    campaignId: z.string().trim().min(1),
    destinationId: z.string().trim().min(1).optional(),
    from: z.iso.date(),
    to: z.iso.date(),
  })
  .strict();

// registerTool() converts inputSchema to JSON Schema for tools/list; z.coerce.date()
// (used by updateCampaignSchema/updateDestinationSchema for panel callers) cannot be
// represented in JSON Schema and throws, which fails tools/list for every tool. MCP
// arguments arrive as JSON anyway, so accept the timestamp as an ISO string here
// instead — same pattern as Pages/Scripts.
const createSplitTestMcpInputSchema = createCampaignSchema.strict();

const updateSplitTestMcpInputSchema = z
  .object({
    campaignId: z.string().trim().min(1),
    ...updateCampaignSchema.shape,
    expectedUpdatedAt: z.iso.datetime().optional(),
  })
  .strict();

const createSplitTestDestinationMcpInputSchema = z
  .object({
    campaignId: z.string().trim().min(1),
    ...createDestinationSchema.shape,
  })
  .strict();

const updateSplitTestDestinationMcpInputSchema = z
  .object({
    campaignId: z.string().trim().min(1),
    destinationId: z.string().trim().min(1),
    ...updateDestinationSchema.shape,
    expectedUpdatedAt: z.iso.datetime().optional(),
  })
  .strict();

const reorderSplitTestDestinationsMcpInputSchema = z
  .object({
    campaignId: z.string().trim().min(1),
    ...reorderDestinationsSchema.shape,
  })
  .strict();

type SplitTestListInput = z.infer<typeof splitTestListInputSchema>;
type SplitTestDetailInput = z.infer<typeof splitTestDetailInputSchema>;
type SplitTestStatsInput = z.infer<typeof splitTestStatsInputSchema>;
type UpdateSplitTestMcpInput = z.infer<typeof updateSplitTestMcpInputSchema>;
type CreateSplitTestDestinationMcpInput = z.infer<
  typeof createSplitTestDestinationMcpInputSchema
>;
type UpdateSplitTestDestinationMcpInput = z.infer<
  typeof updateSplitTestDestinationMcpInputSchema
>;
type ReorderSplitTestDestinationsMcpInput = z.infer<
  typeof reorderSplitTestDestinationsMcpInputSchema
>;

function splitTestListItem(
  campaign: SplitCampaignListItem,
): Record<string, unknown> {
  return {
    id: campaign.id,
    name: campaign.name,
    slug: campaign.slug,
    status: campaign.status,
    activeDestinationCount: campaign.activeDestinationCount,
    totalHits: campaign.totalHits,
  };
}

function splitTestMutationData(
  campaign: SplitCampaignDetail,
): Record<string, unknown> {
  return {
    id: campaign.id,
    name: campaign.name,
    slug: campaign.slug,
    status: campaign.status,
    updatedAt: campaign.updatedAt,
    destinationCount: campaign.destinations.length,
  };
}

/** UTC calendar-day string (YYYY-MM-DD), matching the day-only ISO input the tool accepts. */
function utcDayString(day: Date): string {
  return day.toISOString().slice(0, 10);
}

export async function listMcpSplitTests(
  context: McpToolContext,
  input: SplitTestListInput,
): Promise<McpPageResult<Record<string, unknown>>> {
  requireReadScope(context);
  const result = await splitTestsService.listCampaigns(input);
  return toMcpPageResult(result.items.map(splitTestListItem), result.total, {
    page: result.page,
    pageSize: result.pageSize,
  });
}

export async function getMcpSplitTest(
  context: McpToolContext,
  input: SplitTestDetailInput,
): Promise<SplitCampaignDetail> {
  requireReadScope(context);
  return splitTestsService.getCampaign(input.campaignId);
}

export async function getMcpSplitTestStats(
  context: McpToolContext,
  input: SplitTestStatsInput,
): Promise<
  McpPageResult<{ day: string; destinationId: string; hits: number }> & {
    timezone: "UTC";
  }
> {
  requireReadScope(context);
  const result = await listDailyStats({
    campaignId: input.campaignId,
    destinationId: input.destinationId,
    from: new Date(`${input.from}T00:00:00.000Z`),
    to: new Date(`${input.to}T00:00:00.000Z`),
    page: input.page,
    pageSize: input.pageSize,
  });
  return {
    ...toMcpPageResult(
      result.items.map((item) => ({
        day: utcDayString(item.day),
        destinationId: item.destinationId,
        hits: item.hits,
      })),
      result.total,
      { page: result.page, pageSize: result.pageSize },
    ),
    timezone: "UTC",
  };
}

export async function createMcpSplitTest(
  context: McpToolContext,
  input: unknown,
) {
  requireMcpScope(context, "cms:split-tests:write");
  const campaign = await splitTestsService.createCampaign(
    context.userId,
    input,
    mcpAuditContext(context, "kastir_split_tests_create"),
  );
  return toMcpSuccess(
    `Split test ${campaign.id} created (${campaign.status}) — not live yet. Call kastir_split_tests_update with status ACTIVE to activate.`,
    {
      ...splitTestMutationData(campaign),
      // A campaign only redirects after ACTIVE; creation must remain explicit.
      activationRequired: true,
    },
  );
}

export async function updateMcpSplitTest(
  context: McpToolContext,
  input: UpdateSplitTestMcpInput,
) {
  requireMcpScope(context, "cms:split-tests:write");
  const { campaignId, ...rest } = input;
  const campaign = await splitTestsService.updateCampaign(
    context.userId,
    campaignId,
    rest,
    mcpAuditContext(context, "kastir_split_tests_update"),
  );
  return toMcpSuccess(
    `Split test ${campaign.id} updated (${campaign.status}).`,
    splitTestMutationData(campaign),
  );
}

export async function createMcpSplitTestDestination(
  context: McpToolContext,
  input: CreateSplitTestDestinationMcpInput,
) {
  requireMcpScope(context, "cms:split-tests:write");
  const { campaignId, ...rest } = input;
  const campaign = await splitTestsService.addDestination(
    context.userId,
    campaignId,
    rest,
    mcpAuditContext(context, "kastir_split_tests_destinations_create"),
  );
  return toMcpSuccess(
    `Destination added to split test ${campaign.id}.`,
    splitTestMutationData(campaign),
  );
}

export async function updateMcpSplitTestDestination(
  context: McpToolContext,
  input: UpdateSplitTestDestinationMcpInput,
) {
  requireMcpScope(context, "cms:split-tests:write");
  const { campaignId, destinationId, ...rest } = input;
  const campaign = await splitTestsService.updateDestination(
    context.userId,
    campaignId,
    destinationId,
    rest,
    mcpAuditContext(context, "kastir_split_tests_destinations_update"),
  );
  return toMcpSuccess(
    `Destination updated on split test ${campaign.id}.`,
    splitTestMutationData(campaign),
  );
}

export async function reorderMcpSplitTestDestinations(
  context: McpToolContext,
  input: ReorderSplitTestDestinationsMcpInput,
) {
  requireMcpScope(context, "cms:split-tests:write");
  const campaign = await splitTestsService.reorderDestinations(
    context.userId,
    input.campaignId,
    input.orderedIds,
    mcpAuditContext(context, "kastir_split_tests_destinations_reorder"),
  );
  return toMcpSuccess(
    `Destinations reordered on split test ${campaign.id}.`,
    splitTestMutationData(campaign),
  );
}

/** Adaptador MCP reversível: pausa a campanha e a envia para a lixeira. */
export async function trashMcpSplitTest(
  context: McpToolContext,
  input: SplitTestDetailInput,
) {
  requireMcpScope(context, "cms:split-tests:write");
  const campaign = await splitTestsService.trashCampaign(
    context.userId,
    input.campaignId,
    mcpAuditContext(context, "kastir_split_tests_trash"),
  );
  return toMcpSuccess(`Split test ${campaign.id} moved to trash.`, {
    id: campaign.id,
    status: campaign.status,
    deletedAt: campaign.deletedAt,
  });
}

export function registerSplitTestTools(
  server: McpServer,
  context: McpToolContext,
): void {
  if (canMcp(context, "splitTests", "read")) {
    server.registerTool(
      "kastir_split_tests_list",
      {
        title: "List Split Tests",
        description: "List A/B campaigns with filters and pagination.",
        inputSchema: splitTestListInputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      (input) =>
        runMcpReadTool(context, () => listMcpSplitTests(context, input)),
    );
    server.registerTool(
      "kastir_split_tests_get",
      {
        title: "Get Split Test",
        description:
          "Get one campaign with destinations, weights, and hit counts.",
        inputSchema: splitTestDetailInputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      (input) => runMcpReadTool(context, () => getMcpSplitTest(context, input)),
    );
    server.registerTool(
      "kastir_split_tests_stats",
      {
        title: "Get Split Test Stats",
        description:
          "Daily hit counts per destination (UTC days, inclusive). Recent hits may lag rollup.",
        inputSchema: splitTestStatsInputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      (input) =>
        runMcpReadTool(context, () => getMcpSplitTestStats(context, input)),
    );
  }

  if (canMcp(context, "splitTests", "write")) {
    server.registerTool(
      "kastir_split_tests_create",
      {
        title: "Create Split Test",
        description:
          "Create a PAUSED A/B campaign; call kastir_split_tests_update with status ACTIVE to activate.",
        inputSchema: createSplitTestMcpInputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      (input) =>
        runMcpScopedTool(context, "cms:split-tests:write", () =>
          createMcpSplitTest(context, input),
        ),
    );
    server.registerTool(
      "kastir_split_tests_update",
      {
        title: "Update Split Test",
        description:
          "Update name/slug/status; optional expectedUpdatedAt guard.",
        inputSchema: updateSplitTestMcpInputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      (input) =>
        runMcpScopedTool(context, "cms:split-tests:write", () =>
          updateMcpSplitTest(context, input),
        ),
    );
    server.registerTool(
      "kastir_split_tests_destinations_create",
      {
        title: "Create Split Test Destination",
        description: "Add a destination to a split test campaign.",
        inputSchema: createSplitTestDestinationMcpInputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      (input) =>
        runMcpScopedTool(context, "cms:split-tests:write", () =>
          createMcpSplitTestDestination(context, input),
        ),
    );
    server.registerTool(
      "kastir_split_tests_destinations_update",
      {
        title: "Update Split Test Destination",
        description:
          "Update destination URL/label/status/order; optional expectedUpdatedAt.",
        inputSchema: updateSplitTestDestinationMcpInputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      (input) =>
        runMcpScopedTool(context, "cms:split-tests:write", () =>
          updateMcpSplitTestDestination(context, input),
        ),
    );
    server.registerTool(
      "kastir_split_tests_destinations_reorder",
      {
        title: "Reorder Split Test Destinations",
        description: "Reorder all destinations of a campaign in one call.",
        inputSchema: reorderSplitTestDestinationsMcpInputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      (input) =>
        runMcpScopedTool(context, "cms:split-tests:write", () =>
          reorderMcpSplitTestDestinations(context, input),
        ),
    );
    server.registerTool(
      "kastir_split_tests_trash",
      {
        title: "Trash Split Test",
        description: "Pause a split test and move it to reversible trash.",
        inputSchema: splitTestDetailInputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      (input) =>
        runMcpScopedTool(context, "cms:split-tests:write", () =>
          trashMcpSplitTest(context, input),
        ),
    );
  }
}
