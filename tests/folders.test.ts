import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { FolderService } from "@/lib/Modules/Pages/FolderService";

type Folder = {
  id: string;
  name: string;
  color: string | null;
  parentId: string | null;
  isBase: boolean;
};

function createFolderDatabase() {
  const folders: Folder[] = [
    {
      id: "base-id",
      name: "Base",
      color: null,
      parentId: null,
      isBase: true,
    },
  ];
  const pages = [
    { id: "page-1", folderId: "folder-id" },
    { id: "page-2", folderId: "child-id" },
    { id: "page-3", folderId: "base-id" },
  ];
  let nextFolderId = 1;
  const database = {
    pageFolder: {
      findFirst: vi.fn(
        async ({ where }: { where?: { isBase?: boolean } } = {}) =>
          folders.find(
            (folder) =>
              where?.isBase === undefined || folder.isBase === where.isBase,
          ) ?? null,
      ),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          folders.find((folder) => folder.id === where.id) ?? null,
      ),
      findMany: vi.fn(async () => [...folders]),
      create: vi.fn(async ({ data }: { data: Omit<Folder, "id"> }) => {
        const folder = { ...data, id: `folder-created-${nextFolderId++}` };
        folders.push(folder);
        return folder;
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<Folder>;
        }) => {
          const folder = folders.find((candidate) => candidate.id === where.id);
          if (!folder) throw new Error("missing folder");
          Object.assign(folder, data);
          return folder;
        },
      ),
      deleteMany: vi.fn(
        async ({ where }: { where: { id: { in: string[] } } }) => {
          const ids = new Set(where.id.in);
          let count = 0;
          for (let index = folders.length - 1; index >= 0; index -= 1) {
            if (ids.has(folders[index].id)) {
              folders.splice(index, 1);
              count += 1;
            }
          }
          return { count };
        },
      ),
    },
    page: {
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { folderId: { in: string[] } };
          data: { folderId: string };
        }) => {
          const ids = new Set(where.folderId.in);
          for (const page of pages) {
            if (ids.has(page.folderId)) page.folderId = data.folderId;
          }
          return {
            count: pages.filter((page) => page.folderId === data.folderId)
              .length,
          };
        },
      ),
    },
    logEntry: { create: vi.fn(async () => ({ id: "log-id" })) },
    $transaction: vi.fn(
      async <T>(callback: (tx: typeof database) => Promise<T>) =>
        callback(database),
    ),
  };

  return { database, folders, pages };
}

