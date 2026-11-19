import packageJson from "@/package.json";

import {
  CURRENT_SCHEMA_VERSION,
  PACKAGE_FORMAT,
  PACKAGE_FORMAT_VERSION,
} from "@/lib/Modules/Backup/constants";
import type {
  PackageCounts,
  PackageIncludes,
  SitePackageManifest,
} from "@/lib/Modules/Backup/Types";
import { normalizePublicOrigin } from "@/lib/Modules/Settings/publicOrigin";

export function getInstallKastirVersion(): string {
  return packageJson.version;
}

export function getInstallSchemaVersion(): string {
  return CURRENT_SCHEMA_VERSION;
}

export function buildManifest(input: {
  origin: string;
  siteTitle: string;
  includes: PackageIncludes;
  counts: PackageCounts;
  checksums: Record<string, string>;
  createdAt?: string;
  kastirVersion?: string;
  schemaVersion?: string;
  secretsOmitted?: boolean;
}): SitePackageManifest {
  return {
    format: PACKAGE_FORMAT,
    packageFormatVersion: PACKAGE_FORMAT_VERSION,
    kastirVersion: input.kastirVersion ?? getInstallKastirVersion(),
    schemaVersion: input.schemaVersion ?? getInstallSchemaVersion(),
    createdAt: input.createdAt ?? new Date().toISOString(),
    origin: normalizePublicOrigin(input.origin),
    siteTitle: input.siteTitle,
    includes: input.includes,
    counts: input.counts,
    checksums: input.checksums,
    secretsOmitted: input.secretsOmitted ?? true,
  };
}
