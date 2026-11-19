export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("@/lib/env");
    const { bootstrapMaster } = await import("@/lib/Modules/Auth/Bootstrap");
    const {
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
    } = await import("@/lib/Publishing/queue");
    const { startPublishingWorker } = await import("@/lib/Publishing/worker");

    await bootstrapMaster();
    startPublishingWorker();
    try {
      await registerNotificationExpirationScheduler();
    } catch (error) {
      console.error(
        "[Kastir] Unable to register notification expiration scheduler",
        error instanceof Error ? error.message : "unknown error",
      );
    }
    try {
      await registerTrashExpirationScheduler();
    } catch (error) {
      console.error(
        "[Kastir] Unable to register trash expiration scheduler",
        error instanceof Error ? error.message : "unknown error",
      );
    }
    try {
      await registerRevisionHistoryExpirationScheduler();
    } catch (error) {
      console.error(
        "[Kastir] Unable to register revision history expiration scheduler",
        error instanceof Error ? error.message : "unknown error",
      );
    }
    try {
      await registerSplitEventsExpirationScheduler();
    } catch (error) {
      console.error(
        "[Kastir] Unable to register split events expiration scheduler",
        error instanceof Error ? error.message : "unknown error",
      );
    }
    try {
      await registerLogEntriesExpirationScheduler();
    } catch (error) {
      console.error(
        "[Kastir] Unable to register log entries expiration scheduler",
        error instanceof Error ? error.message : "unknown error",
      );
    }
    try {
      await registerStaleNotificationsExpirationScheduler();
    } catch (error) {
      console.error(
        "[Kastir] Unable to register stale notifications expiration scheduler",
        error instanceof Error ? error.message : "unknown error",
      );
    }
    try {
      await registerSessionsExpirationScheduler();
    } catch (error) {
      console.error(
        "[Kastir] Unable to register sessions expiration scheduler",
        error instanceof Error ? error.message : "unknown error",
      );
    }
    try {
      await registerVerificationsExpirationScheduler();
    } catch (error) {
      console.error(
        "[Kastir] Unable to register verifications expiration scheduler",
        error instanceof Error ? error.message : "unknown error",
      );
    }
    try {
      await registerMediaStuckSweepScheduler();
    } catch (error) {
      console.error(
        "[Kastir] Unable to register media stuck-processing sweep scheduler",
        error instanceof Error ? error.message : "unknown error",
      );
    }
    // Backup automático: lê SiteSettings e (re)registra o scheduler dinâmico.
    try {
      const { prisma } = await import("@/lib/prisma");
      const settings = await prisma.siteSettings.findUnique({
        where: { id: "singleton" },
        select: {
          backupAutoEnabled: true,
          backupIntervalDays: true,
          backupAutoHour: true,
          backupAutoMinute: true,
          timezone: true,
        },
      });
      if (settings) {
        await registerBackupAutoSnapshotScheduler(settings);
      }
    } catch (error) {
      console.error(
        "[Kastir] Unable to register backup auto-snapshot scheduler",
        error instanceof Error ? error.message : "unknown error",
      );
    }
  }
}
