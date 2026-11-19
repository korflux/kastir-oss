import { beforeEach, describe, expect, it, vi } from "vitest";

const { logEvent, notify, registerBackupAutoSnapshotScheduler, createFromZip } =
  vi.hoisted(() => ({
    logEvent: vi.fn(async () => undefined),
    notify: vi.fn(async () => undefined),
    registerBackupAutoSnapshotScheduler: vi.fn(async () => undefined),
    createFromZip: vi.fn(async () => ({
      id: "snap-auto-1",
      fileName: "auto.kastir",
      createdAt: new Date().toISOString(),
      sizeBytes: 100,
      siteTitle: "Site",
      origin: "http://localhost:3000",
      kastirVersion: "1.0.0",
      schemaVersion: "1",
      safety: false,
    })),
  }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/Publishing/queue", () => ({
  TRACKED_JOB_RETENTION: { age: 3600, count: 1000 },
  getPublishingQueue: () => ({ add: vi.fn(async () => undefined) }),
  registerBackupAutoSnapshotScheduler,
}));
vi.mock("@/lib/Modules/Auth/Bootstrap", () => ({
  bootstrapMaster: vi.fn(async () => undefined),
}));
vi.mock("@/lib/Logging/logEvent", () => ({ logEvent }));
vi.mock("@/lib/Modules/Notifications/Service", () => ({ notify }));
vi.mock("@/lib/Processing/mediaStorage", () => ({
  createMediaStorage: () => ({
    writePublic: vi.fn(),
    readPublic: vi.fn(async () => null),
    removePublic: vi.fn(),
    promotePublic: vi.fn(),
    writeStaging: vi.fn(),
    readStaging: vi.fn(),
    removeStaging: vi.fn(),
  }),
}));
vi.mock("@/lib/Modules/Backup/RateLimit", () => ({
  assertBackupRateLimit: vi.fn(async () => undefined),
}));
vi.mock("@/lib/Modules/Backup/MediaApply", () => ({
  mediaApply: {
    stageAssets: vi.fn(async () => "stage-token"),
    promoteStaged: vi.fn(async () => undefined),
    cleanupStaging: vi.fn(async () => undefined),
    removeOrphanUploads: vi.fn(async () => undefined),
  },
  MediaApply: class {},
}));

import { BackupDomainError, BackupService } from "@/lib/Modules/Backup/Service";
import { backupAutoScheduleSchema } from "@/lib/Modules/Backup/Schema";

