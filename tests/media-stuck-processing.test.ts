import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("server-only", () => ({}));

import { reconcileStuckMediaProcessing } from "@/lib/Modules/Media/Service";

type StuckMediaFile = {
  id: string;
  name: string;
  url: string;
  processingStatus: "PROCESSING" | "READY" | "FAILED";
  processingToken: string | null;
  updatedAt: Date;
};

function createDatabase(files: StuckMediaFile[]) {
  const logEntry = { create: vi.fn().mockResolvedValue({}) };

  return {
    files,
    logEntry,
    mediaFile: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: { processingStatus: "PROCESSING"; updatedAt: { lt: Date } };
        }) =>
          files
            .filter((file) => file.processingStatus === where.processingStatus)
            .filter((file) => file.updatedAt < where.updatedAt.lt)
            .map(({ id, name, url, processingToken }) => ({
              id,
              name,
              url,
              processingToken,
            })),
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: {
            id: string;
            processingStatus?: string;
            processingToken?: string | null;
          };
          data: Partial<StuckMediaFile>;
        }) => {
          const file = files.find((item) => item.id === where.id);
          if (!file) return { count: 0 };
          if (
            where.processingStatus !== undefined &&
            where.processingStatus !== file.processingStatus
          ) {
            return { count: 0 };
          }
          if (
            where.processingToken !== undefined &&
            where.processingToken !== file.processingToken
          ) {
            return { count: 0 };
          }
          Object.assign(file, data);
          return { count: 1 };
        },
      ),
    },
  };
}

function createStorage() {
  return { removeStaging: vi.fn().mockResolvedValue(undefined) };
}

const FIVE_MIN = 5 * 60 * 1000;

describe("reconcileStuckMediaProcessing", () => {
  it("marks a PROCESSING record stale past the threshold as FAILED", async () => {
    const database = createDatabase([
      {
        id: "media-1",
        name: "hero",
        url: "/uploads/media-1/hero.webp",
        processingStatus: "PROCESSING",
        processingToken: "token-1",
        updatedAt: new Date(Date.now() - FIVE_MIN - 1000),
      },
    ]);
    const storage = createStorage();

    const result = await reconcileStuckMediaProcessing(
      { database, storage },
      FIVE_MIN,
    );

    expect(result).toEqual({ checked: 1, failed: 1 });
    expect(database.files[0]).toMatchObject({
      processingStatus: "FAILED",
      processingToken: null,
    });
  });

  it("logs a MEDIA_PROCESSING_FAILED audit entry for the reconciled record", async () => {
    const database = createDatabase([
      {
        id: "media-1",
        name: "hero",
        url: "/uploads/media-1/hero.webp",
        processingStatus: "PROCESSING",
        processingToken: "token-1",
        updatedAt: new Date(Date.now() - FIVE_MIN - 1000),
      },
    ]);
    const storage = createStorage();

    await reconcileStuckMediaProcessing({ database, storage }, FIVE_MIN);

    expect(database.logEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "MEDIA_PROCESSING_FAILED",
        objectType: "MEDIA",
        objectLabel: "hero (/uploads/media-1/hero.webp)",
        userId: "system:media-stuck-processing",
      }),
    });
  });

  it("removes the orphaned staging file for the reconciled record", async () => {
    const database = createDatabase([
      {
        id: "media-1",
        name: "hero",
        url: "/uploads/media-1/hero.webp",
        processingStatus: "PROCESSING",
        processingToken: "token-1",
        updatedAt: new Date(Date.now() - FIVE_MIN - 1000),
      },
    ]);
    const storage = createStorage();

    await reconcileStuckMediaProcessing({ database, storage }, FIVE_MIN);

    expect(storage.removeStaging).toHaveBeenCalledWith("media-1-token-1");
  });

  it("does not touch a PROCESSING record within the staleness window", async () => {
    const database = createDatabase([
      {
        id: "media-1",
        name: "hero",
        url: "/uploads/media-1/hero.webp",
        processingStatus: "PROCESSING",
        processingToken: "token-1",
        updatedAt: new Date(Date.now() - 1000),
      },
    ]);
    const storage = createStorage();

    const result = await reconcileStuckMediaProcessing(
      { database, storage },
      FIVE_MIN,
    );

    expect(result).toEqual({ checked: 0, failed: 0 });
    expect(database.files[0].processingStatus).toBe("PROCESSING");
    expect(storage.removeStaging).not.toHaveBeenCalled();
  });

  it("ignores records that are already READY or FAILED", async () => {
    const database = createDatabase([
      {
        id: "media-ready",
        name: "ready",
        url: "/uploads/media-ready/ready.webp",
        processingStatus: "READY",
        processingToken: null,
        updatedAt: new Date(Date.now() - FIVE_MIN - 1000),
      },
      {
        id: "media-failed",
        name: "failed",
        url: "/uploads/media-failed/failed.webp",
        processingStatus: "FAILED",
        processingToken: null,
        updatedAt: new Date(Date.now() - FIVE_MIN - 1000),
      },
    ]);
    const storage = createStorage();

    const result = await reconcileStuckMediaProcessing(
      { database, storage },
      FIVE_MIN,
    );

    expect(result).toEqual({ checked: 0, failed: 0 });
    expect(database.mediaFile.updateMany).not.toHaveBeenCalled();
  });

  it("does not overwrite a job that finished between the sweep's read and write", async () => {
    const database = createDatabase([
      {
        id: "media-1",
        name: "hero",
        url: "/uploads/media-1/hero.webp",
        processingStatus: "PROCESSING",
        processingToken: "token-1",
        updatedAt: new Date(Date.now() - FIVE_MIN - 1000),
      },
    ]);
    const storage = createStorage();
    // The real worker claims the record (new token, still PROCESSING) right
    // after the sweep's findMany, before its updateMany runs.
    database.mediaFile.updateMany.mockImplementationOnce(async () => {
      database.files[0].processingToken = "token-2";
      return { count: 0 };
    });

    const result = await reconcileStuckMediaProcessing(
      { database, storage },
      FIVE_MIN,
    );

    expect(result).toEqual({ checked: 1, failed: 0 });
    expect(database.files[0]).toMatchObject({
      processingStatus: "PROCESSING",
      processingToken: "token-2",
    });
    expect(storage.removeStaging).not.toHaveBeenCalled();
  });
});
