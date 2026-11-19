import { describe, expect, it, vi } from "vitest";

const { stageAssets } = vi.hoisted(() => ({
  stageAssets: vi.fn(async () => "stage-token"),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/Publishing/queue", () => ({
  TRACKED_JOB_RETENTION: { age: 3600, count: 1000 },
  getPublishingQueue: () => ({
    add: vi.fn(async () => undefined),
  }),
  registerBackupAutoSnapshotScheduler: vi.fn(async () => undefined),
}));
vi.mock("@/lib/Modules/Auth/Bootstrap", () => ({
  bootstrapMaster: vi.fn(async () => undefined),
}));
vi.mock("@/lib/Logging/logEvent", () => ({
  logEvent: vi.fn(async () => undefined),
}));
vi.mock("@/lib/Processing/mediaStorage", () => ({
  createMediaStorage: () => ({
    writePublic: vi.fn(),
    readPublic: vi.fn(),
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
    stageAssets,
    promoteStaged: vi.fn(async () => undefined),
    cleanupStaging: vi.fn(async () => undefined),
    removeOrphanUploads: vi.fn(async () => undefined),
  },
  MediaApply: class {},
}));

import {
  CURRENT_SCHEMA_VERSION,
  RESTORE_CONFIRMATION_PHRASE,
} from "@/lib/Modules/Backup/constants";
import { buildSitePackage } from "@/lib/Modules/Backup/PackageWriter";
import { BackupDomainError, BackupService } from "@/lib/Modules/Backup/Service";
import {
  importConfirmSchema,
  restoreConfirmSchema,
} from "@/lib/Modules/Backup/Schema";

describe("BackupService guards", () => {
  const service = new BackupService();

  it("allows Master and Admin, forbids Editor", () => {
    expect(() => service.assertAdmin("MASTER")).not.toThrow();
    expect(() => service.assertAdmin("ADMIN")).not.toThrow();
    expect(() => service.assertAdmin("EDITOR")).toThrow(BackupDomainError);
    try {
      service.assertAdmin("EDITOR");
    } catch (error) {
      expect(error).toBeInstanceOf(BackupDomainError);
      expect((error as BackupDomainError).code).toBe("FORBIDDEN");
    }
  });

  it("requires exact RESTAURAR confirmation", () => {
    expect(() =>
      service.assertConfirmation(RESTORE_CONFIRMATION_PHRASE),
    ).not.toThrow();
    expect(() => service.assertConfirmation("restaurar")).toThrow(
      BackupDomainError,
    );
    expect(() => service.assertConfirmation("RESTAURAR ")).toThrow(
      BackupDomainError,
    );
    expect(() => service.assertConfirmation("")).toThrow(BackupDomainError);
    try {
      service.assertConfirmation("yes");
    } catch (error) {
      expect(error).toBeInstanceOf(BackupDomainError);
      expect((error as BackupDomainError).code).toBe("CONFIRMATION_REQUIRED");
    }
  });

  it("blocks legacy account identity before staging or replacing data", async () => {
    const legacyPackage = buildSitePackage({
      origin: "https://source.example",
      siteTitle: "Source",
      schemaVersion: "20260721142253_optimize_db_phase18_indexes_and_rollup",
      data: {
        "users.json": {
          users: [
            {
              id: "user-1",
              name: "Admin",
              email: "admin@example.com",
              isMaster: true,
            },
          ],
          accounts: [
            {
              id: "account-1",
              accountId: "user-1",
              providerId: "credential",
              userId: "user-1",
              password: "argon2-hash",
            },
          ],
        },
      },
      assets: [],
    });

    await expect(
      service.applyPackageBytes(legacyPackage.zipBytes, {
        targetOrigin: "https://target.example",
        rewriteIfNeeded: false,
        actorUserId: "master-1",
      }),
    ).rejects.toMatchObject({ code: "INCOMPATIBLE" });
    expect(stageAssets).not.toHaveBeenCalled();
  });

  it("blocks users without login identities before staging or replacing data", async () => {
    stageAssets.mockClear();
    const packageWithoutAccounts = buildSitePackage({
      origin: "https://source.example",
      siteTitle: "Source",
      schemaVersion: CURRENT_SCHEMA_VERSION,
      data: {
        "users.json": {
          users: [
            {
              id: "master-1",
              name: "Master",
              email: "master@example.com",
              isMaster: true,
            },
          ],
          accounts: [],
        },
      },
      assets: [],
    });

    await expect(
      service.applyPackageBytes(packageWithoutAccounts.zipBytes, {
        targetOrigin: "https://target.example",
        rewriteIfNeeded: false,
        actorUserId: "master-1",
      }),
    ).rejects.toMatchObject({ code: "INCOMPATIBLE" });
    expect(stageAssets).not.toHaveBeenCalled();
  });
});

describe("backup confirmation schemas", () => {
  it("accepts restore payload with RESTAURAR", () => {
    const parsed = restoreConfirmSchema.safeParse({
      confirmation: "RESTAURAR",
      snapshotId: "snap-1",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects restore without exact phrase", () => {
    const parsed = restoreConfirmSchema.safeParse({
      confirmation: "confirm",
      snapshotId: "snap-1",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts import confirm with target origin", () => {
    const parsed = importConfirmSchema.safeParse({
      confirmation: "RESTAURAR",
      jobId: "job-1",
      targetOrigin: "https://destino.example",
      sourceOrigin: "https://origem.example",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an import jobId that is not a safe backup id", () => {
    const parsed = importConfirmSchema.safeParse({
      confirmation: "RESTAURAR",
      jobId: "../../package",
      targetOrigin: "https://destino.example",
    });
    expect(parsed.success).toBe(false);
  });
});
