import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { PublishedSiteReconcileResult } from "../lib/Publishing/reconcile";

type BootstrapRuntimeDependencies = {
  bootstrapMaster: () => Promise<void>;
  reconcilePublishedSite: () => Promise<PublishedSiteReconcileResult>;
  reconcileMedia: () => Promise<{ checked: number; missing: number }>;
  reconcileStuckMedia: () => Promise<{ checked: number; failed: number }>;
  checkRedisMaxmemoryPolicy: () => Promise<{ policy: string | null }>;
  disconnect: () => Promise<void>;
};

async function defaultReconcileMedia(): Promise<{
  checked: number;
  missing: number;
}> {
  const { mediaService } = await import("../lib/Modules/Media/Service");
  const media = await mediaService.listMedia({ processingStatus: "READY" });
  const missing = media.filter(
    (item) => item.processingStatus !== "READY",
  ).length;
  return { checked: media.length, missing };
}

async function defaultReconcileStuckMedia(): Promise<{
  checked: number;
  failed: number;
}> {
  const { reconcileStuckMediaProcessing } =
    await import("../lib/Modules/Media/Service");
  return reconcileStuckMediaProcessing();
}

/** ioredis returns CONFIG GET as a flat [key, value] pair, not an object. */
export function parseConfigGetValue(result: unknown): string | null {
  return Array.isArray(result) && typeof result[1] === "string"
    ? result[1]
    : null;
}

async function defaultCheckRedisMaxmemoryPolicy(): Promise<{
  policy: string | null;
}> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl || !/^rediss?:\/\//.test(redisUrl)) {
    throw new Error("REDIS_URL must use redis:// or rediss://");
  }

  // Short-lived client only — getPublishingQueue() leaves a shared ioredis
  // connection open and the one-shot entrypoint never exits (container loop).
  const { default: IORedis } = await import("ioredis");
  const client = new IORedis(redisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 5_000,
    lazyConnect: true,
  });
  client.on("error", () => undefined);

  try {
    await client.connect();
    const result = await client.config("GET", "maxmemory-policy");
    return { policy: parseConfigGetValue(result) };
  } finally {
    client.disconnect();
  }
}

export async function runBootstrap(
  dependencies?: BootstrapRuntimeDependencies,
): Promise<void> {
  const resolvedDependencies =
    dependencies ??
    ({
      bootstrapMaster: (await import("../lib/Modules/Auth/Bootstrap"))
        .bootstrapMaster,
      reconcilePublishedSite: (await import("../lib/Publishing/reconcile"))
        .reconcilePublishedSite,
      reconcileMedia: defaultReconcileMedia,
      reconcileStuckMedia: defaultReconcileStuckMedia,
      checkRedisMaxmemoryPolicy: defaultCheckRedisMaxmemoryPolicy,
      disconnect: async () => {
        const { prisma } = await import("../lib/prisma");
        await prisma.$disconnect();
      },
    } satisfies BootstrapRuntimeDependencies);

  try {
    await resolvedDependencies.bootstrapMaster();

    // Neither check is allowed to block boot — a failed reconciliation pass
    // just leaves the same broken links it was trying to detect, not a new
    // failure mode, so it is logged and swallowed rather than re-thrown.
    try {
      const pages = await resolvedDependencies.reconcilePublishedSite();
      if (pages.rebuilt) {
        console.warn(
          `[Kastir] ${pages.missing}/${pages.checked} published pages had no static output on disk (the public/ volume may not be persisted across deploys) — rebuilt the published site.`,
        );
      }
    } catch (error) {
      console.error(
        "[Kastir] Published site reconciliation failed",
        error instanceof Error ? error.message : "unknown error",
      );
    }

    try {
      const media = await resolvedDependencies.reconcileMedia();
      if (media.missing > 0) {
        console.warn(
          `[Kastir] ${media.missing}/${media.checked} media files marked READY have no bytes on disk (the public/ volume may not be persisted across deploys) — marked FAILED. Re-upload is required; original bytes cannot be recovered from the database.`,
        );
      }
    } catch (error) {
      console.error(
        "[Kastir] Media reconciliation failed",
        error instanceof Error ? error.message : "unknown error",
      );
    }

    try {
      const stuck = await resolvedDependencies.reconcileStuckMedia();
      if (stuck.failed > 0) {
        console.warn(
          `[Kastir] ${stuck.failed}/${stuck.checked} media files were stuck in PROCESSING for too long — marked FAILED. Re-upload is required.`,
        );
      }
    } catch (error) {
      console.error(
        "[Kastir] Stuck media reconciliation failed",
        error instanceof Error ? error.message : "unknown error",
      );
    }

    // Passive check only — never corrects the Redis config itself, just warns
    // the operator: BullMQ needs `maxmemory-policy noeviction` (see README requirements).
    try {
      const redis = await resolvedDependencies.checkRedisMaxmemoryPolicy();
      if (redis.policy !== "noeviction") {
        console.warn(
          `[Kastir] Redis maxmemory-policy is "${redis.policy}", not "noeviction". ` +
            "BullMQ requires noeviction — under memory pressure, Redis may evict " +
            "queued/in-flight jobs, leaving media stuck in PROCESSING forever. " +
            "Set: redis-cli CONFIG SET maxmemory-policy noeviction",
        );
      }
    } catch (error) {
      console.error(
        "[Kastir] Redis maxmemory-policy check failed",
        error instanceof Error ? error.message : "unknown error",
      );
    }
  } finally {
    await resolvedDependencies.disconnect();
  }
}

const isMainModule =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMainModule) {
  // Always exit: any leftover handle (pg pool, timers) would hang the
  // docker-entrypoint before nginx/server.js and restart-loop the container.
  runBootstrap()
    .then(() => {
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error(
        "[Kastir] Bootstrap failed",
        error instanceof Error ? error.message : "unknown error",
      );
      process.exit(1);
    });
}
