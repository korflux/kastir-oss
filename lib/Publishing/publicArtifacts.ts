import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import { getPublicDir } from "@/lib/Publishing/fileStore";

const allowedArtifacts = new Set([
  "index.html",
  "robots.txt",
  "sitemap.xml",
  "llms.txt",
  "404.html",
  ".notfound-redirect",
]);

export function getPublicArtifactPath(publicDir: string, name: string): string {
  if (!allowedArtifacts.has(name)) throw new Error("Invalid public artifact");
  const root = resolve(publicDir);
  const target = resolve(root, name);
  const rootWithSeparator = root.endsWith(sep) ? root : `${root}${sep}`;
  if (!target.startsWith(rootWithSeparator))
    throw new Error("Artifact path escapes public directory");
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

export async function readPublicArtifact(
  name: string,
  publicDir = getPublicDir(),
): Promise<string | null> {
  try {
    return await readFile(getPublicArtifactPath(publicDir, name), "utf8");
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

export async function writePublicArtifact(
  name: string,
  content: string,
  publicDir = getPublicDir(),
): Promise<void> {
  const target = getPublicArtifactPath(publicDir, name);
  const directory = dirname(target);
  const temporary = join(directory, `.${name}.${randomUUID()}.tmp`);
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(temporary, content, "utf8");
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function removePublicArtifact(
  name: string,
  publicDir = getPublicDir(),
): Promise<void> {
  await rm(getPublicArtifactPath(publicDir, name), { force: true });
}
