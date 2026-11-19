import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

export function getMediaPublicRoot(publicDir = getDefaultPublicDir()): string {
  return resolve(publicDir, "uploads");
}

function getDefaultPublicDir(): string {
  // Volumes são configuráveis apenas pelo ambiente; não devem virar trace de
  // arquivos arbitrários durante o empacotamento do servidor.
  return resolve(
    /*turbopackIgnore: true*/
    process.env.PUBLIC_DIR ?? join(process.cwd(), "public"),
  );
}

function getDefaultStagingDir(): string {
  return resolve(
    /*turbopackIgnore: true*/
    process.env.MEDIA_STAGING_DIR ?? join(process.cwd(), ".media-staging"),
  );
}

/** Segmento de path (id/nome): sem `..`, `/`, `\\` ou NUL. Guard canônico — MediaApply reusa. */
export function assertSafeSegment(value: string, label: string): string {
  if (
    !value ||
    value === "." ||
    value === ".." ||
    value.includes("\0") ||
    value.includes("/") ||
    value.includes("\\") ||
    value.length > 255
  ) {
    throw new Error(`${label} is not safe`);
  }

  return value;
}

/** Resolve + prefixo com separador. Mais estrito que igualdade de root (não aceita o root em si). */
export function assertWithinRoot(root: string, target: string): string {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  const rootWithSeparator = resolvedRoot.endsWith(sep)
    ? resolvedRoot
    : `${resolvedRoot}${sep}`;

  if (!resolvedTarget.startsWith(rootWithSeparator)) {
    throw new Error("Media path is not safe");
  }

  return resolvedTarget;
}

export function getMediaFilePath(
  publicDir: string,
  mediaFileId: string,
  fileName: string,
): string {
  assertSafeSegment(mediaFileId, "Media file id");
  assertSafeSegment(fileName, "File name");

  return assertWithinRoot(
    getMediaPublicRoot(publicDir),
    join(getMediaPublicRoot(publicDir), mediaFileId, fileName),
  );
}

function getStagingPath(stagingDir: string, stagingKey: string): string {
  assertSafeSegment(stagingKey, "Staging key");
  return assertWithinRoot(stagingDir, join(stagingDir, stagingKey));
}

async function writeAtomically(target: string, data: Buffer): Promise<void> {
  const directory = dirname(target);
  const temporary = join(directory, `.${randomUUID()}.tmp`);
  await mkdir(directory, { recursive: true });

  try {
    await writeFile(temporary, data, { flag: "wx" });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

export type MediaStorage = {
  writePublic(
    mediaFileId: string,
    fileName: string,
    data: Buffer,
  ): Promise<void>;
  readPublic(mediaFileId: string, fileName: string): Promise<Buffer | null>;
  /** Cheap existence check (stat, no bytes read) for readiness reconciliation. */
  existsPublic(mediaFileId: string, fileName: string): Promise<boolean>;
  removePublic(mediaFileId: string, fileName: string): Promise<void>;
  /**
   * Atomically moves a pending public object onto the final public name
   * (overwriting any previous file). Used so WebP jobs only expose output
   * after a conditional DB claim succeeds.
   */
  promotePublic(
    mediaFileId: string,
    fromFileName: string,
    toFileName: string,
  ): Promise<void>;
  writeStaging(stagingKey: string, data: Buffer): Promise<void>;
  readStaging(stagingKey: string): Promise<Buffer>;
  removeStaging(stagingKey: string): Promise<void>;
};

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

export function createMediaStorage(
  publicDir = getDefaultPublicDir(),
  stagingDir = getDefaultStagingDir(),
): MediaStorage {
  const privateRoot = resolve(stagingDir);

  return {
    async writePublic(mediaFileId, fileName, data) {
      await writeAtomically(
        getMediaFilePath(publicDir, mediaFileId, fileName),
        data,
      );
    },

    async readPublic(mediaFileId, fileName) {
      try {
        return await readFile(
          getMediaFilePath(publicDir, mediaFileId, fileName),
        );
      } catch (error) {
        if (isMissingFile(error)) return null;
        throw error;
      }
    },

    async existsPublic(mediaFileId, fileName) {
      try {
        await stat(getMediaFilePath(publicDir, mediaFileId, fileName));
        return true;
      } catch (error) {
        if (isMissingFile(error)) return false;
        throw error;
      }
    },

    async removePublic(mediaFileId, fileName) {
      const target = getMediaFilePath(publicDir, mediaFileId, fileName);
      await rm(target, { force: true });
      try {
        await rmdir(dirname(target));
      } catch (error) {
        if (
          !isMissingFile(error) &&
          !(
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            (error as { code?: unknown }).code === "ENOTEMPTY"
          )
        ) {
          throw error;
        }
      }
    },

    async promotePublic(mediaFileId, fromFileName, toFileName) {
      const from = getMediaFilePath(publicDir, mediaFileId, fromFileName);
      const to = getMediaFilePath(publicDir, mediaFileId, toFileName);
      // Windows rename fails when the destination already exists.
      await rm(to, { force: true });
      await rename(from, to);
    },

    async writeStaging(stagingKey, data) {
      await writeAtomically(getStagingPath(privateRoot, stagingKey), data);
    },

    async readStaging(stagingKey) {
      return readFile(getStagingPath(privateRoot, stagingKey));
    },

    async removeStaging(stagingKey) {
      await rm(getStagingPath(privateRoot, stagingKey), { force: true });
    },
  };
}
