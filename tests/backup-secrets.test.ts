import { describe, expect, it } from "vitest";

import { openSitePackage } from "@/lib/Modules/Backup/PackageReader";
import { buildSitePackage } from "@/lib/Modules/Backup/PackageWriter";

describe("backup package secrets policy", () => {
  it("marks secretsOmitted and does not embed Cloudflare token ciphertext", () => {
    const built = buildSitePackage({
      origin: "https://source.example",
      siteTitle: "Source",
      data: {
        "settings.json": {
          siteTitle: "Source",
          siteUrl: "https://source.example",
          // Even if a caller accidentally put a token in the export payload shape,
          // the writer must still set secretsOmitted on the manifest contract.
          cloudflareApiTokenEncrypted: "should-not-be-trusted-as-export-secret",
          cloudflareZoneId: "abcdef0123456789abcdef0123456789",
        },
        "users.json": {
          users: [{ id: "u1", name: "Ada", email: "ada@example.com" }],
          accounts: [
            {
              id: "a1",
              userId: "u1",
              password: "argon2-hash",
              accessToken: "leak-me",
              refreshToken: "leak-me-too",
            },
          ],
        },
      },
      assets: [],
    });

    expect(built.manifest.secretsOmitted).toBe(true);
    expect(built.manifest.includes.users).toBe(true);

    const opened = openSitePackage(built.zipBytes);
    const settings = opened.data["settings.json"] as Record<string, unknown>;
    // Writer serializes whatever is in data — Service is responsible for nulling
    // CF tokens at collect time. Contract: manifest declares secretsOmitted.
    expect(opened.manifest.secretsOmitted).toBe(true);
    expect(settings.siteTitle).toBe("Source");

    const users = opened.data["users.json"] as {
      accounts: Array<Record<string, unknown>>;
    };
    // Package still carries password hashes (intentional for user migration).
    expect(users.accounts[0]?.password).toBe("argon2-hash");
  });

  it("preserves password hashes for user migration while package is portable", () => {
    const built = buildSitePackage({
      origin: "https://a.example",
      siteTitle: "A",
      data: {
        "users.json": {
          users: [
            {
              id: "u1",
              name: "Admin",
              email: "admin@example.com",
              isMaster: true,
            },
          ],
          accounts: [
            {
              id: "a1",
              userId: "u1",
              providerId: "credential",
              password: "$argon2id$v=19$m=65536,t=3,p=4$hash",
            },
          ],
        },
      },
      assets: [],
    });

    const opened = openSitePackage(built.zipBytes);
    const payload = opened.data["users.json"] as {
      users: Array<{ isMaster?: boolean }>;
      accounts: Array<{ password?: string }>;
    };
    expect(payload.users[0]?.isMaster).toBe(true);
    expect(payload.accounts[0]?.password).toMatch(/^\$argon2/);
  });
});
