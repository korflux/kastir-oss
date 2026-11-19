/**
 * Job de retenção de revisões: lê o limite global vigente e apaga só o
 * que está fora da janela, sem live nem fixadas. Settings não dispara
 * corte imediato — só o próximo ciclo aplica o valor novo.
 */
import type { Job } from "bullmq";

import { logEvent } from "@/lib/Logging/logEvent";
import { prisma } from "@/lib/prisma";
import { selectRevisionsToPurge } from "@/lib/Modules/Revisions/snapshot";
import { effectiveRevisionRetentionLimit } from "@/lib/Modules/Settings/revisionRetention";
import { SYSTEM_REVISION_RETENTION_ACTOR_ID } from "@/lib/SideEffects/Types";
import type { PublishingJob } from "@/lib/Publishing/queue";

type RetentionRevision = {
  id: string;
  createdAt: Date;
  pinned: boolean;
};

export type RevisionRetentionDatabase = {
  siteSettings: {
    findUnique(args: {
      where: { id: string };
    }): Promise<{ revisionRetentionLimit: number } | null>;
  };
  page: {
    findMany(args: {
      orderBy: { id: "asc" };
      skip: number;
      take: number;
      select: { id: true; title: true; publishedRevisionId: true };
    }): Promise<
      Array<{
        id: string;
        title: string;
        publishedRevisionId: string | null;
      }>
    >;
  };
  snippet: {
    findMany(args: {
      orderBy: { id: "asc" };
      skip: number;
      take: number;
      select: { id: true; name: true; publishedRevisionId: true };
    }): Promise<
      Array<{
        id: string;
        name: string;
        publishedRevisionId: string | null;
      }>
    >;
  };
  pageRevision: {
    findMany(args: {
      where: { pageId: string };
      select: { id: true; createdAt: true; pinned: true };
    }): Promise<RetentionRevision[]>;
    deleteMany(args: {
      where: { id: { in: string[] } };
    }): Promise<{ count: number }>;
  };
  snippetRevision: {
    findMany(args: {
      where: { snippetId: string };
      select: { id: true; createdAt: true; pinned: true };
    }): Promise<RetentionRevision[]>;
    deleteMany(args: {
      where: { id: { in: string[] } };
    }): Promise<{ count: number }>;
  };
  logEntry: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
};

const REVISION_RETENTION_PAGE_BATCH = 50;

export async function expireRevisionHistory(
  database: RevisionRetentionDatabase = prisma as unknown as RevisionRetentionDatabase,
  options: { batchSize?: number } = {},
): Promise<{ removed: number }> {
  const settings = await database.siteSettings.findUnique({
    where: { id: "singleton" },
  });
  const normalLimit = effectiveRevisionRetentionLimit(
    settings?.revisionRetentionLimit,
  );
  const batchSize = options.batchSize ?? REVISION_RETENTION_PAGE_BATCH;
  let removed = 0;

  for (let skip = 0; ; skip += batchSize) {
    const pages = await database.page.findMany({
      orderBy: { id: "asc" },
      skip,
      take: batchSize,
      select: { id: true, title: true, publishedRevisionId: true },
    });
    if (pages.length === 0) break;
    for (const page of pages) {
      const revisions = await database.pageRevision.findMany({
        where: { pageId: page.id },
        select: { id: true, createdAt: true, pinned: true },
      });
      const ids = selectRevisionsToPurge({
        revisions,
        publishedRevisionId: page.publishedRevisionId,
        normalLimit,
      });
      if (ids.length === 0) continue;
      const deleted = await database.pageRevision.deleteMany({
        where: { id: { in: ids } },
      });
      removed += deleted.count;
      await logEvent(database, {
        userId: SYSTEM_REVISION_RETENTION_ACTOR_ID,
        action: "PAGE_REVISION_PURGED",
        objectType: "PAGE",
        objectLabel: page.title,
        objectId: page.id,
      });
    }
    if (pages.length < batchSize) break;
  }

  for (let skip = 0; ; skip += batchSize) {
    const snippets = await database.snippet.findMany({
      orderBy: { id: "asc" },
      skip,
      take: batchSize,
      select: { id: true, name: true, publishedRevisionId: true },
    });
    if (snippets.length === 0) break;
    for (const snippet of snippets) {
      const revisions = await database.snippetRevision.findMany({
        where: { snippetId: snippet.id },
        select: { id: true, createdAt: true, pinned: true },
      });
      const ids = selectRevisionsToPurge({
        revisions,
        publishedRevisionId: snippet.publishedRevisionId,
        normalLimit,
      });
      if (ids.length === 0) continue;
      const deleted = await database.snippetRevision.deleteMany({
        where: { id: { in: ids } },
      });
      removed += deleted.count;
      await logEvent(database, {
        userId: SYSTEM_REVISION_RETENTION_ACTOR_ID,
        action: "SCRIPT_REVISION_PURGED",
        objectType: "SCRIPT",
        objectLabel: snippet.name,
        objectId: snippet.id,
      });
    }
    if (snippets.length < batchSize) break;
  }

  return { removed };
}

export type ExpireRevisionHistoryJob = Job<
  Extract<PublishingJob, { type: "expire-revision-history" }>
>;

export async function processExpireRevisionHistoryJob(
  job: ExpireRevisionHistoryJob,
): Promise<void> {
  void job;
  await expireRevisionHistory();
}
