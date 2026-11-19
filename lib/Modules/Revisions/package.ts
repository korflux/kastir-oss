/**
 * Recorte do pacote de backup: só revisões live. O histórico completo
 * fica no banco local e não viaja no export.
 */

export function liveRevisionsForExport<TRevision extends { id: string }>(
  resources: ReadonlyArray<{ publishedRevisionId: string | null }>,
  revisions: ReadonlyArray<TRevision>,
): TRevision[] {
  const live = new Set(
    resources
      .map((resource) => resource.publishedRevisionId)
      .filter((id): id is string => Boolean(id)),
  );
  return revisions.filter((revision) => live.has(revision.id));
}

export function stripPublishedPointerForInsert<
  T extends { publishedRevisionId?: unknown },
>(record: T): Omit<T, "publishedRevisionId"> {
  const { publishedRevisionId: _pointer, ...rest } = record;
  void _pointer;
  return rest;
}
