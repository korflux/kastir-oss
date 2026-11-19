import { describe, expect, it } from "vitest";

import { getBackupMaxBytes } from "@/lib/Modules/Backup/constants";
import {
  assertZipBufferWithinLimits,
  readZip,
  writeZip,
} from "@/lib/Modules/Backup/Zip";

describe("backup zip limits", () => {
  it("exposes a positive max package size", () => {
    expect(getBackupMaxBytes()).toBeGreaterThan(1024);
  });

  it("rejects buffers larger than BACKUP_MAX_BYTES", () => {
    const previous = process.env.BACKUP_MAX_BYTES;
    process.env.BACKUP_MAX_BYTES = "50";
    try {
      expect(() => assertZipBufferWithinLimits(Buffer.alloc(51, 1))).toThrow(
        /maximum size/i,
      );
    } finally {
      if (previous === undefined) delete process.env.BACKUP_MAX_BYTES;
      else process.env.BACKUP_MAX_BYTES = previous;
    }
  });

  it("rejects non-PK signatures", () => {
    expect(() => assertZipBufferWithinLimits(Buffer.from("not-a-zip"))).toThrow(
      /PK signature/i,
    );
  });

  it("round-trips a small valid zip under default limits", () => {
    const zip = writeZip([
      { path: "data/pages.json", data: Buffer.from("[]", "utf8") },
    ]);
    const entries = readZip(zip);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.path).toBe("data/pages.json");
  });
});
