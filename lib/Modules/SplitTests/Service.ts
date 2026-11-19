import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { logEvent, type LogEventContext } from "@/lib/Logging/logEvent";
import {
  createCampaignSchema,
  createDestinationSchema,
  parseCampaignSlug,
  updateCampaignSchema,
  updateDestinationSchema,
  assertDestinationUrl,
} from "@/lib/Modules/SplitTests/Schema";
import { normalizeSlug } from "@/lib/Modules/SplitTests/slug";
import {
  SplitTestsDomainError,
  type SplitCampaignDetail,
  type SplitCampaignListItem,
  type SplitCampaignListOptions,
  type SplitCampaignRecord,
  type SplitDestinationListItem,
  type SplitDestinationRecord,
} from "@/lib/Modules/SplitTests/Types";
import { equalWeights } from "@/lib/Modules/SplitTests/weights";
import {
  PAGE_TRASH_EXPIRE_BATCH_SIZE,
  PAGE_TRASH_RETENTION_MS,
} from "@/lib/Modules/Pages/Retention";
import { SYSTEM_PAGE_RETENTION_ACTOR_ID } from "@/lib/SideEffects/Types";

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

const authorSelect = { select: { id: true, name: true } } as const;

type SplitDatabase = {
  splitCampaign: {
    findUnique(args: {
      where: { id?: string; slug?: string };
      include?: unknown;
    }): Promise<SplitCampaignRecord | null>;
    findMany(args?: {
      where?: unknown;
      orderBy?: unknown;
      skip?: number;
      take?: number;
      include?: unknown;
    }): Promise<SplitCampaignRecord[]>;
    count(args?: { where?: unknown }): Promise<number>;
    create(args: {
      data: Record<string, unknown>;
      include?: unknown;
    }): Promise<SplitCampaignRecord>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
      include?: unknown;
    }): Promise<SplitCampaignRecord>;
    delete(args: { where: { id: string } }): Promise<SplitCampaignRecord>;
  };
  splitDestination: {
    findUnique(args: {
      where: { id: string };
    }): Promise<SplitDestinationRecord | null>;
    findMany(args?: {
      where?: unknown;
      orderBy?: unknown;
    }): Promise<SplitDestinationRecord[]>;
    create(args: {
      data: Record<string, unknown>;
    }): Promise<SplitDestinationRecord>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<SplitDestinationRecord>;
    delete(args: { where: { id: string } }): Promise<SplitDestinationRecord>;
    updateMany?(args: {
      where: unknown;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  logEntry: {
    create(args: {
      data: {
        userId: string;
        action: string;
        objectType: "SPLIT_TEST";
        objectLabel: string;
        source?: "PANEL" | "MCP";
        tool?: string;
        resource?: string;
        requestId?: string;
        objectId?: string;
      };
    }): Promise<unknown>;
    findMany?(args: {
      where: {
        action: string;
        objectType: "SPLIT_TEST";
        objectId: { in: string[] };
      };
      orderBy: { createdAt: "desc" };
      select: { objectId: true; userId: true };
    }): Promise<Array<{ objectId: string | null; userId: string }>>;
  };
  user?: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: { id: true; name: true };
    }): Promise<Array<{ id: string; name: string }>>;
  };
  $transaction<T>(callback: (tx: SplitDatabase) => Promise<T>): Promise<T>;
};

function parseOrThrow<T>(
  result: { success: true; data: T } | { success: false },
): T {
  if (!result.success) {
    throw new SplitTestsDomainError(
      "VALIDATION_ERROR",
      "Invalid split test data",
    );
  }
  return result.data;
}

function notFound(message = "Campaign was not found"): SplitTestsDomainError {
  return new SplitTestsDomainError("NOT_FOUND", message);
}

function assertExpectedUpdatedAt(
  expectedUpdatedAt: Date | undefined,
  actualUpdatedAt: Date,
  message: string,
): void {
  if (
    expectedUpdatedAt &&
    expectedUpdatedAt.getTime() !== actualUpdatedAt.getTime()
  ) {
    throw new SplitTestsDomainError("CONFLICT", message);
  }
}

function campaignLabel(
  campaign: Pick<SplitCampaignRecord, "name" | "slug">,
): string {
  return `${campaign.name} (/s/${campaign.slug})`;
}

