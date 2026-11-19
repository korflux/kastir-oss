import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { MAX_LOCAL_SNAPSHOTS } from "@/lib/Modules/Backup/constants";
import {
  openSitePackage,
  PackageReaderError,
} from "@/lib/Modules/Backup/PackageReader";
import { buildSitePackage } from "@/lib/Modules/Backup/PackageWriter";
import { SnapshotStore } from "@/lib/Modules/Backup/SnapshotStore";
import { readZip, writeZip } from "@/lib/Modules/Backup/Zip";

/**
 * Executa `body` com um diretório temporário e o remove ao terminar, mesmo se o teste falhar.
 * O cleanup usa `maxRetries`/`retryDelay`: no Windows, um processo externo (antivírus,
 * indexador) pode segurar um handle de arquivo recém-criado enquanto o `rm` recursivo roda, e
 * sem retentativa o Node falha de imediato com EBUSY/EPERM/ENOTEMPTY (o flake de "prunes local
 * snapshots to max retention" no `pnpm test` completo). Com retentativa linear o `rm` espera
 * o handle fechar (até ~1,5 s no total) e, se o diretório realmente ficar preso, ainda falha
 * alto em vez de vazar lixo calado. O cleanup roda no `finally` do próprio teste, depois de
 * todas as operações do corpo, e não em hook: um hook dispara logo após um timeout, enquanto o
 * corpo ainda escreve no diretório, e o `rm` concorreria com ele.
 */
async function withTempDir(
  prefix: string,
  body: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  try {
    await body(dir);
  } finally {
    await rm(dir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
}

describe("backup package writer/reader", () => {
  it("round-trips a minimal package with users", () => {
    const built = buildSitePackage({
      origin: "https://source.example",
      siteTitle: "Source",
      data: {
        "pages.json": [
          {
            id: "p1",
            title: "Home",
            slug: "home",
            content: '<a href="https://source.example/x">x</a>',
          },
        ],
        "users.json": {
          users: [{ id: "u1", name: "Ada", email: "ada@example.com" }],
          accounts: [{ id: "a1", userId: "u1", password: "hash" }],
        },
        "settings.json": {
          siteTitle: "Source",
          siteUrl: "https://source.example",
        },
      },
      assets: [
        {
          zipPath: "assets/uploads/m1/file.webp",
          mediaId: "m1",
          fileName: "file.webp",
          bytes: Buffer.from("webp-bytes"),
        },
      ],
    });

    expect(built.manifest.includes.users).toBe(true);
    expect(built.manifest.format).toBe("kastir-site-package");

    const opened = openSitePackage(built.zipBytes);
    expect(opened.manifest.siteTitle).toBe("Source");
    expect(opened.assets).toHaveLength(1);
    expect(opened.data["pages.json"]).toEqual(built.data["pages.json"]);
  });

  it("rejects path traversal entries", () => {
    expect(() =>
      writeZip([{ path: "../etc/passwd", data: Buffer.from("x") }]),
    ).toThrow(/Unsafe zip path/);
  });

  it("rejects checksum mismatches", () => {
    const built = buildSitePackage({
      origin: "https://source.example",
      siteTitle: "Source",
      data: { "pages.json": [] },
      assets: [],
    });
    // Corrupt a data file while keeping old checksum in manifest
    const entries = readZip(built.zipBytes).map((e) =>
      e.path === "data/pages.json"
        ? { path: e.path, data: Buffer.from("[]//tampered") }
        : { path: e.path, data: e.data },
    );
    const corrupted = writeZip(
      entries.map((e) => ({ path: e.path, data: e.data })),
    );
    expect(() => openSitePackage(corrupted)).toThrow(PackageReaderError);
  });

  it("prunes local snapshots to max retention", async () => {
    await withTempDir("kastir-backup-", async (dir) => {
      const store = new SnapshotStore(dir);
      for (let i = 0; i < MAX_LOCAL_SNAPSHOTS + 2; i += 1) {
        const built = buildSitePackage({
          origin: "https://source.example",
          siteTitle: `Snap ${i}`,
          data: { "pages.json": [] },
          assets: [],
        });
        await store.createFromZip(built.zipBytes);
      }
      const list = await store.list({ includeSafety: false });
      expect(list.length).toBeLessThanOrEqual(MAX_LOCAL_SNAPSHOTS);
    });
  });

  it("keeps safety snapshots visible for recovery after mark", async () => {
    await withTempDir("kastir-backup-safety-", async (dir) => {
      const store = new SnapshotStore(dir);
      const built = buildSitePackage({
        origin: "https://source.example",
        siteTitle: "Before",
        data: { "pages.json": [] },
        assets: [],
      });
      const safety = await store.createFromZip(built.zipBytes, {
        safety: true,
      });
      await store.markSafetyFailed(safety.id, "import failed");
      const list = await store.list({ includeSafety: true });
      expect(list.some((s) => s.id === safety.id && s.safety)).toBe(true);
    });
  });
});
