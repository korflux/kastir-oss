import { PACKAGE_DATA_FILES } from "@/lib/Modules/Backup/constants";
import { parseSitePackageManifest } from "@/lib/Modules/Backup/Schema";
import type {
  PackageAsset,
  PackageDataMap,
  SitePackageManifest,
} from "@/lib/Modules/Backup/Types";
import {
  assertZipBufferWithinLimits,
  readZip,
  sha256Hex,
} from "@/lib/Modules/Backup/Zip";

export type OpenedPackage = {
  manifest: SitePackageManifest;
  data: PackageDataMap;
  assets: PackageAsset[];
};

export class PackageReaderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PackageReaderError";
  }
}

export function openSitePackage(zipBytes: Buffer): OpenedPackage {
  let entries;
  try {
    assertZipBufferWithinLimits(zipBytes);
    entries = readZip(zipBytes);
  } catch (error) {
    throw new PackageReaderError(
      "INVALID_ZIP",
      error instanceof Error ? error.message : "Invalid zip",
    );
  }

  const byPath = new Map(entries.map((e) => [e.path, e.data]));
  const manifestRaw = byPath.get("manifest.json");
  if (!manifestRaw) {
    throw new PackageReaderError(
      "MISSING_MANIFEST",
      "manifest.json is missing",
    );
  }

  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(manifestRaw.toString("utf8"));
  } catch {
    throw new PackageReaderError(
      "INVALID_MANIFEST",
      "manifest.json is not valid JSON",
    );
  }

  const parsed = parseSitePackageManifest(manifestJson);
  if (!parsed.success) {
    throw new PackageReaderError(
      "INVALID_MANIFEST",
      "manifest.json failed schema validation",
    );
  }

  const manifest = parsed.data;
  const expectedManifestHash = manifest.checksums["manifest.json"];
  // Manifest cannot checksum itself reliably before finalization; optional.
  if (expectedManifestHash && expectedManifestHash !== sha256Hex(manifestRaw)) {
    // Allow mismatch only if not listed — if listed, enforce.
    throw new PackageReaderError(
      "CHECKSUM_MISMATCH",
      "Checksum failed for manifest.json",
    );
  }

  for (const [path, expected] of Object.entries(manifest.checksums)) {
    if (path === "manifest.json") continue;
    const bytes = byPath.get(path);
    if (!bytes) {
      throw new PackageReaderError(
        "CHECKSUM_MISMATCH",
        `Missing file listed in checksums: ${path}`,
      );
    }
    if (sha256Hex(bytes) !== expected) {
      throw new PackageReaderError(
        "CHECKSUM_MISMATCH",
        `Checksum failed for ${path}`,
      );
    }
  }

  const data: PackageDataMap = {};
  for (const file of PACKAGE_DATA_FILES) {
    const zipPath = `data/${file}`;
    const bytes = byPath.get(zipPath);
    if (!bytes) continue;
    try {
      data[file] = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new PackageReaderError(
        "INVALID_DATA",
        `Invalid JSON in ${zipPath}`,
      );
    }
  }

  const assets: PackageAsset[] = [];
  for (const [path, bytes] of byPath) {
    const match = path.match(/^assets\/uploads\/([^/]+)\/([^/]+)$/);
    if (!match) continue;
    assets.push({
      zipPath: path,
      mediaId: match[1]!,
      fileName: match[2]!,
      bytes,
    });
  }

  return { manifest, data, assets };
}
