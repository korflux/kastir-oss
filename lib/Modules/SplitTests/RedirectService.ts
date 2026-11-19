import { prisma } from "@/lib/prisma";
import { COLD_START_THRESHOLD } from "@/lib/Modules/SplitTests/constants";
import {
  createMemorySplitCounters,
  getSplitCounters,
  type SplitCountersStore,
} from "@/lib/Modules/SplitTests/counters";
import { mergeDestinationUrl } from "@/lib/Modules/SplitTests/mergeDestinationUrl";
import { selectDestination } from "@/lib/Modules/SplitTests/selectDestination";
import { equalWeights } from "@/lib/Modules/SplitTests/weights";
import { getPublicOrigin } from "@/lib/Modules/Settings/publicOrigin";
import {
  isTelemetryWriteAllowed,
  type TelemetryWriteGate,
} from "@/lib/Modules/SplitTests/telemetryRateLimit";

type RedirectDatabase = {
  splitCampaign: {
    findUnique(args: {
      where: { slug: string };
      include: {
        destinations: {
          where: { status: "ACTIVE" };
          orderBy: { sortOrder: "asc" };
        };
      };
    }): Promise<{
      id: string;
      slug: string;
      status: "ACTIVE" | "PAUSED";
      deletedAt: Date | null;
      destinations: Array<{
        id: string;
        url: string;
        sortOrder: number;
        hitCount: number;
        status: "ACTIVE" | "PAUSED";
      }>;
    } | null>;
  };
  splitDestination: {
    update(args: {
      where: { id: string };
      data: { hitCount: { increment: number } };
    }): Promise<unknown>;
  };
  splitRedirectEvent: {
    create(args: {
      data: {
        campaignId: string;
        destinationId: string;
      };
    }): Promise<unknown>;
  };
  siteSettings?: {
    findUnique(args: { where: { id: string } }): Promise<{
      siteUrl: string | null;
    } | null>;
  };
};

export type RedirectResult =
  | {
      status: 307;
      location: string;
      campaignId: string;
      destinationId: string;
      /**
       * True when Redis was healthy for selection — await Redis INCR on recordHit.
       * False when Redis was down: skip all counters (Redis + Postgres) for this hit.
       */
      recordCounters: boolean;
    }
  | { status: 404 };

export class RedirectService {
  constructor(
    private readonly database: RedirectDatabase = prisma as unknown as RedirectDatabase,
    private readonly counters: SplitCountersStore = getSplitCounters(),
    private readonly isTelemetryAllowed: TelemetryWriteGate = isTelemetryWriteAllowed,
  ) {}

