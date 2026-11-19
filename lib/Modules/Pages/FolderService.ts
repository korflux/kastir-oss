import { prisma } from "@/lib/prisma";
import {
  createFolderSchema,
  deleteFolderSchema,
  moveFolderSchema,
  updateFolderSchema,
} from "@/lib/Modules/Pages/Schema";
import {
  PagesDomainError,
  type PageFolderRecord,
} from "@/lib/Modules/Pages/Types";
import { logEvent } from "@/lib/Logging/logEvent";
import type { LogEventContext } from "@/lib/Logging/logEvent";

type FolderWhere = { id?: string; isBase?: boolean; parentId?: string | null };

export type FolderDatabase = {
  pageFolder: {
    findFirst(args?: { where?: FolderWhere }): Promise<PageFolderRecord | null>;
    findUnique(args: {
      where: { id: string };
    }): Promise<PageFolderRecord | null>;
    findMany(args?: {
      where?: FolderWhere;
      skip?: number;
      take?: number;
    }): Promise<PageFolderRecord[]>;
    count?(args?: { where?: FolderWhere }): Promise<number>;
    create(args: {
      data: {
        name: string;
        color: string | null;
        parentId: string | null;
        isBase: boolean;
      };
    }): Promise<PageFolderRecord>;
    update(args: {
      where: { id: string };
      data: { name?: string; color?: string | null; parentId?: string | null };
    }): Promise<PageFolderRecord>;
    deleteMany(args: {
      where: { id: { in: string[] } };
    }): Promise<{ count: number }>;
  };
  page: {
    updateMany(args: {
      where: { folderId: { in: string[] } };
      data: { folderId: string };
    }): Promise<{ count: number }>;
  };
  logEntry: {
    create(args: {
      data: {
        userId: string;
        action: string;
        objectType: "FOLDER";
        objectLabel: string;
      };
    }): Promise<unknown>;
  };
  $transaction(
    callback: (tx: FolderDatabase) => Promise<unknown>,
  ): Promise<unknown>;
};

function validationError(message: string): PagesDomainError {
  return new PagesDomainError("VALIDATION_ERROR", message);
}

function requireParsed<T>(
  result: { success: true; data: T } | { success: false },
): T {
  if (!result.success) {
    throw validationError("Invalid folder data");
  }
  return result.data;
}

/** Profundidade até a raiz mais próxima (parentId null) — multi-raiz. */
export function folderDepth(
  folderId: string,
  folders: ReadonlyArray<Pick<PageFolderRecord, "id" | "parentId" | "isBase">>,
): number {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  let current = byId.get(folderId);
  if (!current) {
    throw new PagesDomainError("NOT_FOUND", "Parent folder was not found");
  }

  let depth = 0;
  const visited = new Set<string>();

  while (current) {
    if (visited.has(current.id)) {
      throw validationError("Folder tree contains a cycle");
    }
    visited.add(current.id);
    depth += 1;
    if (current.parentId === null) break;
    current = byId.get(current.parentId);
    if (!current) {
      throw new PagesDomainError("NOT_FOUND", "Parent folder was not found");
    }
  }

  return depth;
}

/** Subtree fechada (id + descendentes) — reuso em delete/listagem/move. */
export function collectSubtreeIds(
  rootId: string,
  folders: ReadonlyArray<Pick<PageFolderRecord, "id" | "parentId">>,
): string[] {
  const subtree = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (
        folder.parentId &&
        subtree.has(folder.parentId) &&
        !subtree.has(folder.id)
      ) {
        subtree.add(folder.id);
        changed = true;
      }
    }
  }
  return [...subtree];
}

