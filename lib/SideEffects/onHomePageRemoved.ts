import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/Logging/logEvent";
import { notify } from "@/lib/Modules/Notifications/Service";
import { rebuildSettings } from "@/lib/Publishing/settingsRebuild";
import {
  getPublishingQueue,
  type PublishingQueue,
} from "@/lib/Publishing/queue";
import { getAutomaticNotificationRecipientIds } from "@/lib/SideEffects/Recipients";
import { buildHomePageRemovedMessage } from "@/lib/SideEffects/automaticNotifications";
import type {
  AutomaticNotificationDatabase,
  AutomaticNotificationEmitter,
  PageRemovalContext,
} from "@/lib/SideEffects/Types";

export type HomeSideEffectsDatabase = AutomaticNotificationDatabase & {
  siteSettings: {
    updateMany(args: {
      where: { id: string; homePageId: string };
      data: { homePageId: null };
    }): Promise<{ count: number }>;
  };
  logEntry?: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
};

export type HomeSideEffectsQueue = Pick<PublishingQueue, "add">;

export type HomeSideEffectsRebuild = (
  scope: "ARTIFACTS",
  pageIds: readonly string[],
) => Promise<void>;

export type HomeSideEffectsDependencies = {
  database?: HomeSideEffectsDatabase;
  queue?: HomeSideEffectsQueue;
  getRecipients?: (
    database: AutomaticNotificationDatabase,
  ) => Promise<string[]>;
  notify?: AutomaticNotificationEmitter;
  rebuild?: HomeSideEffectsRebuild;
  language?: string;
};

async function emitBestEffort(
  emit: AutomaticNotificationEmitter,
  userId: string,
  message: string,
  link: string,
  meta: { pageId: string },
): Promise<void> {
  try {
    await emit(userId, message, link);
  } catch (error) {
    console.error(
      "[Kastir] Automatic home-removal notification failed",
      { pageId: meta.pageId, userId },
      error instanceof Error ? error.message : "unknown error",
    );
  }
}

export async function onHomePageRemoved(
  context: PageRemovalContext,
  dependencies: HomeSideEffectsDependencies = {},
): Promise<boolean> {
  if (!context.isHome) return false;

  const database =
    dependencies.database ?? (prisma as unknown as HomeSideEffectsDatabase);
  const siteSettings = database.siteSettings;
  if (!siteSettings) {
    throw new Error("Home side effects require a siteSettings database");
  }

  const transition = await siteSettings.updateMany({
    where: { id: "singleton", homePageId: context.pageId },
    data: { homePageId: null },
  });
  if (transition.count !== 1) return false;

  if (database.logEntry) {
    await logEvent(
      { logEntry: database.logEntry },
      {
        userId: context.actorId,
        action: "HOME_POINTER_RESET",
        objectType: "SETTINGS",
        objectLabel: context.title || context.slug,
        objectId: context.pageId,
      },
    );
  }

  // Durable artifacts first — return value means rebuild completed, not notify.
  const rebuild =
    dependencies.rebuild ??
    ((scope, pageIds) => rebuildSettings(scope, [...pageIds]));
  await rebuild("ARTIFACTS", []);

  const operationId = randomUUID();
  try {
    const queue = dependencies.queue ?? getPublishingQueue();
    await queue.add(
      `settings-rebuild-${operationId}`,
      {
        type: "settings-rebuild",
        operationId,
        scope: "ARTIFACTS",
        pageIds: [],
      },
      {
        jobId: `settings-rebuild-${operationId}`,
        attempts: 3,
        backoff: { type: "exponential", delay: 60_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  } catch (error) {
    console.error(
      "[Kastir] Unable to enqueue home page artifact rebuild",
      error instanceof Error ? error.message : "unknown error",
    );
  }

  const getRecipients =
    dependencies.getRecipients ?? getAutomaticNotificationRecipientIds;
  const recipientIds = await getRecipients(database);
  const emit = dependencies.notify ?? notify;
  const notification = buildHomePageRemovedMessage(
    dependencies.language ?? process.env.PANEL_LANGUAGE,
    context.title || context.slug,
  );
  for (const recipientId of recipientIds) {
    await emitBestEffort(
      emit,
      recipientId,
      notification.message,
      notification.link,
      {
        pageId: context.pageId,
      },
    );
  }

  return true;
}
