import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import { assertPublishableSlug } from "@/lib/Modules/Pages/slug";

export type PageFileStore = {
  read(slug: string): Promise<string | null>;
  write(slug: string, content: string): Promise<void>;
  remove(slug: string): Promise<void>;
};

export function getPublicDir(): string {
  // O diretório pode vir do volume de runtime; o comentário impede o tracer
  // de expandir esse caminho arbitrário para o projeto inteiro.
  return resolve(
    /*turbopackIgnore: true*/
    process.env.PUBLIC_DIR ?? join(process.cwd(), "public"),
  );
}

export function getPageFilePath(publicDir: string, slug: string): string {
  const canonicalSlug = assertPublishableSlug(slug);
  const root = resolve(publicDir);
  const target = resolve(root, canonicalSlug, "index.html");
  const rootWithSeparator = root.endsWith(sep) ? root : `${root}${sep}`;

  if (!target.startsWith(rootWithSeparator)) {
    throw new Error("Page path escapes the public directory");
  }

  return target;
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

export function createPageFileStore(publicDir = getPublicDir()): PageFileStore {
  const root = resolve(publicDir);

  return {
    async read(slug) {
      const target = getPageFilePath(root, slug);
      try {
        return await readFile(target, "utf8");
      } catch (error) {
        if (isMissingFile(error)) return null;
        throw error;
      }
    },

    async write(slug, content) {
      const target = getPageFilePath(root, slug);
      const directory = dirname(target);
      const temporary = join(directory, `.index-${randomUUID()}.tmp`);
      await mkdir(directory, { recursive: true });

      try {
        await writeFile(temporary, content, "utf8");
        await rename(temporary, target);
      } finally {
        await rm(temporary, { force: true });
      }
    },

    async remove(slug) {
      const target = getPageFilePath(root, slug);
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
  };
}