describe("FolderService", () => {
  it("creates an independent root when parentId is omitted", async () => {
    const { database } = createFolderDatabase();
    const service = new FolderService(database);

    const folder = await service.createFolder("master-id", {
      name: "Campaigns",
      color: "#abc",
    });

    expect(folder).toMatchObject({
      name: "Campaigns",
      color: "#AABBCC",
      parentId: null,
      isBase: false,
    });
    expect(database.logEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "FOLDER_CREATED",
        objectType: "FOLDER",
      }),
    });
  });

  it("rejects creating a child of Base", async () => {
    const { database } = createFolderDatabase();
    const service = new FolderService(database);

    await expect(
      service.createFolder("master-id", {
        name: "Under Base",
        parentId: "base-id",
      }),
    ).rejects.toMatchObject({ code: "BASE_FOLDER_PROTECTED" });
  });

  it("rejects the fourth level under an independent root", async () => {
    const { database, folders } = createFolderDatabase();
    folders.push(
      { id: "level-1", name: "1", color: null, parentId: null, isBase: false },
      {
        id: "level-2",
        name: "2",
        color: null,
        parentId: "level-1",
        isBase: false,
      },
      {
        id: "level-3",
        name: "3",
        color: null,
        parentId: "level-2",
        isBase: false,
      },
    );
    const service = new FolderService(database);

    await expect(
      service.createFolder("master-id", { name: "4", parentId: "level-3" }),
    ).rejects.toMatchObject({ code: "FOLDER_DEPTH_EXCEEDED" });
  });

  it("protects Base from rename and recolor", async () => {
    const { database } = createFolderDatabase();
    const service = new FolderService(database);

    await expect(
      service.updateFolder("master-id", {
        id: "base-id",
        name: "Uncategorized",
      }),
    ).rejects.toMatchObject({ code: "BASE_FOLDER_PROTECTED" });
    expect(database.pageFolder.update).not.toHaveBeenCalled();
  });

  it("protects Base from recolor even when the name is left untouched", async () => {
    const { database } = createFolderDatabase();
    const service = new FolderService(database);

    await expect(
      service.updateFolder("master-id", {
        id: "base-id",
        color: "#111111",
      }),
    ).rejects.toMatchObject({ code: "BASE_FOLDER_PROTECTED" });
    expect(database.pageFolder.update).not.toHaveBeenCalled();
  });

  it("updates name, color, and parent atomically through updateFolder", async () => {
    const { database, folders } = createFolderDatabase();
    folders.push(
      { id: "root-a", name: "A", color: null, parentId: null, isBase: false },
      { id: "root-b", name: "B", color: null, parentId: null, isBase: false },
    );
    const service = new FolderService(database);

    const updated = await service.updateFolder("master-id", {
      id: "root-a",
      name: "Campaigns",
      color: "#abc",
      parentId: "root-b",
    });

    expect(updated).toMatchObject({
      id: "root-a",
      name: "Campaigns",
      color: "#AABBCC",
      parentId: "root-b",
    });
    expect(database.pageFolder.update).toHaveBeenCalledWith({
      where: { id: "root-a" },
      data: { name: "Campaigns", color: "#AABBCC", parentId: "root-b" },
    });
    expect(database.logEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "FOLDER_MOVED" }),
    });
  });

  it("rejects an invalid update parent before changing name or color", async () => {
    const { database, folders } = createFolderDatabase();
    folders.push(
      { id: "root-a", name: "A", color: null, parentId: null, isBase: false },
      {
        id: "child",
        name: "C",
        color: null,
        parentId: "root-a",
        isBase: false,
      },
    );
    const service = new FolderService(database);

    await expect(
      service.updateFolder("master-id", {
        id: "root-a",
        name: "Should not persist",
        color: "#abc",
        parentId: "child",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(database.pageFolder.update).not.toHaveBeenCalled();
    expect(folders.find((folder) => folder.id === "root-a")).toMatchObject({
      name: "A",
      color: null,
      parentId: null,
    });
  });

  it("promotes a folder to root through updateFolder", async () => {
    const { database, folders } = createFolderDatabase();
    folders.push(
      { id: "root-a", name: "A", color: null, parentId: null, isBase: false },
      {
        id: "child",
        name: "C",
        color: null,
        parentId: "root-a",
        isBase: false,
      },
    );
    const service = new FolderService(database);

    const updated = await service.updateFolder("master-id", {
      id: "child",
      parentId: null,
    });

    expect(updated.parentId).toBeNull();
    expect(database.pageFolder.update).toHaveBeenCalledWith({
      where: { id: "child" },
      data: { parentId: null },
    });
  });

  it("requires reassignToFolderId when deleting", async () => {
    const { database, folders } = createFolderDatabase();
    folders.push({
      id: "folder-id",
      name: "Campaigns",
      color: null,
      parentId: null,
      isBase: false,
    });
    const service = new FolderService(database);

    await expect(
      service.deleteFolder("master-id", { id: "folder-id" }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("moves pages from a folder subtree to the chosen reassign target", async () => {
    const { database, folders, pages } = createFolderDatabase();
    folders.push({
      id: "folder-id",
      name: "Campaigns",
      color: null,
      parentId: null,
      isBase: false,
    });
    folders.push({
      id: "child-id",
      name: "2026",
      color: null,
      parentId: "folder-id",
      isBase: false,
    });
    const service = new FolderService(database);

    await service.deleteFolder("master-id", {
      id: "folder-id",
      reassignToFolderId: "base-id",
    });

    expect(pages[0]?.folderId).toBe("base-id");
    expect(pages[1]?.folderId).toBe("base-id");
    expect(folders.find((folder) => folder.id === "folder-id")).toBeUndefined();
    expect(folders.find((folder) => folder.id === "child-id")).toBeUndefined();
  });

  it("rejects reassign into the deleted subtree", async () => {
    const { database, folders } = createFolderDatabase();
    folders.push(
      {
        id: "folder-id",
        name: "Campaigns",
        color: null,
        parentId: null,
        isBase: false,
      },
      {
        id: "child-id",
        name: "2026",
        color: null,
        parentId: "folder-id",
        isBase: false,
      },
    );
    const service = new FolderService(database);

    await expect(
      service.deleteFolder("master-id", {
        id: "folder-id",
        reassignToFolderId: "child-id",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("moves a folder under another root", async () => {
    const { database, folders } = createFolderDatabase();
    folders.push(
      { id: "root-a", name: "A", color: null, parentId: null, isBase: false },
      { id: "root-b", name: "B", color: null, parentId: null, isBase: false },
    );
    const service = new FolderService(database);

    const moved = await service.moveFolder("master-id", {
      id: "root-a",
      newParentId: "root-b",
    });

    expect(moved.parentId).toBe("root-b");
    expect(database.logEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "FOLDER_MOVED" }),
    });
  });

  it("rejects move into Base or own subtree", async () => {
    const { database, folders } = createFolderDatabase();
    folders.push(
      { id: "root-a", name: "A", color: null, parentId: null, isBase: false },
      {
        id: "child",
        name: "C",
        color: null,
        parentId: "root-a",
        isBase: false,
      },
    );
    const service = new FolderService(database);

    await expect(
      service.moveFolder("master-id", { id: "root-a", newParentId: "base-id" }),
    ).rejects.toMatchObject({ code: "BASE_FOLDER_PROTECTED" });

    await expect(
      service.moveFolder("master-id", { id: "root-a", newParentId: "child" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("promotes a folder to root when newParentId is null", async () => {
    const { database, folders } = createFolderDatabase();
    folders.push(
      { id: "root-a", name: "A", color: null, parentId: null, isBase: false },
      {
        id: "child",
        name: "C",
        color: null,
        parentId: "root-a",
        isBase: false,
      },
    );
    const service = new FolderService(database);

    const moved = await service.moveFolder("master-id", {
      id: "child",
      newParentId: null,
    });
    expect(moved.parentId).toBeNull();
  });
});
