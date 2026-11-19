import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/Logging/logEvent";
import { notify } from "@/lib/Modules/Notifications/Service";
import { getAutomaticNotificationRecipientIds } from "@/lib/SideEffects/Recipients";
import {
  buildSnippetDisabledMessage,
  buildSnippetOrphanedMessage,
} from "@/lib/SideEffects/automaticNotifications";
import type {
  AutomaticNotificationDatabase,
  AutomaticNotificationEmitter,
  PageRemovalContext,
} from "@/lib/SideEffects/Types";

type SnippetCandidate = { id: string; name: string };

const ORPHAN_RECONCILE_BATCH = 50;

export type PageScopeSideEffectsDatabase = AutomaticNotificationDatabase & {
  snippet: {
    findMany(args: {
      where: unknown;
      select: { id: true; name: true };
      take?: number;
    }): Promise<SnippetCandidate[]>;
    updateMany(args: {
      where: unknown;
      data: { status: "DRAFT" };
    }): Promise<{ count: number }>;
  };
  logEntry?: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
};

export type PageScopeSideEffectsDependencies = {
  database?: PageScopeSideEffectsDatabase;
  getRecipients?: (
    database: AutomaticNotificationDatabase,
  ) => Promise<string[]>;
  notify?: AutomaticNotificationEmitter;
  language?: string;
  batchSize?: number;
};

const orphanScopeWhere = {
  scopeType: "SPECIFIC_PAGES",
  status: "PUBLISHED",
  scopedPages: { none: {} },
};

async function emitBestEffort(
  emit: AutomaticNotificationEmitter,
  userId: string,
  message: string,
  link: string,
  meta: { snippetId: string },
): Promise<void> {
  try {
    await emit(userId, message, link);
  } catch (error) {
    console.error(
      "[Kastir] Automatic side-effect notification failed",
      { snippetId: meta.snippetId, userId },
      error instanceof Error ? error.message : "unknown error",
    );
  }
}

export async function onPageRemovedFromScope(
  context: PageRemovalContext,
  dependencies: PageScopeSideEffectsDependencies = {},
): Promise<void> {
  const database =
    dependencies.database ??
    (prisma as unknown as PageScopeSideEffectsDatabase);
  const snippet = database.snippet;
  if (!snippet) {
    throw new Error("Page scope side effects require a snippet database");
  }

  const getRecipients =
    dependencies.getRecipients ?? getAutomaticNotificationRecipientIds;
  // Lookup preguiçoso e memoizado: a consulta de usuários só acontece quando há
  // ao menos um órfão a processar, e uma única vez. Fazê-lo eager (antes de
  // saber se há trabalho) custa uma query a cada remoção de página e, como o
  // chamador relança falhas de listener após o commit, uma falha nessa consulta
  // quebraria remoções que nada têm a notificar. Resolver antes da primeira
  // transição para DRAFT evita desabilitar o snippet e perder a notificação se
  // o lookup falhar (o snippet sairia do filtro de órfãos da reconciliação).
  let recipientIds: string[] | undefined;
  const emit = dependencies.notify ?? notify;
  const language = dependencies.language ?? process.env.PANEL_LANGUAGE;
  const batchSize = dependencies.batchSize ?? ORPHAN_RECONCILE_BATCH;
  const candidateIds = new Set(context.snippetIds);

  const disableOrphans = async (rows: SnippetCandidate[]) => {
    // Guard: sem órfãos não há transição nem notificação, logo nenhum lookup.
    if (rows.length === 0) return;
    const recipients = (recipientIds ??= await getRecipients(database));
    for (const row of rows) {
      const transition = await snippet.updateMany({
        where: { id: row.id, ...orphanScopeWhere },
        data: { status: "DRAFT" },
      });
      if (transition.count !== 1) continue;

      if (database.logEntry) {
        await logEvent(
          { logEntry: database.logEntry },
          {
            userId: context.actorId,
            action: "SNIPPET_AUTO_DISABLED",
            objectType: "SCRIPT",
            objectLabel: row.name,
            objectId: row.id,
          },
        );
      }

      const notification = candidateIds.has(row.id)
        ? buildSnippetDisabledMessage(
            language,
            row.id,
            row.name,
            context.title || context.slug,
          )
        : buildSnippetOrphanedMessage(language, row.id, row.name);
      for (const recipientId of recipients) {
        await emitBestEffort(
          emit,
          recipientId,
          notification.message,
          notification.link,
          { snippetId: row.id },
        );
      }
    }
  };

  if (context.snippetIds.length) {
    const candidateRows = await snippet.findMany({
      where: { id: { in: context.snippetIds }, ...orphanScopeWhere },
      select: { id: true, name: true },
    });
    await disableOrphans(candidateRows);
  }

  for (;;) {
    const reconciliationRows = await snippet.findMany({
      where: orphanScopeWhere,
      select: { id: true, name: true },
      take: batchSize,
    });
    if (reconciliationRows.length === 0) break;
    await disableOrphans(reconciliationRows);
    if (reconciliationRows.length < batchSize) break;
  }
}
