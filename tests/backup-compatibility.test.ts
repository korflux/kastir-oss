import { describe, expect, it } from "vitest";

import { evaluatePackageCompatibility } from "@/lib/Modules/Backup/Compatibility";
import { parseSitePackageManifest } from "@/lib/Modules/Backup/Schema";
import {
  CURRENT_SCHEMA_VERSION,
  PACKAGE_FORMAT,
  PACKAGE_FORMAT_VERSION,
} from "@/lib/Modules/Backup/constants";

describe("backup compatibility", () => {
  it("blocks incompatible package format versions", () => {
    const result = evaluatePackageCompatibility({
      packageFormatVersion: 99,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      kastirVersion: "0.1.0",
    });
    expect(result.level).toBe("block");
    expect(
      result.issues.some((i) => i.code === "PACKAGE_FORMAT_INCOMPATIBLE"),
    ).toBe(true);
  });

  it("blocks packages from a newer schema", () => {
    const result = evaluatePackageCompatibility(
      {
        packageFormatVersion: PACKAGE_FORMAT_VERSION,
        schemaVersion: "20990101000000_future",
        kastirVersion: "9.0.0",
      },
      { schemaVersion: CURRENT_SCHEMA_VERSION, kastirVersion: "0.1.0" },
    );
    expect(result.level).toBe("block");
  });

  it("warns when package schema is older or app version differs", () => {
    const result = evaluatePackageCompatibility(
      {
        packageFormatVersion: PACKAGE_FORMAT_VERSION,
        schemaVersion: "20260716101500_phase_zero_init",
        kastirVersion: "0.0.1",
      },
      { schemaVersion: CURRENT_SCHEMA_VERSION, kastirVersion: "0.1.0" },
    );
    expect(result.level).toBe("warn");
  });

  it("parses a valid manifest", () => {
    const parsed = parseSitePackageManifest({
      format: PACKAGE_FORMAT,
      packageFormatVersion: PACKAGE_FORMAT_VERSION,
      kastirVersion: "0.1.0",
      schemaVersion: CURRENT_SCHEMA_VERSION,
      createdAt: "2026-07-21T12:00:00.000Z",
      origin: "https://example.com",
      siteTitle: "Demo",
      includes: {
        pages: true,
        media: true,
        settings: true,
        customCode: true,
        splitTests: true,
        users: true,
        publishedHtml: false,
      },
      counts: { pages: 1, mediaFiles: 0, assetBytes: 0, users: 1 },
      checksums: {},
      secretsOmitted: true,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects invalid origin in manifest", () => {
    const parsed = parseSitePackageManifest({
      format: PACKAGE_FORMAT,
      packageFormatVersion: PACKAGE_FORMAT_VERSION,
      kastirVersion: "0.1.0",
      schemaVersion: CURRENT_SCHEMA_VERSION,
      createdAt: "2026-07-21T12:00:00.000Z",
      origin: "not-a-url",
      siteTitle: "Demo",
      includes: {
        pages: true,
        media: true,
        settings: true,
        customCode: true,
        splitTests: true,
        users: true,
        publishedHtml: false,
      },
      counts: { pages: 0, mediaFiles: 0, assetBytes: 0, users: 0 },
      checksums: {},
    });
    expect(parsed.success).toBe(false);
  });
});
