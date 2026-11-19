import { prisma } from "@/lib/prisma";
import {
  LEGACY_MEDIA_FOLDER_ACTIONS,
  effectiveLogObjectType,
  type LogEntryRecord,
  type LogListItem,
  type LogWhere,
  type LogsDatabase,
  type LogsFilter,
  type LogsListResult,
} from "@/lib/Modules/Logs/Types";
const SYSTEM_ACTOR_ID_PREFIX = "system:";

/** Domain errors from LogsService. Filter validation is owned by Zod/Schema. */
export type LogsDomainErrorCode = "FORBIDDEN";

export class LogsDomainError extends Error {
  constructor(
    public readonly code: LogsDomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LogsDomainError";
  }
}

const actorSelect = {
  id: true,
  name: true,
  role: true,
  isMaster: true,
} satisfies Record<string, boolean>;

const logSelect = {
  id: true,
  userId: true,
  action: true,
  objectType: true,
  objectLabel: true,
  objectId: true,
  source: true,
  tool: true,
  resource: true,
  requestId: true,
  createdAt: true,
} satisfies Record<string, boolean>;

function buildObjectTypeCondition(
  objectType: LogsFilter["objectType"],
): LogWhere | undefined {
  if (!objectType) return undefined;

  if (objectType === "FOLDER") {
    return {
      OR: [
        { objectType: "FOLDER" },
        {
          objectType: "MEDIA",
          action: { in: LEGACY_MEDIA_FOLDER_ACTIONS },
        },
      ],
    };
  }

  if (objectType === "MEDIA") {
    return {
      objectType: "MEDIA",
      action: { notIn: LEGACY_MEDIA_FOLDER_ACTIONS },
    };
  }

  return { objectType };
}

export function buildLogsWhere(filters: LogsFilter): LogWhere {
  const conditions: LogWhere[] = [];
  if (filters.userId) conditions.push({ userId: filters.userId });
  if (filters.from || filters.to) {
    conditions.push({
      createdAt: {
        ...(filters.from ? { gte: filters.from } : {}),
        ...(filters.to ? { lte: filters.to } : {}),
      },
    });
  }

  const objectTypeCondition = buildObjectTypeCondition(filters.objectType);
  if (objectTypeCondition) conditions.push(objectTypeCondition);

  return conditions.length ? { AND: conditions } : {};
}

function actorSummary(
  actorId: string,
  actor:
    Awaited<ReturnType<LogsDatabase["user"]["findMany"]>>[number] | undefined,
) {
  if (actorId.startsWith(SYSTEM_ACTOR_ID_PREFIX)) {
    return {
      id: actorId,
      name: process.env.PANEL_LANGUAGE === "pt-BR" ? "Sistema" : "System",
      role: null,
      removed: false,
    } as const;
  }

  if (!actor) {
    return { id: actorId, name: null, role: null, removed: true } as const;
  }

  return {
    id: actor.id,
    name: actor.name,
    role: actor.isMaster ? "MASTER" : actor.role,
    removed: false,
  } as const;
}

function toListItem(
  entry: LogEntryRecord,
  actors: Map<
    string,
    Awaited<ReturnType<LogsDatabase["user"]["findMany"]>>[number]
  >,
): LogListItem {
  return {
    id: entry.id,
    userId: entry.userId,
    actor: actorSummary(entry.userId, actors.get(entry.userId)),
    action: entry.action,
    objectType: effectiveLogObjectType(entry),
    objectLabel: entry.objectLabel,
    objectId: entry.objectId ?? null,
    source: entry.source ?? "PANEL",
    tool: entry.tool ?? null,
    resource: entry.resource ?? null,
    requestId: entry.requestId ?? null,
    createdAt: entry.createdAt,
  };
}

export class LogsService {
  constructor(
    private readonly database: LogsDatabase = prisma as unknown as LogsDatabase,
  ) {}

  async listLogs(
    actorId: string,
    filters: LogsFilter,
  ): Promise<LogsListResult> {
    const actor = await this.database.user.findUnique({
      where: { id: actorId },
      select: actorSelect,
    });

    if (!actor || (!actor.isMaster && actor.role !== "ADMIN")) {
      throw new LogsDomainError(
        "FORBIDDEN",
        "Logs are restricted to administrators",
      );
    }

    const where = buildLogsWhere(filters);
    const [total, entries] = await Promise.all([
      this.database.logEntry.count({ where }),
      this.database.logEntry.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
        select: logSelect,
      }),
    ]);

    const actorIds = [...new Set(entries.map((entry) => entry.userId))];
    const databaseActors = actorIds.length
      ? await this.database.user.findMany({
          where: { id: { in: actorIds } },
          select: actorSelect,
        })
      : [];
    const actors = new Map(databaseActors.map((entry) => [entry.id, entry]));

    return {
      items: entries.map((entry) => toListItem(entry, actors)),
      total,
      page: filters.page,
      pageSize: filters.pageSize,
    };
  }
}

export const logsService = new LogsService();