  async resolve(
    slug: string,
    requestSearch: URLSearchParams,
    options?: { siteOrigin?: string; random?: () => number },
  ): Promise<RedirectResult> {
    const campaign = await this.database.splitCampaign.findUnique({
      where: { slug },
      include: {
        destinations: {
          where: { status: "ACTIVE" },
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    if (
      !campaign ||
      campaign.deletedAt ||
      campaign.status !== "ACTIVE" ||
      campaign.destinations.length === 0
    ) {
      return { status: 404 };
    }

    const active = campaign.destinations;
    const weights = equalWeights(active.length);

    let hitsMap: Map<string, number>;
    let redisOk = true;
    try {
      await this.counters.hydrate(
        campaign.id,
        active.map((d) => ({ destinationId: d.id, hitCount: d.hitCount })),
      );
      hitsMap = await this.counters.getHits(
        campaign.id,
        active.map((d) => d.id),
      );
      const redisTotal = [...hitsMap.values()].reduce((a, b) => a + b, 0);
      if (redisTotal === 0) {
        hitsMap = new Map(active.map((d) => [d.id, d.hitCount]));
      }
    } catch (error) {
      redisOk = false;
      console.error(
        "[Kastir] Split counters unavailable",
        error instanceof Error ? error.message : error,
      );
      hitsMap = new Map(active.map((d) => [d.id, d.hitCount]));
    }

    const totalHits = [...hitsMap.values()].reduce((a, b) => a + b, 0);

    let destinationId: string;
    if (active.length === 1) {
      destinationId = active[0].id;
    } else if (!redisOk) {
      // Redis down → cold-start weighted; no counter updates for this hit.
      destinationId = selectDestination({
        destinations: active.map((d, i) => ({
          id: d.id,
          weight: weights[i] ?? 0,
          hits: 0,
          sortOrder: d.sortOrder,
        })),
        totalHits: 0,
        threshold: COLD_START_THRESHOLD,
        random: options?.random,
      });
    } else {
      destinationId = selectDestination({
        destinations: active.map((d, i) => ({
          id: d.id,
          weight: weights[i] ?? 0,
          hits: hitsMap.get(d.id) ?? 0,
          sortOrder: d.sortOrder,
        })),
        totalHits,
        threshold: COLD_START_THRESHOLD,
        random: options?.random,
      });
    }

    const destination = active.find((d) => d.id === destinationId) ?? active[0];

    let siteOrigin: string;
    try {
      siteOrigin = options?.siteOrigin ?? (await this.resolveSiteOrigin());
    } catch (error) {
      console.error(
        "[Kastir] Split public origin unavailable",
        error instanceof Error ? error.message : error,
      );
      return { status: 404 };
    }

    // External absolute destinations are intentional (admin-configured open redirect).
    let location: string;
    try {
      location = mergeDestinationUrl(
        destination.url,
        requestSearch,
        siteOrigin,
      );
    } catch (error) {
      console.error(
        "[Kastir] Split destination URL invalid",
        error instanceof Error ? error.message : error,
      );
      return { status: 404 };
    }

    return {
      status: 307,
      location,
      campaignId: campaign.id,
      destinationId: destination.id,
      recordCounters: redisOk,
    };
  }

  /**
   * Hot path telemetry (chosen strategy):
   * - await Redis INCR when recordCounters (feeds the balancer)
   * - await durable Postgres event + hitCount inside Next's after() lifecycle
   * - when Redis was down (recordCounters=false): skip all counters
   *
   * Does not throw to the caller.
   */
  async recordHit(
    campaignId: string,
    destinationId: string,
    recordCounters: boolean,
    clientIp: string | null = null,
  ): Promise<void> {
    if (!recordCounters) {
      return;
    }

    try {
      await this.counters.increment(campaignId, destinationId);
    } catch (error) {
      console.error(
        "[Kastir] Split counter increment failed",
        error instanceof Error ? error.message : error,
      );
      // Still attempt durable write so UI eventually reflects the hit.
    }

    // This is awaited by the Next `after()` callback, so process shutdown
    // cannot silently drop the durable event after the Redis counter finishes.
    await this.recordDurableHitIfAllowed(campaignId, destinationId, clientIp);
  }

  private async recordDurableHitIfAllowed(
    campaignId: string,
    destinationId: string,
    clientIp: string | null,
  ): Promise<void> {
    const allowed = await this.isTelemetryAllowed(clientIp, campaignId).catch(
      () => true,
    );
    if (!allowed) {
      return;
    }

    await this.persistDurableHit(campaignId, destinationId);
  }

  private async persistDurableHit(
    campaignId: string,
    destinationId: string,
  ): Promise<void> {
    await this.database.splitRedirectEvent.create({
      data: { campaignId, destinationId },
    });
    await this.database.splitDestination.update({
      where: { id: destinationId },
      data: { hitCount: { increment: 1 } },
    });
  }

  private async resolveSiteOrigin(): Promise<string> {
    const settings = this.database.siteSettings
      ? await this.database.siteSettings.findUnique({
          where: { id: "singleton" },
        })
      : null;
    return getPublicOrigin({ siteUrl: settings?.siteUrl });
  }
}

export const redirectService = new RedirectService();

export function createTestRedirectService(
  database: RedirectDatabase,
  counters: SplitCountersStore = createMemorySplitCounters(),
  isTelemetryAllowed: TelemetryWriteGate = async () => true,
): RedirectService {
  return new RedirectService(database, counters, isTelemetryAllowed);
}
