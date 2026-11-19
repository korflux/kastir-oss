import { PrismaPg } from "@prisma/adapter-pg";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";

import { PrismaClient } from "@/app/generated/prisma/client";
import type { LogsDatabase } from "@/lib/Modules/Logs/Types";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const databaseUrl = process.env.LOGS_TEST_DATABASE_URL;
const describeIntegration = describe.skipIf(!databaseUrl);

describeIntegration("LogsService with Postgres", () => {
  let database: PrismaClient;
  let service: import("@/lib/Modules/Logs/Service").LogsService;
  let actorId: string;
  let markerIds: string[] = [];
  let markerFrom: Date;
  let markerTo: Date;

  beforeAll(async () => {
    if (!databaseUrl) return;

    database = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl }),
    });
    const actor = await database.user.findFirst({
      where: { isMaster: true },
      select: { id: true },
    });
    if (!actor) throw new Error("LOGS_TEST_DATABASE_URL has no master user");
    actorId = actor.id;
    const markerAt = new Date();
    markerFrom = new Date(markerAt.getTime() - 1_000);
    markerTo = new Date(markerAt.getTime() + 1_000);

    const records = await Promise.all(
      (
        [
          ["PAGE_CREATED", "PAGE", "logs-integration-page"],
          ["FOLDER_CREATED", "FOLDER", "logs-integration-folder"],
          ["MEDIA_CREATED", "MEDIA", "logs-integration-media"],
          ["SCRIPT_CREATED", "SCRIPT", "logs-integration-script"],
          ["USER_INVITE_CREATED", "USER", "logs-integration-user"],
          ["MEDIA_FOLDER_CREATED", "MEDIA", "logs-integration-legacy-folder"],
        ] as const
      ).map(([action, objectType, objectLabel]) =>
        database.logEntry.create({
          data: {
            userId: actorId,
            action,
            objectType,
            objectLabel,
            createdAt: markerAt,
          },
          select: { id: true },
        }),
      ),
    );
    markerIds = records.map((record) => record.id);

    await database.logEntry
      .create({
        data: {
          userId: "logs-integration-removed-user",
          action: "PAGE_UPDATED",
          objectType: "PAGE",
          objectLabel: "logs-integration-removed-target",
          createdAt: markerAt,
        },
        select: { id: true },
      })
      .then((record) => markerIds.push(record.id));

    const { LogsService } = await import("@/lib/Modules/Logs/Service");
    service = new LogsService(database as unknown as LogsDatabase);
  });

  afterAll(async () => {
    if (!database) return;
    if (markerIds.length) {
      await database.logEntry.deleteMany({ where: { id: { in: markerIds } } });
    }
    await database.$disconnect();
  });

  it("reads every seeded object category and classifies legacy media folders", async () => {
    const result = await service.listLogs(actorId, {
      page: 1,
      pageSize: 20,
      userId: actorId,
      from: markerFrom,
      to: markerTo,
    });

    expect(result.total).toBe(6);
    expect(result.items.map((item) => item.objectType)).toEqual(
      expect.arrayContaining(["PAGE", "FOLDER", "MEDIA", "SCRIPT", "USER"]),
    );

    const folders = await service.listLogs(actorId, {
      page: 1,
      pageSize: 20,
      objectType: "FOLDER",
      from: markerFrom,
      to: markerTo,
    });
    expect(folders.items.map((item) => item.objectLabel)).toEqual(
      expect.arrayContaining([
        "logs-integration-folder",
        "logs-integration-legacy-folder",
      ]),
    );

    const media = await service.listLogs(actorId, {
      page: 1,
      pageSize: 20,
      objectType: "MEDIA",
      from: markerFrom,
      to: markerTo,
    });
    expect(media.items.map((item) => item.objectLabel)).toEqual([
      "logs-integration-media",
    ]);
  });

  it("keeps a removed actor visible through the safe fallback", async () => {
    const result = await service.listLogs(actorId, {
      page: 1,
      pageSize: 20,
      userId: "logs-integration-removed-user",
      from: markerFrom,
      to: markerTo,
    });

    expect(result.total).toBe(1);
    expect(result.items[0]?.actor).toMatchObject({
      id: "logs-integration-removed-user",
      name: null,
      role: null,
      removed: true,
    });
  });
});
