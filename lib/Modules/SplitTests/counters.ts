import IORedis from "ioredis";

import { env } from "@/lib/env";

const KEY_PREFIX = "kastir:split:hits:";

export type SplitCountersStore = {
  getHits(
    campaignId: string,
    destinationIds: string[],
  ): Promise<Map<string, number>>;
  increment(campaignId: string, destinationId: string): Promise<void>;
  hydrate(
    campaignId: string,
    hits: ReadonlyArray<{ destinationId: string; hitCount: number }>,
  ): Promise<void>;
};

function hitsKey(campaignId: string): string {
  return `${KEY_PREFIX}${campaignId}`;
}

export function createRedisSplitCounters(
  redisUrl: string = env.REDIS_URL,
): SplitCountersStore {
  const redis = new IORedis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  redis.on("error", () => undefined);

  async function ensureConnected(): Promise<void> {
    if (redis.status === "wait") {
      await redis.connect();
    }
  }

  return {
    async getHits(campaignId, destinationIds) {
      await ensureConnected();
      if (destinationIds.length === 0) return new Map();
      const values = await redis.hmget(hitsKey(campaignId), ...destinationIds);
      const map = new Map<string, number>();
      destinationIds.forEach((id, index) => {
        const raw = values[index];
        map.set(id, raw ? Number(raw) || 0 : 0);
      });
      return map;
    },

    async increment(campaignId, destinationId) {
      await ensureConnected();
      await redis.hincrby(hitsKey(campaignId), destinationId, 1);
    },

    /**
     * Seed missing hash fields only (HSETNX per field) so concurrent hydrates
     * cannot overwrite live counters with a stale snapshot.
     */
    async hydrate(campaignId, hits) {
      await ensureConnected();
      if (hits.length === 0) return;
      const key = hitsKey(campaignId);
      const pipeline = redis.pipeline();
      for (const row of hits) {
        pipeline.hsetnx(key, row.destinationId, String(row.hitCount));
      }
      await pipeline.exec();
    },
  };
}

let shared: SplitCountersStore | undefined;

export function getSplitCounters(): SplitCountersStore {
  shared ??= createRedisSplitCounters();
  return shared;
}

/** In-memory store for unit tests. */
export function createMemorySplitCounters(
  initial: Record<string, Record<string, number>> = {},
): SplitCountersStore {
  const data = new Map<string, Map<string, number>>();
  for (const [campaignId, hits] of Object.entries(initial)) {
    data.set(campaignId, new Map(Object.entries(hits)));
  }

  return {
    async getHits(campaignId, destinationIds) {
      const map = data.get(campaignId) ?? new Map();
      const result = new Map<string, number>();
      for (const id of destinationIds) {
        result.set(id, map.get(id) ?? 0);
      }
      return result;
    },
    async increment(campaignId, destinationId) {
      let map = data.get(campaignId);
      if (!map) {
        map = new Map();
        data.set(campaignId, map);
      }
      map.set(destinationId, (map.get(destinationId) ?? 0) + 1);
    },
    async hydrate(campaignId, hits) {
      let map = data.get(campaignId);
      if (!map) {
        map = new Map();
        data.set(campaignId, map);
      }
      for (const row of hits) {
        if (!map.has(row.destinationId)) {
          map.set(row.destinationId, row.hitCount);
        }
      }
    },
  };
}