/** Altura da subtree com a raiz contando como 1. */
function subtreeHeight(
  rootId: string,
  folders: ReadonlyArray<Pick<PageFolderRecord, "id" | "parentId">>,
): number {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  let maxRel = 1;
  for (const id of collectSubtreeIds(rootId, folders)) {
    let d = 0;
    let cur = byId.get(id);
    while (cur && cur.id !== rootId) {
      d += 1;
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    maxRel = Math.max(maxRel, d + 1);
  }
  return maxRel;
}

/** Valida uma mudança de parent para update e move no mesmo limite da árvore. */
function validateFolderParentChange(
  existing: PageFolderRecord,
  newParentId: string | null,
  folders: PageFolderRecord[],
): void {
  if (existing.isBase) {
    throw new PagesDomainError(
      "BASE_FOLDER_PROTECTED",
      "The Base folder cannot be moved",
    );
  }
  if (newParentId === existing.parentId) return;

  const height = subtreeHeight(existing.id, folders);
  if (newParentId !== null) {
    const parent = folders.find((folder) => folder.id === newParentId);
    if (!parent) {
      throw new PagesDomainError("NOT_FOUND", "Parent folder was not found");
    }
    if (parent.isBase) {
      throw new PagesDomainError(
        "BASE_FOLDER_PROTECTED",
        "The Base folder cannot have child folders",
      );
    }
    if (collectSubtreeIds(existing.id, folders).includes(newParentId)) {
      throw validationError("Cannot move a folder into its own subtree");
    }
    if (folderDepth(parent.id, folders) + height > 3) {
      throw new PagesDomainError(
        "FOLDER_DEPTH_EXCEEDED",
        "Folders can be nested up to three levels",
      );
    }
  } else if (height > 3) {
    throw new PagesDomainError(
      "FOLDER_DEPTH_EXCEEDED",
      "Folders can be nested up to three levels",
    );
  }
}

export class FolderService {
  constructor(
    private readonly database: FolderDatabase = prisma as unknown as FolderDatabase,
  ) {}

  private transaction<T>(
    callback: (tx: FolderDatabase) => Promise<T>,
  ): Promise<T> {
    return this.database.$transaction(callback) as Promise<T>;
  }

  async listFolders(): Promise<PageFolderRecord[]> {
    return this.database.pageFolder.findMany();
  }

  async listFoldersPage(options: {
    parentId?: string;
    skip: number;
    take: number;
  }): Promise<{ items: PageFolderRecord[]; total: number }> {
    if (!this.database.pageFolder.count) {
      throw new Error("Folder pagination is unavailable");
    }

    const where = options.parentId ? { parentId: options.parentId } : undefined;
    const [items, total] = await Promise.all([
      this.database.pageFolder.findMany({
        where,
        skip: options.skip,
        take: options.take,
      }),
      this.database.pageFolder.count({ where }),
    ]);

    return { items, total };
  }

  async createFolder(
    userId: string,
    input: unknown,
    audit?: LogEventContext,
  ): Promise<PageFolderRecord> {
    const parsed = requireParsed(createFolderSchema.safeParse(input));

    return this.transaction(async (tx) => {
      // parentId nulo/omitido = raiz independente (não cai mais em Base).
      const parentId = parsed.parentId ?? null;

      if (parentId !== null) {
        const parent = await tx.pageFolder.findUnique({
          where: { id: parentId },
        });
        if (!parent) {
          throw new PagesDomainError(
            "NOT_FOUND",
            "Parent folder was not found",
          );
        }
        if (parent.isBase) {
          throw new PagesDomainError(
            "BASE_FOLDER_PROTECTED",
            "The Base folder cannot have child folders",
          );
        }

        const folders = await tx.pageFolder.findMany();
        if (folderDepth(parent.id, folders) >= 3) {
          throw new PagesDomainError(
            "FOLDER_DEPTH_EXCEEDED",
            "Folders can be nested up to three levels",
          );
        }
      }

      const folder = await tx.pageFolder.create({
        data: {
          name: parsed.name,
          color: parsed.color ?? null,
          parentId,
          isBase: false,
        },
      });

      await logEvent(tx, {
        userId,
        action: "FOLDER_CREATED",
        objectType: "FOLDER",
        objectLabel: folder.name,
        objectId: folder.id,
        ...audit,
      });

      return folder;
    });
  }

  async updateFolder(
    userId: string,
    input: unknown,
    audit?: LogEventContext,
  ): Promise<PageFolderRecord> {
    const parsed = requireParsed(updateFolderSchema.safeParse(input));

    return this.transaction(async (tx) => {
      const existing = await tx.pageFolder.findUnique({
        where: { id: parsed.id },
      });
      if (!existing) {
        throw new PagesDomainError("NOT_FOUND", "Folder was not found");
      }
      const previousParentId = existing.parentId;
      if (
        existing.isBase &&
        (parsed.name !== undefined ||
          parsed.color !== undefined ||
          parsed.parentId !== undefined)
      ) {
        throw new PagesDomainError(
          "BASE_FOLDER_PROTECTED",
          "The Base folder cannot be renamed or recolored",
        );
      }

      const parentChanged = parsed.parentId !== undefined;
      const parentId = parsed.parentId ?? null;
      if (parentChanged) {
        const folders = await tx.pageFolder.findMany();
        validateFolderParentChange(existing, parentId, folders);
      }

      const data: {
        name?: string;
        color?: string | null;
        parentId?: string | null;
      } = {};
      if (parsed.name !== undefined) data.name = parsed.name;
      if (parsed.color !== undefined) data.color = parsed.color;
      if (parentChanged) data.parentId = parentId;

      const folder = Object.keys(data).length
        ? await tx.pageFolder.update({ where: { id: existing.id }, data })
        : existing;

      if (parsed.name !== undefined) {
        await logEvent(tx, {
          userId,
          action: "FOLDER_RENAMED",
          objectType: "FOLDER",
          objectLabel: folder.name,
          objectId: folder.id,
          ...audit,
        });
      }
      if (parsed.color !== undefined) {
        await logEvent(tx, {
          userId,
          action: "FOLDER_RECOLORED",
          objectType: "FOLDER",
          objectLabel: folder.name,
          objectId: folder.id,
          ...audit,
        });
      }
      if (parentChanged && parentId !== previousParentId) {
        await logEvent(tx, {
          userId,
          action: "FOLDER_MOVED",
          objectType: "FOLDER",
          objectLabel: folder.name,
          objectId: folder.id,
          ...audit,
        });
      }

      return folder;
    });
  }

  async moveFolder(
    userId: string,
    input: unknown,
    audit?: LogEventContext,
  ): Promise<PageFolderRecord> {
    const parsed = requireParsed(moveFolderSchema.safeParse(input));

    return this.transaction(async (tx) => {
      const existing = await tx.pageFolder.findUnique({
        where: { id: parsed.id },
      });
      if (!existing) {
        throw new PagesDomainError("NOT_FOUND", "Folder was not found");
      }

      const newParentId = parsed.newParentId ?? null;
      if (newParentId === existing.parentId) {
        return existing;
      }

      const folders = await tx.pageFolder.findMany();
      validateFolderParentChange(existing, newParentId, folders);

      const folder = await tx.pageFolder.update({
        where: { id: existing.id },
        data: { parentId: newParentId },
      });

      await logEvent(tx, {
        userId,
        action: "FOLDER_MOVED",
        objectType: "FOLDER",
        objectLabel: folder.name,
        objectId: folder.id,
        ...audit,
      });

      return folder;
    });
  }

  async deleteFolder(
    userId: string,
    input: unknown,
    audit?: LogEventContext,
  ): Promise<void> {
    const parsed = deleteFolderSchema.safeParse(input);
    if (!parsed.success) {
      throw validationError(
        "reassignToFolderId is required when deleting a folder",
      );
    }
    const { id: folderId, reassignToFolderId } = parsed.data;

    await this.transaction(async (tx) => {
      const target = await tx.pageFolder.findUnique({
        where: { id: folderId },
      });
      if (!target) {
        throw new PagesDomainError("NOT_FOUND", "Folder was not found");
      }
      if (target.isBase) {
        throw new PagesDomainError(
          "BASE_FOLDER_PROTECTED",
          "The Base folder cannot be deleted",
        );
      }

      const reassignTarget = await tx.pageFolder.findUnique({
        where: { id: reassignToFolderId },
      });
      if (!reassignTarget) {
        throw new PagesDomainError(
          "NOT_FOUND",
          "Reassign target folder was not found",
        );
      }

      const folders = await tx.pageFolder.findMany();
      const ids = collectSubtreeIds(folderId, folders);

      if (ids.includes(reassignToFolderId)) {
        throw validationError(
          "Cannot reassign pages into a folder being deleted",
        );
      }

      await tx.page.updateMany({
        where: { folderId: { in: ids } },
        data: { folderId: reassignToFolderId },
      });
      await tx.pageFolder.deleteMany({ where: { id: { in: ids } } });
      await logEvent(tx, {
        userId,
        action: "FOLDER_DELETED",
        objectType: "FOLDER",
        objectLabel: target.name,
        objectId: target.id,
        ...audit,
      });
    });
  }
}

export const folderService = new FolderService();