function makeService(db: {
  user: {
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  siteSettings: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  page?: { findMany: ReturnType<typeof vi.fn> };
  pageFolder?: { findMany: ReturnType<typeof vi.fn> };
  mediaFile?: { findMany: ReturnType<typeof vi.fn> };
  mediaFolder?: { findMany: ReturnType<typeof vi.fn> };
  snippet?: { findMany: ReturnType<typeof vi.fn> };
  snippetPageScope?: { findMany: ReturnType<typeof vi.fn> };
  splitCampaign?: { findMany: ReturnType<typeof vi.fn> };
  splitDestination?: { findMany: ReturnType<typeof vi.fn> };
  account?: { findMany: ReturnType<typeof vi.fn> };
}) {
  const empty = vi.fn(async () => []);
  const database = {
    user: db.user,
    siteSettings: db.siteSettings,
    page: db.page ?? { findMany: empty },
    pageFolder: db.pageFolder ?? { findMany: empty },
    mediaFile: db.mediaFile ?? { findMany: empty },
    mediaFolder: db.mediaFolder ?? { findMany: empty },
    snippet: db.snippet ?? { findMany: empty },
    snippetPageScope: db.snippetPageScope ?? { findMany: empty },
    splitCampaign: db.splitCampaign ?? { findMany: empty },
    splitDestination: db.splitDestination ?? { findMany: empty },
    account: db.account ?? { findMany: empty },
    pageRevision: { findMany: empty },
    snippetRevision: { findMany: empty },
  };

  const store = {
    createFromZip,
    list: vi.fn(async () => []),
    get: vi.fn(),
    delete: vi.fn(),
    readPackageBytes: vi.fn(),
  };

  return new BackupService(
    database as never,
    store as never,
    {
      create: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      tryClaim: vi.fn(),
    } as never,
  );
}

describe("backupAutoScheduleSchema", () => {
  it("accepts a valid schedule payload", () => {
    const parsed = backupAutoScheduleSchema.safeParse({
      enabled: true,
      intervalDays: 7,
      hour: 3,
      minute: 15,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects invalid interval/hour/minute", () => {
    expect(
      backupAutoScheduleSchema.safeParse({
        enabled: true,
        intervalDays: 0,
        hour: 3,
        minute: 0,
      }).success,
    ).toBe(false);
    expect(
      backupAutoScheduleSchema.safeParse({
        enabled: true,
        intervalDays: 1,
        hour: 24,
        minute: 0,
      }).success,
    ).toBe(false);
    expect(
      backupAutoScheduleSchema.safeParse({
        enabled: true,
        intervalDays: 1,
        hour: 0,
        minute: 60,
      }).success,
    ).toBe(false);
    expect(
      backupAutoScheduleSchema.safeParse({
        enabled: true,
        intervalDays: 3651,
        hour: 0,
        minute: 0,
      }).success,
    ).toBe(false);
  });
});

describe("BackupService.updateAutoSchedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists settings, re-registers scheduler and audits", async () => {
    const update = vi.fn(async () => ({
      backupAutoEnabled: true,
      backupIntervalDays: 2,
      backupAutoHour: 4,
      backupAutoMinute: 30,
      timezone: "America/Sao_Paulo",
    }));
    const service = makeService({
      user: { findFirst: vi.fn(), findMany: vi.fn() },
      siteSettings: { findUnique: vi.fn(), update },
    });

    const result = await service.updateAutoSchedule("user-1", {
      enabled: true,
      intervalDays: 2,
      hour: 4,
      minute: 30,
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: "singleton" },
      data: {
        backupAutoEnabled: true,
        backupIntervalDays: 2,
        backupAutoHour: 4,
        backupAutoMinute: 30,
      },
      select: expect.any(Object),
    });
    expect(registerBackupAutoSnapshotScheduler).toHaveBeenCalledWith({
      backupAutoEnabled: true,
      backupIntervalDays: 2,
      backupAutoHour: 4,
      backupAutoMinute: 30,
      timezone: "America/Sao_Paulo",
    });
    expect(logEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        action: "BACKUP_AUTO_SCHEDULE_UPDATED",
      }),
    );
    expect(result).toEqual({
      enabled: true,
      intervalDays: 2,
      hour: 4,
      minute: 30,
      timezone: "America/Sao_Paulo",
      schedulerApplied: true,
    });
  });

  it("returns schedulerApplied false and logs when register fails", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    registerBackupAutoSnapshotScheduler.mockRejectedValueOnce(
      new Error("Redis down"),
    );
    const update = vi.fn(async () => ({
      backupAutoEnabled: true,
      backupIntervalDays: 1,
      backupAutoHour: 0,
      backupAutoMinute: 0,
      timezone: "UTC",
    }));
    const service = makeService({
      user: { findFirst: vi.fn(), findMany: vi.fn() },
      siteSettings: { findUnique: vi.fn(), update },
    });

    const result = await service.updateAutoSchedule("user-1", {
      enabled: true,
      intervalDays: 1,
      hour: 0,
      minute: 0,
    });

    expect(result.schedulerApplied).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("rejects invalid payload with VALIDATION_ERROR", async () => {
    const service = makeService({
      user: { findFirst: vi.fn(), findMany: vi.fn() },
      siteSettings: { findUnique: vi.fn(), update: vi.fn() },
    });

    await expect(
      service.updateAutoSchedule("user-1", {
        enabled: true,
        intervalDays: 0,
        hour: 4,
        minute: 30,
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    } satisfies Partial<BackupDomainError>);
  });
});