function withDestinationStats(
  destinations: SplitDestinationRecord[],
): SplitDestinationListItem[] {
  const ordered = [...destinations].sort((a, b) => a.sortOrder - b.sortOrder);
  const active = ordered.filter((d) => d.status === "ACTIVE");
  const weights = equalWeights(active.length);
  const weightById = new Map(active.map((d, i) => [d.id, weights[i] ?? 0]));
  const totalHits = ordered.reduce((sum, d) => sum + d.hitCount, 0);

  return ordered.map((destination) => {
    const theoreticalWeight =
      destination.status === "ACTIVE"
        ? (weightById.get(destination.id) ?? 0)
        : 0;
    const realPercent =
      totalHits > 0 ? (destination.hitCount / totalHits) * 100 : null;
    return {
      ...destination,
      theoreticalWeight,
      realPercent,
    };
  });
}

function toDetail(campaign: SplitCampaignRecord): SplitCampaignDetail {
  const destinations = campaign.destinations ?? [];
  const totalHits = destinations.reduce((sum, d) => sum + d.hitCount, 0);
  return {
    id: campaign.id,
    name: campaign.name,
    slug: campaign.slug,
    status: campaign.status,
    authorId: campaign.authorId,
    author: campaign.author ?? null,
    totalHits,
    destinations: withDestinationStats(destinations),
    deletedAt: campaign.deletedAt ?? null,
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
  };
}

function toListItem(campaign: SplitCampaignRecord): SplitCampaignListItem {
  const destinations = campaign.destinations ?? [];
  return {
    id: campaign.id,
    name: campaign.name,
    slug: campaign.slug,
    status: campaign.status,
    authorId: campaign.authorId,
    author: campaign.author ?? null,
    activeDestinationCount: destinations.filter((d) => d.status === "ACTIVE")
      .length,
    totalHits: destinations.reduce((sum, d) => sum + d.hitCount, 0),
    deletedAt: campaign.deletedAt ?? null,
    deletedBy: campaign.deletedBy ?? null,
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
  };
}

/** Destinos + author (nome real no painel). */
const campaignInclude = {
  destinations: { orderBy: { sortOrder: "asc" as const } },
  author: authorSelect,
};

export class SplitTestsService {
  constructor(
    private readonly database: SplitDatabase = prisma as unknown as SplitDatabase,
  ) {}

  private transaction<T>(
    callback: (tx: SplitDatabase) => Promise<T>,
  ): Promise<T> {
    return this.database.$transaction(callback);
  }

  private async ensureUniqueSlug(
    database: SplitDatabase,
    requested: string,
    currentId?: string,
  ): Promise<string> {
    let slug: string;
    try {
      slug = parseCampaignSlug(requested);
    } catch (error) {
      throw new SplitTestsDomainError(
        "VALIDATION_ERROR",
        error instanceof Error ? error.message : "Invalid campaign slug",
      );
    }

    const existing = await database.splitCampaign.findUnique({
      where: { slug },
    });
    // slug é @unique no banco (sem partial index): ocupante na lixeira ainda
    // reserva o slug até hard delete — restore do original continua possível.
    if (existing && existing.id !== currentId) {
      throw new SplitTestsDomainError(
        "CONFLICT",
        "Campaign slug is already in use",
      );
    }
    return slug;
  }

  /** Mutações de campanha viva — lixeira é read-only até restore. */
  private assertCampaignMutable(
    campaign: SplitCampaignRecord | null,
  ): asserts campaign is SplitCampaignRecord {
    if (!campaign || campaign.deletedAt) throw notFound();
  }

