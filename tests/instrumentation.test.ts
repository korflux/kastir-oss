import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  bootstrapMaster,
  registerNotificationExpirationScheduler,
  registerTrashExpirationScheduler,
  registerRevisionHistoryExpirationScheduler,
  registerSplitEventsExpirationScheduler,
  registerLogEntriesExpirationScheduler,
  registerStaleNotificationsExpirationScheduler,
  registerSessionsExpirationScheduler,
  registerVerificationsExpirationScheduler,
  registerMediaStuckSweepScheduler,
  registerBackupAutoSnapshotScheduler,
  startPublishingWorker,
  findUnique,
} = vi.hoisted(() => ({
  bootstrapMaster: vi.fn().mockResolvedValue(undefined),
  registerNotificationExpirationScheduler: vi.fn().mockResolvedValue(undefined),
  registerTrashExpirationScheduler: vi.fn().mockResolvedValue(undefined),
  registerRevisionHistoryExpirationScheduler: vi
    .fn()
    .mockResolvedValue(undefined),
  registerSplitEventsExpirationScheduler: vi.fn().mockResolvedValue(undefined),
  registerLogEntriesExpirationScheduler: vi.fn().mockResolvedValue(undefined),
  registerStaleNotificationsExpirationScheduler: vi
    .fn()
    .mockResolvedValue(undefined),
  registerSessionsExpirationScheduler: vi.fn().mockResolvedValue(undefined),
  registerVerificationsExpirationScheduler: vi
    .fn()
    .mockResolvedValue(undefined),
  registerMediaStuckSweepScheduler: vi.fn().mockResolvedValue(undefined),
  registerBackupAutoSnapshotScheduler: vi.fn().mockResolvedValue(undefined),
  startPublishingWorker: vi.fn(),
  findUnique: vi.fn().mockResolvedValue({
    backupAutoEnabled: false,
    backupIntervalDays: 1,
    backupAutoHour: 0,
    backupAutoMinute: 0,
    timezone: "UTC",
  }),
}));

vi.mock("@/lib/Modules/Auth/Bootstrap", () => ({ bootstrapMaster }));
vi.mock("@/lib/Publishing/queue", () => ({
  TRACKED_JOB_RETENTION: { age: 3600, count: 1000 },
  registerNotificationExpirationScheduler,
  registerTrashExpirationScheduler,
  registerRevisionHistoryExpirationScheduler,
  registerSplitEventsExpirationScheduler,
  registerLogEntriesExpirationScheduler,
  registerStaleNotificationsExpirationScheduler,
  registerSessionsExpirationScheduler,
  registerVerificationsExpirationScheduler,
  registerMediaStuckSweepScheduler,
  registerBackupAutoSnapshotScheduler,
}));
vi.mock("@/lib/Publishing/worker", () => ({ startPublishingWorker }));
vi.mock("@/lib/env", () => ({ env: {} }));
vi.mock("@/lib/prisma", () => ({
  prisma: { siteSettings: { findUnique } },
}));

describe("Node startup instrumentation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUnique.mockResolvedValue({
      backupAutoEnabled: false,
      backupIntervalDays: 1,
      backupAutoHour: 0,
      backupAutoMinute: 0,
      timezone: "UTC",
    });
  });

  it("runs the master bootstrap only in the Node runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");

    // Reimport limpa o módulo em cache entre cenários de runtime.
    vi.resetModules();
    const { register } = await import("@/instrumentation");
    await register();

    expect(bootstrapMaster).toHaveBeenCalledOnce();
    expect(startPublishingWorker).toHaveBeenCalledOnce();
    expect(registerNotificationExpirationScheduler).toHaveBeenCalledOnce();
    expect(registerTrashExpirationScheduler).toHaveBeenCalledOnce();
    expect(registerRevisionHistoryExpirationScheduler).toHaveBeenCalledOnce();
    expect(registerSplitEventsExpirationScheduler).toHaveBeenCalledOnce();
    expect(registerLogEntriesExpirationScheduler).toHaveBeenCalledOnce();
    expect(
      registerStaleNotificationsExpirationScheduler,
    ).toHaveBeenCalledOnce();
    expect(registerSessionsExpirationScheduler).toHaveBeenCalledOnce();
    expect(registerVerificationsExpirationScheduler).toHaveBeenCalledOnce();
    expect(registerMediaStuckSweepScheduler).toHaveBeenCalledOnce();
    expect(registerBackupAutoSnapshotScheduler).toHaveBeenCalledOnce();
    expect(registerBackupAutoSnapshotScheduler).toHaveBeenCalledWith({
      backupAutoEnabled: false,
      backupIntervalDays: 1,
      backupAutoHour: 0,
      backupAutoMinute: 0,
      timezone: "UTC",
    });
  });

  it("does not initialize the database in the edge runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");

    vi.resetModules();
    const { register } = await import("@/instrumentation");
    await register();

    expect(bootstrapMaster).not.toHaveBeenCalled();
    expect(startPublishingWorker).not.toHaveBeenCalled();
    expect(registerNotificationExpirationScheduler).not.toHaveBeenCalled();
    expect(registerTrashExpirationScheduler).not.toHaveBeenCalled();
    expect(registerRevisionHistoryExpirationScheduler).not.toHaveBeenCalled();
    expect(registerSplitEventsExpirationScheduler).not.toHaveBeenCalled();
    expect(registerLogEntriesExpirationScheduler).not.toHaveBeenCalled();
    expect(
      registerStaleNotificationsExpirationScheduler,
    ).not.toHaveBeenCalled();
    expect(registerSessionsExpirationScheduler).not.toHaveBeenCalled();
    expect(registerVerificationsExpirationScheduler).not.toHaveBeenCalled();
    expect(registerMediaStuckSweepScheduler).not.toHaveBeenCalled();
    expect(registerBackupAutoSnapshotScheduler).not.toHaveBeenCalled();
  });
});
