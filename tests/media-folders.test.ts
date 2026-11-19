import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { MediaFolderService } from "@/lib/Modules/Media/FolderService";

function makeFolder(id: string, parentId: string | null, isBase = false) {
  return {
    id,
    name: id,
    color: null,
    parentId,
    isBase,
  };
}

describe("MediaFolderService", () => {
  const database = {
    mediaFolder: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    mediaFile: {
      updateMany: vi.fn(),
    },
    logEntry: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (callback: (tx: typeof database) => unknown) =>
      callback(database),
    ),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    database.mediaFolder.findFirst.mockResolvedValue(
      makeFolder("base", null, true),
    );
    database.mediaFolder.findUnique.mockResolvedValue(
      makeFolder("base", null, true),
    );
    database.mediaFolder.findMany.mockResolvedValue([
      makeFolder("base", null, true),
    ]);
    database.mediaFolder.create.mockResolvedValue(
      makeFolder("campaigns", null),
    );
    database.mediaFolder.update.mockResolvedValue(
      makeFolder("renamed", null, true),
    );
    database.mediaFolder.deleteMany.mockResolvedValue({ count: 1 });
    database.mediaFile.updateMany.mockResolvedValue({ count: 0 });
    database.logEntry.create.mockResolvedValue({});
  });

  it("creates an independent root when parentId is omitted", async () => {
    const service = new MediaFolderService(database);

    await expect(
      service.createFolder("user-id", {
        name: "Campaigns",
        color: "#abc",
      }),
    ).resolves.toMatchObject({ id: "campaigns" });

    expect(database.mediaFolder.create).toHaveBeenCalledWith({
      data: {
        name: "Campaigns",
        color: "#AABBCC",
        parentId: null,
        isBase: false,
      },
    });
    expect(database.logEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "MEDIA_FOLDER_CREATED",
        objectType: "FOLDER",
      }),
    });
  });

  it("rejects creating a child of Base", async () => {
    const service = new MediaFolderService(database);

    await expect(
      service.createFolder("user-id", {
        name: "Under Base",
        parentId: "base",
      }),
    ).rejects.toMatchObject({ code: "BASE_FOLDER_PROTECTED" });
  });

  it("rejects a fourth level under an independent root", async () => {
    database.mediaFolder.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) =>
        [
          makeFolder("base", null, true),
          makeFolder("level-1", null),
          makeFolder("level-2", "level-1"),
          makeFolder("level-3", "level-2"),
        ].find((folder) => folder.id === where.id) ?? null,
    );
    database.mediaFolder.findMany.mockResolvedValue([
      makeFolder("base", null, true),
      makeFolder("level-1", null),
      makeFolder("level-2", "level-1"),
      makeFolder("level-3", "level-2"),
    ]);

    const service = new MediaFolderService(database);

    await expect(
      service.createFolder("user-id", {
        name: "level-4",
        parentId: "level-3",
      }),
    ).rejects.toMatchObject({
      code: "FOLDER_DEPTH_EXCEEDED",
    });
  });

  it("protects Base from rename and recolor", async () => {
    const service = new MediaFolderService(database);

    await expect(
      service.updateFolder("user-id", {
        id: "base",
        name: "Media Base",
      }),
    ).rejects.toMatchObject({ code: "BASE_FOLDER_PROTECTED" });
    expect(database.mediaFolder.update).not.toHaveBeenCalled();
  });

  it("protects Base from recolor even when the name is left untouched", async () => {
    const service = new MediaFolderService(database);

    await expect(
      service.updateFolder("user-id", {
        id: "base",
        color: "#111111",
      }),
    ).rejects.toMatchObject({ code: "BASE_FOLDER_PROTECTED" });
    expect(database.mediaFolder.update).not.toHaveBeenCalled();
  });

  it("updates name, color, and parent atomically through updateFolder", async () => {
    database.mediaFolder.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) =>
        [
          makeFolder("base", null, true),
          makeFolder("root-a", null),
          makeFolder("root-b", null),
        ].find((folder) => folder.id === where.id) ?? null,
    );
    database.mediaFolder.findMany.mockResolvedValue([
      makeFolder("base", null, true),
      makeFolder("root-a", null),
      makeFolder("root-b", null),
    ]);
    database.mediaFolder.update.mockResolvedValue(
      makeFolder("root-a", "root-b"),
    );

    const service = new MediaFolderService(database);
    const updated = await service.updateFolder("user-id", {
      id: "root-a",
      name: "Campaigns",
      color: "#abc",
      parentId: "root-b",
    });

    expect(updated).toMatchObject({
      id: "root-a",
      parentId: "root-b",
    });
    expect(database.mediaFolder.update).toHaveBeenCalledWith({
      where: { id: "root-a" },
      data: { name: "Campaigns", color: "#AABBCC", parentId: "root-b" },
    });
    expect(database.logEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "MEDIA_FOLDER_MOVED" }),
    });
  });

  it("rejects an invalid update parent before changing name or color", async () => {
    database.mediaFolder.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) =>
        [
          makeFolder("base", null, true),
          makeFolder("root-a", null),
          makeFolder("child", "root-a"),
        ].find((folder) => folder.id === where.id) ?? null,
    );
    database.mediaFolder.findMany.mockResolvedValue([
      makeFolder("base", null, true),
      makeFolder("root-a", null),
      makeFolder("child", "root-a"),
    ]);

    const service = new MediaFolderService(database);
    await expect(
      service.updateFolder("user-id", {
        id: "root-a",
        name: "Should not persist",
        color: "#abc",
        parentId: "child",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(database.mediaFolder.update).not.toHaveBeenCalled();
  });

  it("promotes a folder to root through updateFolder", async () => {
    database.mediaFolder.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) =>
        [
          makeFolder("base", null, true),
          makeFolder("root-a", null),
          makeFolder("child", "root-a"),
        ].find((folder) => folder.id === where.id) ?? null,
    );
    database.mediaFolder.findMany.mockResolvedValue([
      makeFolder("base", null, true),
      makeFolder("root-a", null),
      makeFolder("child", "root-a"),
    ]);
    database.mediaFolder.update.mockResolvedValue(makeFolder("child", null));

    const service = new MediaFolderService(database);
    const updated = await service.updateFolder("user-id", {
      id: "child",
      parentId: null,
    });

    expect(updated.parentId).toBeNull();
    expect(database.mediaFolder.update).toHaveBeenCalledWith({
      where: { id: "child" },
      data: { parentId: null },
    });
  });

  it("requires reassignToFolderId when deleting", async () => {
    database.mediaFolder.findUnique.mockResolvedValue(
      makeFolder("campaigns", null),
    );
    const service = new MediaFolderService(database);

    await expect(
      service.deleteFolder("user-id", { id: "campaigns" }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("moves files from a deleted subtree to the chosen reassign target", async () => {
    database.mediaFolder.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) =>
        [
          makeFolder("base", null, true),
          makeFolder("campaigns", null),
          makeFolder("black-friday", "campaigns"),
        ].find((folder) => folder.id === where.id) ?? null,
    );
    database.mediaFolder.findMany.mockResolvedValue([
      makeFolder("base", null, true),
      makeFolder("campaigns", null),
      makeFolder("black-friday", "campaigns"),
    ]);

    const service = new MediaFolderService(database);
    await service.deleteFolder("user-id", {
      id: "campaigns",
      reassignToFolderId: "base",
    });

    expect(database.mediaFile.updateMany).toHaveBeenCalledWith({
      where: { folderId: { in: ["campaigns", "black-friday"] } },
      data: { folderId: "base" },
    });
    expect(database.mediaFolder.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["campaigns", "black-friday"] } },
    });
  });

  it("protects Base from deletion by id", async () => {
    const service = new MediaFolderService(database);

    await expect(
      service.deleteFolder("user-id", {
        id: "base",
        reassignToFolderId: "base",
      }),
    ).rejects.toMatchObject({
      code: "BASE_FOLDER_PROTECTED",
    });
    expect(database.mediaFolder.deleteMany).not.toHaveBeenCalled();
  });

  it("moves a folder under another root", async () => {
    database.mediaFolder.findUnique.mockResolvedValue(
      makeFolder("root-a", null),
    );
    database.mediaFolder.findMany.mockResolvedValue([
      makeFolder("base", null, true),
      makeFolder("root-a", null),
      makeFolder("root-b", null),
    ]);
    database.mediaFolder.update.mockResolvedValue(
      makeFolder("root-a", "root-b"),
    );

    const service = new MediaFolderService(database);
    await service.moveFolder("user-id", {
      id: "root-a",
      newParentId: "root-b",
    });

    expect(database.mediaFolder.update).toHaveBeenCalledWith({
      where: { id: "root-a" },
      data: { parentId: "root-b" },
    });
    expect(database.logEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "MEDIA_FOLDER_MOVED" }),
    });
  });
});
