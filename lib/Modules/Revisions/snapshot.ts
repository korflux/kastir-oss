/**
 * Comparação e retenção de snapshots completos.
 * Completos (não deltas) para diff/restore sem cadeia de patches;
 * fingerprint estável evita clonar revisão idêntica já persistida.
 */
import { createHash } from "node:crypto";

import { effectiveRevisionRetentionLimit } from "@/lib/Modules/Settings/revisionRetention";
import type {
  PageSnapshot,
  RevisionRetentionCandidate,
  SnippetSnapshot,
} from "@/lib/Modules/Revisions/Types";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sortedPageIds(pageIds: readonly string[]): string[] {
  return [...pageIds].sort((left, right) => left.localeCompare(right));
}

export function pageSnapshotFingerprint(snapshot: PageSnapshot): string {
  return sha256(
    JSON.stringify({
      title: snapshot.title,
      slug: snapshot.slug,
      content: snapshot.content,
      seoTitle: snapshot.seoTitle,
      seoDescription: snapshot.seoDescription,
      seoKeyword: snapshot.seoKeyword,
      folderId: snapshot.folderId,
    }),
  );
}

export function snippetSnapshotFingerprint(snapshot: SnippetSnapshot): string {
  return sha256(
    JSON.stringify({
      name: snapshot.name,
      location: snapshot.location,
      content: snapshot.content,
      priority: snapshot.priority,
      scopeType: snapshot.scopeType,
      pageIds: sortedPageIds(snapshot.pageIds),
      triggerType: snapshot.triggerType,
      triggerConfig: snapshot.triggerConfig,
      maxDisplays: snapshot.maxDisplays,
      displayResetDays: snapshot.displayResetDays,
    }),
  );
}

export function pageSnapshotsEqual(
  left: PageSnapshot,
  right: PageSnapshot,
): boolean {
  return pageSnapshotFingerprint(left) === pageSnapshotFingerprint(right);
}

export function snippetSnapshotsEqual(
  left: SnippetSnapshot,
  right: SnippetSnapshot,
): boolean {
  return snippetSnapshotFingerprint(left) === snippetSnapshotFingerprint(right);
}

/**
 * IDs que o job de retenção pode apagar: fora da janela normal, sem pin e
 * sem ser a live. Fixada dentro da janela não conta de novo como extra.
 */
export function selectRevisionsToPurge(input: {
  revisions: readonly RevisionRetentionCandidate[];
  publishedRevisionId: string | null;
  normalLimit: number;
}): string[] {
  const limit = effectiveRevisionRetentionLimit(input.normalLimit);
  const sorted = [...input.revisions].sort((left, right) => {
    const byDate = right.createdAt.getTime() - left.createdAt.getTime();
    return byDate !== 0 ? byDate : left.id.localeCompare(right.id);
  });
  const keep = new Set(sorted.slice(0, limit).map((revision) => revision.id));
  if (input.publishedRevisionId) keep.add(input.publishedRevisionId);
  for (const revision of sorted) {
    if (revision.pinned) keep.add(revision.id);
  }
  return sorted
    .filter((revision) => !keep.has(revision.id))
    .map((revision) => revision.id);
}
