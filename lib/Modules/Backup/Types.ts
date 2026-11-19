import type { PackageDataFile } from "@/lib/Modules/Backup/constants";

export type PackageIncludes = {
  pages: boolean;
  media: boolean;
  settings: boolean;
  customCode: boolean;
  splitTests: boolean;
  users: boolean;
  publishedHtml: boolean;
};

export type PackageCounts = {
  pages: number;
  mediaFiles: number;
  assetBytes: number;
  users: number;
};

export type SitePackageManifest = {
  format: "kastir-site-package";
  packageFormatVersion: number;
  kastirVersion: string;
  schemaVersion: string;
  createdAt: string;
  origin: string;
  siteTitle: string;
  includes: PackageIncludes;
  counts: PackageCounts;
  checksums: Record<string, string>;
  secretsOmitted?: boolean;
};

export type CompatibilityLevel = "ok" | "warn" | "block";

export type CompatibilityIssue = {
  level: CompatibilityLevel;
  code: string;
  message: string;
};

export type CompatibilityResult = {
  level: CompatibilityLevel;
  issues: CompatibilityIssue[];
};

export type SnapshotMeta = {
  id: string;
  fileName: string;
  createdAt: string;
  sizeBytes: number;
  kastirVersion: string;
  schemaVersion: string;
  origin: string;
  siteTitle: string;
  /** When true, snapshot is held during an in-flight restore/import. */
  safety?: boolean;
};

export type BackupJobStatus =
  "queued" | "running" | "ready" | "failed" | "cancelled";

export type BackupJobKind = "export" | "import" | "restore";

export type BackupJobRecord = {
  id: string;
  kind: BackupJobKind;
  status: BackupJobStatus;
  progress: number;
  message?: string;
  error?: string;
  snapshotId?: string;
  /** Absolute path to a staged import package on disk. */
  packagePath?: string;
  createdAt: string;
  updatedAt: string;
  userId: string;
  /** Dry-run summary for import before confirm. */
  dryRun?: {
    replacements: number;
    warnings: CompatibilityIssue[];
    sourceOrigin: string;
    targetOrigin: string;
  };
};

export type UrlRewriteStats = {
  replacements: number;
};

export type PackageDataMap = Partial<Record<PackageDataFile, unknown>>;

export type PackageAsset = {
  /** Path inside zip: assets/uploads/{mediaId}/{fileName} */
  zipPath: string;
  mediaId: string;
  fileName: string;
  bytes: Buffer;
};

export type BuiltPackage = {
  manifest: SitePackageManifest;
  data: PackageDataMap;
  assets: PackageAsset[];
  zipBytes: Buffer;
};