describe("BackupService.runAutomaticSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a snapshot and audits success without notifying", async () => {
    const findFirst = vi.fn(async () => ({ id: "master-1" }));
    const findManyUsers = vi.fn(async () => []);
    const service = makeService({
      user: {
        findFirst,
        // collectAndBuildPackage também chama user.findMany
        findMany: findManyUsers,
      },
      siteSettings: {
        findUnique: vi.fn(async () => ({
          id: "singleton",
          siteTitle: "Site",
          siteUrl: "http://localhost:3000",
          cloudflareApiTokenEncrypted: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
        update: vi.fn(),
      },
    });

    await service.runAutomaticSnapshot();

    expect(createFromZip).toHaveBeenCalledOnce();
    expect(logEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "master-1",
        action: "BACKUP_AUTO_EXPORTED",
        objectLabel: "auto.kastir",
      }),
    );
    expect(notify).not.toHaveBeenCalled();
  });

  it("audits failure and notifies MASTER/ADMIN without throwing", async () => {
    createFromZip.mockRejectedValueOnce(new Error("disk full"));
    const findFirst = vi.fn(async () => ({ id: "master-1" }));
    // Despacha por shape do where — não depende da ordem das calls.
    const findMany = vi.fn(async (args: { where?: { OR?: unknown } }) => {
      if (args?.where?.OR) {
        return [{ id: "master-1" }, { id: "admin-1" }];
      }
      return [];
    });

    const service = makeService({
      user: { findFirst, findMany },
      siteSettings: {
        findUnique: vi.fn(async () => ({
          id: "singleton",
          siteTitle: "Site",
          siteUrl: "http://localhost:3000",
          cloudflareApiTokenEncrypted: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
        update: vi.fn(),
      },
    });

    const prevLang = process.env.PANEL_LANGUAGE;
    process.env.PANEL_LANGUAGE = "en";
    try {
      await expect(service.runAutomaticSnapshot()).resolves.toBeUndefined();
    } finally {
      if (prevLang === undefined) delete process.env.PANEL_LANGUAGE;
      else process.env.PANEL_LANGUAGE = prevLang;
    }

    expect(findMany).toHaveBeenCalledWith({
      where: { OR: [{ isMaster: true }, { role: "ADMIN" }] },
      select: { id: true },
    });
    expect(logEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "master-1",
        action: "BACKUP_AUTO_EXPORT_FAILED",
        objectLabel: "disk full",
      }),
    );
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith(
      "master-1",
      "Automatic backup failed — see logs",
      "/admin/settings/backup",
    );
    expect(notify).toHaveBeenCalledWith(
      "admin-1",
      "Automatic backup failed — see logs",
      "/admin/settings/backup",
    );
  });

  it("keeps connection tokens out of the failure notification", async () => {
    const leaked =
      "Can't reach database server at postgres://kastir:super-secret@db:5432";
    createFromZip.mockRejectedValueOnce(new Error(leaked));
    const findFirst = vi.fn(async () => ({ id: "master-1" }));
    const findMany = vi.fn(async (args: { where?: { OR?: unknown } }) => {
      if (args?.where?.OR) return [{ id: "master-1" }];
      return [];
    });
    const service = makeService({
      user: { findFirst, findMany },
      siteSettings: {
        findUnique: vi.fn(async () => ({
          id: "singleton",
          siteTitle: "Site",
          siteUrl: "http://localhost:3000",
          cloudflareApiTokenEncrypted: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
        update: vi.fn(),
      },
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const prevLang = process.env.PANEL_LANGUAGE;
    process.env.PANEL_LANGUAGE = "en";
    try {
      await service.runAutomaticSnapshot();
    } finally {
      if (prevLang === undefined) delete process.env.PANEL_LANGUAGE;
      else process.env.PANEL_LANGUAGE = prevLang;
      logged.mockRestore();
    }

    expect(notify).toHaveBeenCalledWith(
      "master-1",
      "Automatic backup failed — see logs",
      "/admin/settings/backup",
    );
    expect(JSON.stringify(notify.mock.calls)).not.toContain("super-secret");
  });
});
