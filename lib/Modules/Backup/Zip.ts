import { createHash } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";

import {
  BACKUP_MAX_ENTRY_UNCOMPRESSED_BYTES,
  BACKUP_MAX_TOTAL_UNCOMPRESSED_BYTES,
  BACKUP_MAX_ZIP_ENTRIES,
  getBackupMaxBytes,
} from "@/lib/Modules/Backup/constants";

/**
 * Minimal ZIP (store + deflate) writer/reader for Kastir site packages.
 * Avoids a third-party dependency; supports the subset we need.
 */

export type ZipEntryInput = {
  path: string;
  data: Buffer;
  /** Prefer deflate for text; store for already-compressed binaries when desired. */
  compress?: boolean;
};

export type ZipEntry = {
  path: string;
  data: Buffer;
};

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i]!;
    for (let j = 0; j < 8; j += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  const dosDate =
    ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const dosTime =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  return { time: dosTime, date: dosDate };
}

function normalizeZipPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (
    !normalized ||
    normalized.includes("\0") ||
    normalized.split("/").some((s) => s === ".." || s === "")
  ) {
    throw new Error(`Unsafe zip path: ${path}`);
  }
  return normalized;
}

export function assertZipBufferWithinLimits(buffer: Buffer): void {
  const max = getBackupMaxBytes();
  if (buffer.length > max) {
    throw new Error(
      `Package exceeds maximum size of ${max} bytes (got ${buffer.length})`,
    );
  }
  if (buffer.length >= 2) {
    const sig = buffer.subarray(0, 2).toString("ascii");
    if (sig !== "PK") {
      throw new Error("Invalid zip: missing PK signature");
    }
  }
}

export function writeZip(entries: ZipEntryInput[]): Buffer {
  const { time, date } = dosDateTime();
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const path = normalizeZipPath(entry.path);
    const nameBuf = Buffer.from(path, "utf8");
    const raw = entry.data;
    const useDeflate = entry.compress !== false && raw.length > 64;
    const compressed = useDeflate ? deflateRawSync(raw) : raw;
    const method = useDeflate ? 8 : 0;
    const checksum = crc32(raw);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const local = Buffer.concat([localHeader, nameBuf, compressed]);
    localParts.push(local);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(date, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(Buffer.concat([centralHeader, nameBuf]));
    offset += local.length;
  }

  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, central, end]);
}

export function readZip(buffer: Buffer): ZipEntry[] {
  assertZipBufferWithinLimits(buffer);

  if (buffer.length < 22) {
    throw new Error("Invalid zip: too small");
  }

  let eocd = -1;
  const scanStart = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= scanStart; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error("Invalid zip: missing end of central directory");
  }

  const entryCount = buffer.readUInt16LE(eocd + 10);
  if (entryCount > BACKUP_MAX_ZIP_ENTRIES) {
    throw new Error(
      `Zip has too many entries (${entryCount} > ${BACKUP_MAX_ZIP_ENTRIES})`,
    );
  }

  let centralOffset = buffer.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  let totalUncompressed = 0;

  for (let n = 0; n < entryCount; n += 1) {
    if (buffer.readUInt32LE(centralOffset) !== 0x02014b50) {
      throw new Error("Invalid zip: bad central directory signature");
    }
    const method = buffer.readUInt16LE(centralOffset + 10);
    const compressedSize = buffer.readUInt32LE(centralOffset + 20);
    const uncompressedSize = buffer.readUInt32LE(centralOffset + 24);
    const nameLen = buffer.readUInt16LE(centralOffset + 28);
    const extraLen = buffer.readUInt16LE(centralOffset + 30);
    const commentLen = buffer.readUInt16LE(centralOffset + 32);
    const localHeaderOffset = buffer.readUInt32LE(centralOffset + 42);
    const name = buffer
      .subarray(centralOffset + 46, centralOffset + 46 + nameLen)
      .toString("utf8");

    const safePath = normalizeZipPath(name);

    if (uncompressedSize > BACKUP_MAX_ENTRY_UNCOMPRESSED_BYTES) {
      throw new Error(
        `Zip entry ${safePath} exceeds max uncompressed size (${uncompressedSize})`,
      );
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > BACKUP_MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error("Zip total uncompressed size exceeds limit");
    }

    if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error(`Invalid zip local header for ${safePath}`);
    }
    const localNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);

    let data: Buffer;
    if (method === 0) {
      data = Buffer.from(compressed);
    } else if (method === 8) {
      data = inflateRawSync(compressed, {
        maxOutputLength: Math.min(
          BACKUP_MAX_ENTRY_UNCOMPRESSED_BYTES,
          uncompressedSize > 0
            ? uncompressedSize
            : BACKUP_MAX_ENTRY_UNCOMPRESSED_BYTES,
        ),
      });
    } else {
      throw new Error(`Unsupported zip compression method ${method}`);
    }

    if (data.length > BACKUP_MAX_ENTRY_UNCOMPRESSED_BYTES) {
      throw new Error(`Zip entry ${safePath} inflated beyond allowed size`);
    }

    entries.push({ path: safePath, data });
    centralOffset += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

export function sha256Hex(data: Buffer | string): string {
  return `sha256:${createHash("sha256").update(data).digest("hex")}`;
}
