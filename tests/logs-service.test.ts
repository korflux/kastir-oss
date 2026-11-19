import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { buildLogsWhere, LogsService } from "@/lib/Modules/Logs/Service";
import type {
  LogEntryRecord,
  LogsDatabase,
  LogsFilter,
} from "@/lib/Modules/Logs/Types";

const users = [
  {
    id: "master-id",
    name: "Master",
    role: "ADMIN" as const,
    isMaster: true,
  },
  {
    id: "admin-id",
    name: "Admin",
    role: "ADMIN" as const,
    isMaster: false,
  },
  {
    id: "editor-id",
    name: "Editor",
    role: "EDITOR" as const,
    isMaster: false,
  },
];

const logs: LogEntryRecord[] = [
  {
    id: "log-page",
    userId: "admin-id",
    action: "PAGE_PUBLISHED",
    objectType: "PAGE",
    objectLabel: "Landing (/landing)",
    createdAt: new Date("2026-07-17T12:00:03.000Z"),
  },
  {
    id: "log-folder-page",
    userId: "admin-id",
    action: "FOLDER_CREATED",
    objectType: "FOLDER",
    objectLabel: "Campaigns",
    createdAt: new Date("2026-07-17T12:00:02.000Z"),
  },
  {
    id: "log-folder-media-legacy",
    userId: "master-id",
    action: "MEDIA_FOLDER_DELETED",
    objectType: "MEDIA",
    objectLabel: "Old media folder",
    createdAt: new Date("2026-07-17T12:00:01.000Z"),
  },
  {
    id: "log-media",
    userId: "master-id",
    action: "MEDIA_DELETED",
    objectType: "MEDIA",
    objectLabel: "hero.webp (/uploads/hero.webp)",
    createdAt: new Date("2026-07-17T12:00:00.000Z"),
  },
  {
    id: "log-removed-user",
    userId: "removed-id",
    action: "USER_REMOVED",
    objectType: "USER",
    objectLabel: "Former editor",
    createdAt: new Date("2026-07-16T12:00:00.000Z"),
  },
];

function matchesWhere(
  log: LogEntryRecord,
  where: Record<string, unknown>,
): boolean {
  const and = where.AND as Array<Record<string, unknown>> | undefined;
  if (and && !and.every((condition) => matchesWhere(log, condition)))
    return false;

  const or = where.OR as Array<Record<string, unknown>> | undefined;
  if (or && !or.some((condition) => matchesWhere(log, condition))) return false;

  if (where.userId && log.userId !== where.userId) return false;
  if (where.objectType && log.objectType !== where.objectType) return false;

  const action = where.action as
    { in?: string[]; notIn?: string[] } | undefined;
  if (action?.in && !action.in.includes(log.action)) return false;
  if (action?.notIn && action.notIn.includes(log.action)) return false;

  const createdAt = where.createdAt as { gte?: Date; lte?: Date } | undefined;
  if (createdAt?.gte && log.createdAt < createdAt.gte) return false;
  if (createdAt?.lte && log.createdAt > createdAt.lte) return false;

  return true;
}

function createDatabase() {
  const database: LogsDatabase = {
    user: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          users.find((user) => user.id === where.id) ?? null,
      ),
      findMany: vi.fn(
        async ({ where }: { where?: { id?: { in: string[] } } }) => {
          const ids = new Set(where?.id?.in ?? users.map((user) => user.id));
          return users.filter((user) => ids.has(user.id));
        },
      ),
    },
    logEntry: {
      findMany: vi.fn(
        async ({
          where,
          skip,
          take,
        }: {
          where: Record<string, unknown>;
          skip: number;
          take: number;
        }) =>
          logs
            .filter((log) => matchesWhere(log, where))
            .sort(
              (left, right) =>
                right.createdAt.getTime() - left.createdAt.getTime() ||
                right.id.localeCompare(left.id),
            )
            .slice(skip, skip + take),
      ),
      count: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) =>
          logs.filter((log) => matchesWhere(log, where)).length,
      ),
    },
  };

  return database;
}

describe("LogsService", () => {
  let database: LogsDatabase;
  let service: LogsService;

  beforeEach(() => {
    database = createDatabase();
    service = new LogsService(database);
  });

  it("allows administrators and returns a safe, stable page", async () => {
    const result = await service.listLogs("admin-id", { page: 1, pageSize: 2 });

    expect(result.total).toBe(5);
    expect(result.items.map((item) => item.id)).toEqual([
      "log-page",
      "log-folder-page",
    ]);
    expect(result.items[0]).toMatchObject({
      actor: { id: "admin-id", name: "Admin", role: "ADMIN", removed: false },
      objectType: "PAGE",
    });
    expect(result.items[0]).not.toHaveProperty("content");
  });

  it("resolves all actors with one batch query and marks missing users", async () => {
    const result = await service.listLogs("master-id", {
      page: 1,
      pageSize: 5,
    });
    const userFindMany = database.user.findMany as ReturnType<typeof vi.fn>;

    expect(userFindMany).toHaveBeenCalledTimes(1);
    expect(result.items.at(-1)?.actor).toEqual({
      id: "removed-id",
      name: null,
      role: null,
      removed: true,
    });
  });

  it("classifies legacy media folders as folders and keeps media files separate", async () => {
    const folders = await service.listLogs("master-id", {
      page: 1,
      pageSize: 50,
      objectType: "FOLDER",
    });
    const media = await service.listLogs("master-id", {
      page: 1,
      pageSize: 50,
      objectType: "MEDIA",
    });

    expect(folders.items.map((item) => item.id)).toEqual([
      "log-folder-page",
      "log-folder-media-legacy",
    ]);
    expect(media.items.map((item) => item.id)).toEqual(["log-media"]);
  });

  it("returns an empty page for an unknown user filter", async () => {
    const result = await service.listLogs("admin-id", {
      page: 1,
      pageSize: 50,
      userId: "does-not-exist",
    });

    expect(result).toMatchObject({
      items: [],
      total: 0,
      page: 1,
      pageSize: 50,
    });
  });

  it("combines user and inclusive date filters", async () => {
    const filters: LogsFilter = {
      page: 1,
      pageSize: 50,
      userId: "admin-id",
      from: new Date("2026-07-17T12:00:02.000Z"),
      to: new Date("2026-07-17T12:00:03.999Z"),
    };

    const result = await service.listLogs("master-id", filters);

    expect(result.items.map((item) => item.id)).toEqual([
      "log-page",
      "log-folder-page",
    ]);
  });

  it("rejects an editor even when the caller supplies a different client role", async () => {
    await expect(
      service.listLogs("editor-id", { page: 1, pageSize: 50 }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("builds createdAt filters with only the defined bounds", () => {
    expect(
      buildLogsWhere({
        page: 1,
        pageSize: 50,
        from: new Date("2026-07-17T12:00:00.000Z"),
      }),
    ).toEqual({
      AND: [{ createdAt: { gte: new Date("2026-07-17T12:00:00.000Z") } }],
    });

    expect(
      buildLogsWhere({
        page: 1,
        pageSize: 50,
        to: new Date("2026-07-17T12:00:45.999Z"),
      }),
    ).toEqual({
      AND: [{ createdAt: { lte: new Date("2026-07-17T12:00:45.999Z") } }],
    });
  });
});
