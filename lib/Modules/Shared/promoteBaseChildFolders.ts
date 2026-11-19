/**
 * Scope 3 migration helper — promove filhos diretos de Base a raízes
 * independentes (parentId = null). Idempotente. Sem colunas novas.
 */

export type PromoteFolderRow = {
  id: string;
  parentId: string | null;
  isBase: boolean;
};

export type PromoteFolderWriter = {
  findMany(): Promise<PromoteFolderRow[]>;
  updateMany(args: {
    where: { parentId: string };
    data: { parentId: null };
  }): Promise<{ count: number }>;
};

export async function promoteBaseChildFolders(
  writer: PromoteFolderWriter,
): Promise<{ baseId: string | null; promoted: number }> {
  const folders = await writer.findMany();
  const base = folders.find((folder) => folder.isBase);
  if (!base) {
    return { baseId: null, promoted: 0 };
  }

  const result = await writer.updateMany({
    where: { parentId: base.id },
    data: { parentId: null },
  });

  return { baseId: base.id, promoted: result.count };
}
