import { join, resolve, sep } from "node:path";

import {
  BACKUP_DIR_NAME,
  BACKUP_PUBLIC_URL_PREFIX,
} from "@/lib/Modules/Backup/constants";

function getDefaultPublicDir(): string {
  // Volume configurável pelo ambiente; não deixar o tracer seguir um caminho
  // arbitrário e incluir o projeto inteiro no artefato standalone.
  return resolve(
    /*turbopackIgnore: true*/
    process.env.PUBLIC_DIR ?? join(process.cwd(), "public"),
  );
}

/**
 * Canonical on-disk root for local snapshots.
 * Lives under public/_kastir/backups so Docker volume /app/public persists it,
 * but Nginx must deny the URL prefix (see nginx.conf + docker-config tests).
 */
export function getBackupRoot(publicDir = getDefaultPublicDir()): string {
  return resolve(publicDir, "_kastir", BACKUP_DIR_NAME);
}

export function getBackupJobsDir(publicDir = getDefaultPublicDir()): string {
  return join(getBackupRoot(publicDir), ".jobs");
}

export function getBackupPublicUrlPrefix(): string {
  return BACKUP_PUBLIC_URL_PREFIX;
}

/** Id de snapshot/job: só basename seguro — sem `/`, `\\` ou `..`. */
export function assertSafeBackupId(id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error("Invalid backup id");
  }
  return id;
}

export function assertWithinBackupRoot(root: string, target: string): string {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  const rootWithSep = resolvedRoot.endsWith(sep)
    ? resolvedRoot
    : `${resolvedRoot}${sep}`;

  if (
    resolvedTarget !== resolvedRoot &&
    !resolvedTarget.startsWith(rootWithSep)
  ) {
    throw new Error("Backup path escapes backup root");
  }

  return resolvedTarget;
}
