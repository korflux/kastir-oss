import { PACKAGE_DATA_FILES } from "@/lib/Modules/Backup/constants";
import { buildManifest } from "@/lib/Modules/Backup/Manifest";
import type {
  BuiltPackage,
  PackageAsset,
  PackageCounts,
  PackageDataMap,
  PackageIncludes,
} from "@/lib/Modules/Backup/Types";
import {
  sha256Hex,
  writeZip,
  type ZipEntryInput,
} from "@/lib/Modules/Backup/Zip";

export type PackageWriterInput = {
  origin: string;
  siteTitle: string;
  data: PackageDataMap;
  assets: PackageAsset[];
  includes?: Partial<PackageIncludes>;
  kastirVersion?: string;
  schemaVersion?: string;
};

function defaultIncludes(data: PackageDataMap): PackageIncludes {
  return {
    pages: data["pages.json"] != null,
    media: data["media.json"] != null,
    settings: data["settings.json"] != null,
    customCode: data["custom-code.json"] != null,
    splitTests: data["split-tests.json"] != null,
    users: data["users.json"] != null,
    publishedHtml: false,
  };
}

function computeCounts(
  data: PackageDataMap,
  assets: PackageAsset[],
): PackageCounts {
  const pages = Array.isArray(data["pages.json"])
    ? data["pages.json"].length
    : 0;
  const mediaFiles = Array.isArray(data["media.json"])
    ? data["media.json"].length
    : 0;
  const usersPayload = data["users.json"] as { users?: unknown[] } | undefined;
  const users = Array.isArray(usersPayload?.users)
    ? usersPayload.users.length
    : Array.isArray(data["users.json"])
      ? (data["users.json"] as unknown[]).length
      : 0;
  const assetBytes = assets.reduce((sum, a) => sum + a.bytes.length, 0);
  return { pages, mediaFiles, assetBytes, users };
}

export function buildSitePackage(input: PackageWriterInput): BuiltPackage {
  const includes = {
    ...defaultIncludes(input.data),
    ...input.includes,
  };
  const counts = computeCounts(input.data, input.assets);
  const checksums: Record<string, string> = {};
  const zipEntries: ZipEntryInput[] = [];

  for (const file of PACKAGE_DATA_FILES) {
    if (input.data[file] === undefined) continue;
    const path = `data/${file}`;
    const bytes = Buffer.from(JSON.stringify(input.data[file]), "utf8");
    checksums[path] = sha256Hex(bytes);
    zipEntries.push({ path, data: bytes, compress: true });
  }

  for (const asset of input.assets) {
    const path =
      asset.zipPath || `assets/uploads/${asset.mediaId}/${asset.fileName}`;
    checksums[path] = sha256Hex(asset.bytes);
    zipEntries.push({ path, data: asset.bytes, compress: false });
  }

  const manifest = buildManifest({
    origin: input.origin,
    siteTitle: input.siteTitle,
    includes,
    counts,
    checksums,
    kastirVersion: input.kastirVersion,
    schemaVersion: input.schemaVersion,
    secretsOmitted: true,
  });

  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
  zipEntries.unshift({
    path: "manifest.json",
    data: manifestBytes,
    compress: true,
  });

  const zipBytes = writeZip(zipEntries);
  return {
    manifest,
    data: input.data,
    assets: input.assets,
    zipBytes,
  };
}
