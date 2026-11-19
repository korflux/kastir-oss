import {
  CURRENT_SCHEMA_VERSION,
  PACKAGE_FORMAT_VERSION,
} from "@/lib/Modules/Backup/constants";
import type {
  CompatibilityIssue,
  CompatibilityResult,
  SitePackageManifest,
} from "@/lib/Modules/Backup/Types";

function maxLevel(issues: CompatibilityIssue[]): CompatibilityResult["level"] {
  if (issues.some((i) => i.level === "block")) return "block";
  if (issues.some((i) => i.level === "warn")) return "warn";
  return "ok";
}

/**
 * Compare package manifest against the running installation.
 * packageFormatVersion major (currently the integer itself) must match.
 * Schema: package newer than install → block; package older → warn.
 */
export function evaluatePackageCompatibility(
  manifest: Pick<
    SitePackageManifest,
    "packageFormatVersion" | "schemaVersion" | "kastirVersion"
  >,
  install: {
    packageFormatVersion?: number;
    schemaVersion?: string;
    kastirVersion?: string;
  } = {},
): CompatibilityResult {
  const supportedFormat =
    install.packageFormatVersion ?? PACKAGE_FORMAT_VERSION;
  const installSchema = install.schemaVersion ?? CURRENT_SCHEMA_VERSION;
  const installApp = install.kastirVersion;
  const issues: CompatibilityIssue[] = [];

  if (manifest.packageFormatVersion !== supportedFormat) {
    issues.push({
      level: "block",
      code: "PACKAGE_FORMAT_INCOMPATIBLE",
      message: `Package format version ${manifest.packageFormatVersion} is not supported (expected ${supportedFormat}).`,
    });
  }

  if (manifest.schemaVersion > installSchema) {
    issues.push({
      level: "block",
      code: "SCHEMA_NEWER_THAN_INSTALL",
      message:
        "This backup was created on a newer Kastir schema. Update this server before importing.",
    });
  } else if (manifest.schemaVersion < installSchema) {
    issues.push({
      level: "warn",
      code: "SCHEMA_OLDER_THAN_INSTALL",
      message:
        "This backup was created on an older schema. Import may drop fields that no longer exist.",
    });
  }

  if (installApp && manifest.kastirVersion !== installApp) {
    issues.push({
      level: "warn",
      code: "KASTIR_VERSION_MISMATCH",
      message: `Backup Kastir ${manifest.kastirVersion} differs from this install ${installApp}.`,
    });
  }

  return { level: maxLevel(issues), issues };
}