  async listCampaigns(options: SplitCampaignListOptions = {}): Promise<{
    items: SplitCampaignListItem[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 20));
    const where: Record<string, unknown> = {
      deletedAt: options.includeDeleted ? { not: null } : null,
    };
    if (options.status) where.status = options.status;
    if (options.search?.trim()) {
      where.OR = [
        { name: { contains: options.search.trim(), mode: "insensitive" } },
        { slug: { contains: options.search.trim(), mode: "insensitive" } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.database.splitCampaign.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: campaignInclude,
      }),
      this.database.splitCampaign.count({ where }),
    ]);

    const items = rows.map(toListItem);
    return {
      items: options.includeDeleted
        ? await this.attachDeletedByActors(items)
        : items,
      total,
      page,
      pageSize,
    };
  }

  private async attachDeletedByActors(
    items: SplitCampaignListItem[],
  ): Promise<SplitCampaignListItem[]> {
    if (items.length === 0) return items;
    const findMany = this.database.logEntry.findMany;
    if (!findMany) {
      return items.map((item) => ({
        ...item,
        deletedBy: item.deletedBy ?? null,
      }));
    }
    const entries = await findMany({
      where: {
        action: "SPLIT_CAMPAIGN_TRASHED",
        objectType: "SPLIT_TEST",
        objectId: { in: items.map((item) => item.id) },
      },
      orderBy: { createdAt: "desc" },
      select: { objectId: true, userId: true },
    });
    const actorById = new Map<string, string>();
    for (const entry of entries) {
      if (entry.objectId && !actorById.has(entry.objectId)) {
        actorById.set(entry.objectId, entry.userId);
      }
    }
    const userIds = [...new Set(actorById.values())];
    const users =
      userIds.length > 0 && this.database.user?.findMany
        ? await this.database.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true },
          })
        : [];
    const userById = new Map(users.map((user) => [user.id, user]));
    return items.map((item) => {
      const userId = actorById.get(item.id);
      const user = userId ? userById.get(userId) : undefined;
      return {
        ...item,
        deletedBy: user ? { id: user.id, name: user.name } : null,
      };
    });
  }

  async getCampaign(
    id: string,
    options: { includeDeleted?: boolean } = {},
  ): Promise<SplitCampaignDetail> {
    const campaign = await this.database.splitCampaign.findUnique({
      where: { id },
      include: campaignInclude,
    });
    if (!campaign || (campaign.deletedAt && !options.includeDeleted)) {
      throw notFound();
    }
    return toDetail(campaign);
  }

  async createCampaign(
    authorId: string,
    input: unknown,
    audit?: LogEventContext,
  ): Promise<SplitCampaignDetail> {
    const parsed = parseOrThrow(createCampaignSchema.safeParse(input));
    const slugSource = parsed.slug || normalizeSlug(parsed.name);
    const slug = await this.ensureUniqueSlug(this.database, slugSource);

    const destinationsData = parsed.destinations.map((destination, index) => {
      let url: string;
      try {
        url = assertDestinationUrl(destination.url);
      } catch (error) {
        throw new SplitTestsDomainError(
          "VALIDATION_ERROR",
          error instanceof Error ? error.message : "Invalid destination URL",
        );
      }
      return {
        id: randomUUID(),
        url,
        label: destination.label.trim(),
        status: "ACTIVE" as const,
        sortOrder: index,
        hitCount: 0,
      };
    });

    try {
      const created = await this.transaction(async (tx) => {
        // Nova campanha nasce Draft (PAUSED) — /s/slug só responde 307 após publicar.
        const campaign = await tx.splitCampaign.create({
          data: {
            id: randomUUID(),
            name: parsed.name,
            slug,
            status: "PAUSED",
            authorId,
            destinations: {
              create: destinationsData,
            },
          },
          include: campaignInclude,
        });

        await logEvent(tx, {
          userId: authorId,
          action: "SPLIT_CAMPAIGN_CREATED",
          objectType: "SPLIT_TEST",
          objectLabel: campaignLabel(campaign),
          ...audit,
        });

        return campaign;
      });

      return toDetail(created);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new SplitTestsDomainError(
          "CONFLICT",
          "Campaign slug is already in use",
        );
      }
      throw error;
    }
  }

  async updateCampaign(
    userId: string,
    id: string,
    input: unknown,
    audit?: LogEventContext,
  ): Promise<SplitCampaignDetail> {
    const parsed = parseOrThrow(updateCampaignSchema.safeParse(input));
    if (
      parsed.name === undefined &&
      parsed.slug === undefined &&
      parsed.status === undefined
    ) {
      throw new SplitTestsDomainError(
        "VALIDATION_ERROR",
        "No campaign fields to update",
      );
    }

    const existing = await this.database.splitCampaign.findUnique({
      where: { id },
      include: campaignInclude,
    });
    this.assertCampaignMutable(existing);
    assertExpectedUpdatedAt(
      parsed.expectedUpdatedAt,
      existing.updatedAt,
      "Campaign was updated by another request",
    );

    const data: Record<string, unknown> = {};
    if (parsed.name !== undefined) data.name = parsed.name;
    if (parsed.status !== undefined) data.status = parsed.status;
    if (parsed.slug !== undefined) {
      data.slug = await this.ensureUniqueSlug(this.database, parsed.slug, id);
    }

    try {
      const updated = await this.transaction(async (tx) => {
        const campaign = await tx.splitCampaign.update({
          where: { id },
          data,
          include: campaignInclude,
        });
        await logEvent(tx, {
          userId,
          action: "SPLIT_CAMPAIGN_UPDATED",
          objectType: "SPLIT_TEST",
          objectLabel: campaignLabel(campaign),
          ...audit,
        });
        return campaign;
      });

      return toDetail(updated);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new SplitTestsDomainError(
          "CONFLICT",
          "Campaign slug is already in use",
        );
      }
      throw error;
    }
  }

  /** Soft delete → lixeira; despublica (PAUSED) e seta deletedAt. */
  async trashCampaign(
    userId: string,
    id: string,
    audit?: LogEventContext,
  ): Promise<SplitCampaignDetail> {
    const existing = await this.database.splitCampaign.findUnique({
      where: { id },
      include: campaignInclude,
    });
    if (!existing) throw notFound();
    if (existing.deletedAt) {
      throw new SplitTestsDomainError(
        "INVALID_STATE",
        "Campaign is already in the trash",
      );
    }

    const trashed = await this.transaction(async (tx) => {
      const campaign = await tx.splitCampaign.update({
        where: { id },
        data: { status: "PAUSED", deletedAt: new Date() },
        include: campaignInclude,
      });
      await logEvent(tx, {
        userId,
        action: "SPLIT_CAMPAIGN_TRASHED",
        objectType: "SPLIT_TEST",
        objectLabel: campaignLabel(existing),
        objectId: existing.id,
        ...audit,
      });
      return campaign;
    });
    return toDetail(trashed);
  }

  async restoreCampaign(
    userId: string,
    id: string,
    audit?: LogEventContext,
  ): Promise<SplitCampaignDetail> {
    const existing = await this.database.splitCampaign.findUnique({
      where: { id },
      include: campaignInclude,
    });
    if (!existing) throw notFound();
    if (!existing.deletedAt) {
      throw new SplitTestsDomainError(
        "INVALID_STATE",
        "Campaign is not in the trash",
      );
    }

    // Slug não pode colidir com campanha ativa.
    await this.ensureUniqueSlug(this.database, existing.slug, existing.id);

    const restored = await this.transaction(async (tx) => {
      const campaign = await tx.splitCampaign.update({
        where: { id },
        data: { status: "PAUSED", deletedAt: null },
        include: campaignInclude,
      });
      await logEvent(tx, {
        userId,
        action: "SPLIT_CAMPAIGN_RESTORED",
        objectType: "SPLIT_TEST",
        objectLabel: campaignLabel(existing),
        objectId: existing.id,
        ...audit,
      });
      return campaign;
    });
    return toDetail(restored);
  }

  async permanentlyDeleteCampaign(
    userId: string,
    id: string,
    role: "MASTER" | "ADMIN" | "EDITOR",
    audit?: LogEventContext,
  ): Promise<void> {
    if (role === "EDITOR") {
      throw new SplitTestsDomainError(
        "FORBIDDEN",
        "Editor cannot permanently delete campaigns",
      );
    }
    const existing = await this.database.splitCampaign.findUnique({
      where: { id },
    });
    if (!existing) throw notFound();
    if (!existing.deletedAt) {
      throw new SplitTestsDomainError(
        "INVALID_STATE",
        "Campaign must be in the trash first",
      );
    }

    await this.transaction(async (tx) => {
      await tx.splitCampaign.delete({ where: { id } });
      await logEvent(tx, {
        userId,
        action: "SPLIT_CAMPAIGN_PERMANENTLY_DELETED",
        objectType: "SPLIT_TEST",
        objectLabel: campaignLabel(existing),
        objectId: existing.id,
        ...audit,
      });
    });
  }

  async addDestination(
    userId: string,
    campaignId: string,
    input: unknown,
    audit?: LogEventContext,
  ): Promise<SplitCampaignDetail> {
    const parsed = parseOrThrow(createDestinationSchema.safeParse(input));
    const campaign = await this.database.splitCampaign.findUnique({
      where: { id: campaignId },
      include: campaignInclude,
    });
    this.assertCampaignMutable(campaign);

    let url: string;
    try {
      url = assertDestinationUrl(parsed.url);
    } catch (error) {
      throw new SplitTestsDomainError(
        "VALIDATION_ERROR",
        error instanceof Error ? error.message : "Invalid destination URL",
      );
    }

    const maxOrder = (campaign.destinations ?? []).reduce(
      (max, d) => Math.max(max, d.sortOrder),
      -1,
    );

    await this.transaction(async (tx) => {
      await tx.splitDestination.create({
        data: {
          id: randomUUID(),
          campaignId,
          url,
          label: parsed.label.trim(),
          status: "ACTIVE",
          sortOrder: maxOrder + 1,
          hitCount: 0,
        },
      });
      await logEvent(tx, {
        userId,
        action: "SPLIT_DESTINATION_CREATED",
        objectType: "SPLIT_TEST",
        objectLabel: campaignLabel(campaign),
        ...audit,
      });
    });

    return this.getCampaign(campaignId);
  }

  async updateDestination(
    userId: string,
    campaignId: string,
    destinationId: string,
    input: unknown,
    audit?: LogEventContext,
  ): Promise<SplitCampaignDetail> {
    const parsed = parseOrThrow(updateDestinationSchema.safeParse(input));
    const campaign = await this.database.splitCampaign.findUnique({
      where: { id: campaignId },
      include: campaignInclude,
    });
    this.assertCampaignMutable(campaign);

    const destination = (campaign.destinations ?? []).find(
      (d) => d.id === destinationId,
    );
    if (!destination) {
      throw new SplitTestsDomainError("NOT_FOUND", "Destination was not found");
    }
    assertExpectedUpdatedAt(
      parsed.expectedUpdatedAt,
      destination.updatedAt,
      "Destination was updated by another request",
    );

    if (parsed.status === "PAUSED" && destination.status === "ACTIVE") {
      const activeCount = (campaign.destinations ?? []).filter(
        (d) => d.status === "ACTIVE",
      ).length;
      if (activeCount <= 1) {
        throw new SplitTestsDomainError(
          "VALIDATION_ERROR",
          "Cannot pause the last active destination",
        );
      }
    }

    const data: Record<string, unknown> = {};
    if (parsed.url !== undefined) {
      try {
        data.url = assertDestinationUrl(parsed.url);
      } catch (error) {
        throw new SplitTestsDomainError(
          "VALIDATION_ERROR",
          error instanceof Error ? error.message : "Invalid destination URL",
        );
      }
    }
    if (parsed.label !== undefined) {
      data.label = parsed.label.trim();
    }
    if (parsed.status !== undefined) data.status = parsed.status;
    if (parsed.sortOrder !== undefined) data.sortOrder = parsed.sortOrder;

    if (Object.keys(data).length === 0) {
      throw new SplitTestsDomainError(
        "VALIDATION_ERROR",
        "No destination fields to update",
      );
    }

    await this.transaction(async (tx) => {
      await tx.splitDestination.update({ where: { id: destinationId }, data });
      await logEvent(tx, {
        userId,
        action: "SPLIT_DESTINATION_UPDATED",
        objectType: "SPLIT_TEST",
        objectLabel: campaignLabel(campaign),
        ...audit,
      });
    });

    return this.getCampaign(campaignId);
  }

  async deleteDestination(
    userId: string,
    campaignId: string,
    destinationId: string,
    audit?: LogEventContext,
  ): Promise<SplitCampaignDetail> {
    const campaign = await this.database.splitCampaign.findUnique({
      where: { id: campaignId },
      include: campaignInclude,
    });
    this.assertCampaignMutable(campaign);

    const destinations = campaign.destinations ?? [];
    const destination = destinations.find((d) => d.id === destinationId);
    if (!destination) {
      throw new SplitTestsDomainError("NOT_FOUND", "Destination was not found");
    }

    if (destinations.length <= 1) {
      throw new SplitTestsDomainError(
        "VALIDATION_ERROR",
        "Campaign must keep at least one destination",
      );
    }

    await this.transaction(async (tx) => {
      await tx.splitDestination.delete({ where: { id: destinationId } });
      await logEvent(tx, {
        userId,
        action: "SPLIT_DESTINATION_DELETED",
        objectType: "SPLIT_TEST",
        objectLabel: campaignLabel(campaign),
        ...audit,
      });
    });

    return this.getCampaign(campaignId);
  }

  async reorderDestinations(
    userId: string,
    campaignId: string,
    orderedIds: string[],
    audit?: LogEventContext,
  ): Promise<SplitCampaignDetail> {
    const campaign = await this.database.splitCampaign.findUnique({
      where: { id: campaignId },
      include: campaignInclude,
    });
    this.assertCampaignMutable(campaign);

    const destinations = campaign.destinations ?? [];
    const currentIds = new Set(destinations.map((d) => d.id));
    if (
      orderedIds.length !== destinations.length ||
      orderedIds.some((id) => !currentIds.has(id))
    ) {
      throw new SplitTestsDomainError(
        "VALIDATION_ERROR",
        "orderedIds must include every destination exactly once",
      );
    }

    await this.transaction(async (tx) => {
      for (let index = 0; index < orderedIds.length; index += 1) {
        await tx.splitDestination.update({
          where: { id: orderedIds[index] },
          data: { sortOrder: index },
        });
      }
      await logEvent(tx, {
        userId,
        action: "SPLIT_DESTINATION_UPDATED",
        objectType: "SPLIT_TEST",
        objectLabel: campaignLabel(campaign),
        ...audit,
      });
    });

    return this.getCampaign(campaignId);
  }

  /** Overview da Home: total de campanhas + PAUSED ("inactive") — ignora lixeira. */
  async countOverview(): Promise<SplitTestsOverview> {
    const [total, inactiveCount] = await Promise.all([
      this.database.splitCampaign.count({ where: { deletedAt: null } }),
      this.database.splitCampaign.count({
        where: { status: "PAUSED", deletedAt: null },
      }),
    ]);
    return { total, inactiveCount };
  }

  /**
   * Hard-delete campanhas na lixeira além da retenção (paridade Pages).
   * Roda no mesmo scheduler diário de expire-trashed-pages.
   */
  async expireTrashedCampaigns(
    now = new Date(),
    options: { batchSize?: number; retentionMs?: number } = {},
  ): Promise<number> {
    const retentionMs = options.retentionMs ?? PAGE_TRASH_RETENTION_MS;
    const cutoff = new Date(now.getTime() - retentionMs);
    const batchSize = options.batchSize ?? PAGE_TRASH_EXPIRE_BATCH_SIZE;
    let deleted = 0;
    let failures = 0;
    const seen = new Set<string>();

    for (;;) {
      const candidates = await this.database.splitCampaign.findMany({
        where: { deletedAt: { lt: cutoff } },
        orderBy: { createdAt: "asc" },
        take: batchSize,
      });
      const fresh = candidates.filter((row) => !seen.has(row.id));
      if (fresh.length === 0) break;

      for (const row of fresh) {
        seen.add(row.id);
        try {
          if (!row.deletedAt || row.deletedAt >= cutoff) continue;
          await this.transaction(async (tx) => {
            await tx.splitCampaign.delete({ where: { id: row.id } });
            await logEvent(tx, {
              userId: SYSTEM_PAGE_RETENTION_ACTOR_ID,
              action: "SPLIT_CAMPAIGN_PERMANENTLY_DELETED",
              objectType: "SPLIT_TEST",
              objectLabel: campaignLabel(row),
              objectId: row.id,
            });
          });
          deleted += 1;
        } catch (error) {
          failures += 1;
          console.error(
            "[Kastir] Failed to expire trashed split campaign",
            { campaignId: row.id },
            error instanceof Error ? error.message : "unknown error",
          );
        }
      }
    }
    if (failures > 0) {
      throw new Error(
        `Trash expiration completed with ${failures} failure(s); deleted ${deleted}`,
      );
    }
    return deleted;
  }
}

export type SplitTestsOverview = {
  total: number;
  inactiveCount: number;
};

export const splitTestsService = new SplitTestsService();
