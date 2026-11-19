import type { Job } from "bullmq";

import {
  customCodeService,
  type CustomCodeService,
} from "@/lib/Modules/CustomCode/Service";
import { pageService, type PageService } from "@/lib/Modules/Pages/Service";
import { PAGE_TRASH_RETENTION_MS } from "@/lib/Modules/Pages/Retention";
import {
  splitTestsService,
  type SplitTestsService,
} from "@/lib/Modules/SplitTests/Service";
import type { PublishingJob } from "@/lib/Publishing/queue";

export type ExpireTrashedPagesJob = Job<
  Extract<PublishingJob, { type: "expire-trashed-pages" }>
>;

export async function expireTrashedPages(
  now = new Date(),
  service: Pick<PageService, "expireTrashedPages"> = pageService,
): Promise<number> {
  return service.expireTrashedPages(now);
}

/** Job diário: lixeira de Pages + Scripts + Split Tests (mesma retenção). */
export async function processExpireTrashedPagesJob(
  job: ExpireTrashedPagesJob,
  services: {
    pages?: Pick<PageService, "expireTrashedPages">;
    scripts?: Pick<CustomCodeService, "expireTrashedSnippets">;
    splitTests?: Pick<SplitTestsService, "expireTrashedCampaigns">;
  } = {},
): Promise<void> {
  void job;
  const pages = services.pages ?? pageService;
  const scripts = services.scripts ?? customCodeService;
  const splitTests = services.splitTests ?? splitTestsService;
  await pages.expireTrashedPages();
  await scripts.expireTrashedSnippets();
  await splitTests.expireTrashedCampaigns();
}

export function trashCutoff(now: Date): Date {
  return new Date(now.getTime() - PAGE_TRASH_RETENTION_MS);
}
