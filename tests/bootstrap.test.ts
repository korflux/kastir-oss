import { beforeEach, describe, expect, it, vi } from "vitest";

const { database, transaction, hashPassword, runtimeEnv } = vi.hoisted(() => {
  const transaction = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    user: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    account: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    siteSettings: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    pageFolder: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    mediaFolder: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    oauthClient: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    jwks: {
      deleteMany: vi.fn(),
    },
  };

  return {
    transaction,
    database: {
      $transaction: vi.fn(
        async (callback: (tx: typeof transaction) => unknown) =>
          callback(transaction),
      ),
    },
    hashPassword: vi.fn().mockResolvedValue("$argon2id$v=19$bootstrap-hash"),
    runtimeEnv: {
      MASTER_EMAIL: "master@example.com",
      MASTER_PASSWORD: "master-password",
      MASTER_FORCE_RESET: false,
      SITE_TITLE: "Kastir",
      NEXTAUTH_SECRET: "test-secret-with-at-least-32-characters",
    },
  };
});

vi.mock("@/lib/env", () => ({ env: runtimeEnv }));
vi.mock("@/lib/prisma", () => ({ prisma: database }));
vi.mock("@/lib/Modules/Auth/Password", () => ({ hashPassword }));

import {
  bootstrapMaster,
  type BootstrapDatabase,
} from "@/lib/Modules/Auth/Bootstrap";

describe("master bootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeEnv.MASTER_FORCE_RESET = false;
    transaction.user.findFirst.mockResolvedValue(null);
    transaction.user.create.mockResolvedValue({ id: "master-id" });
    transaction.account.findUnique.mockResolvedValue(null);
    transaction.siteSettings.findUnique.mockResolvedValue(null);
    transaction.pageFolder.findFirst.mockResolvedValue(null);
    transaction.mediaFolder.findFirst.mockResolvedValue(null);
    transaction.oauthClient.findUnique.mockResolvedValue(null);
  });

  it("serializes the seed behind an advisory lock and creates the master", async () => {
    await bootstrapMaster(database as unknown as BootstrapDatabase);

    expect(database.$transaction).toHaveBeenCalledOnce();
    expect(transaction.$executeRaw).toHaveBeenCalledOnce();
    expect(transaction.oauthClient.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clientId: "kastir-mcp-resource-server",
        clientSecret: expect.not.stringContaining("test-secret"),
        applicationType: "web",
        disabled: false,
      }),
    });
    expect(transaction.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: "master",
        email: "master@example.com",
        role: "ADMIN",
        isMaster: true,
      }),
    });
    expect(transaction.account.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        issuer: "local:credential",
        accountId: "master-id",
        providerId: "credential",
        password: "$argon2id$v=19$bootstrap-hash",
      }),
    });
    expect(transaction.siteSettings.create).toHaveBeenCalledWith({
      data: { id: "singleton", siteTitle: "Kastir" },
    });
    expect(transaction.pageFolder.create).toHaveBeenCalledWith({
      data: {
        name: "Base",
        parentId: null,
        color: null,
        isBase: true,
      },
    });
    expect(transaction.mediaFolder.create).toHaveBeenCalledWith({
      data: {
        name: "Base",
        parentId: null,
        color: null,
        isBase: true,
      },
    });
  });

  it("does not write an existing master or settings on a normal restart", async () => {
    transaction.user.findFirst.mockResolvedValue({
      id: "master-id",
      name: "Original Name",
      email: "master@example.com",
      role: "ADMIN",
      isMaster: true,
    });
    transaction.account.findUnique.mockResolvedValue({ id: "account-id" });
    transaction.siteSettings.findUnique.mockResolvedValue({
      id: "singleton",
      siteTitle: "Saved title",
    });
    transaction.pageFolder.findFirst.mockResolvedValue({
      id: "base-id",
      name: "Renamed Base",
      isBase: true,
    });
    transaction.mediaFolder.findFirst.mockResolvedValue({
      id: "media-base-id",
      name: "Renamed Media Base",
      isBase: true,
    });
    transaction.oauthClient.findUnique.mockResolvedValue({
      clientId: "kastir-mcp-resource-server",
    });

    await bootstrapMaster(database as unknown as BootstrapDatabase);

    expect(transaction.user.update).not.toHaveBeenCalled();
    expect(transaction.account.update).not.toHaveBeenCalled();
    expect(transaction.siteSettings.create).not.toHaveBeenCalled();
    expect(transaction.pageFolder.create).not.toHaveBeenCalled();
    expect(transaction.mediaFolder.create).not.toHaveBeenCalled();
    expect(transaction.oauthClient.update).toHaveBeenCalledWith({
      where: { clientId: "kastir-mcp-resource-server" },
      data: expect.objectContaining({
        applicationType: "web",
        disabled: false,
      }),
    });
    expect(hashPassword).not.toHaveBeenCalled();
  });

  it("force-resets the master credentials and encrypted signing keys", async () => {
    runtimeEnv.MASTER_FORCE_RESET = true;
    transaction.user.findFirst.mockResolvedValue({
      id: "master-id",
      name: "Original Name",
      email: "old@example.com",
      role: "ADMIN",
      isMaster: true,
    });
    transaction.account.findUnique.mockResolvedValue({ id: "account-id" });
    transaction.siteSettings.findUnique.mockResolvedValue({
      id: "singleton",
      siteTitle: "Saved title",
    });
    transaction.oauthClient.findUnique.mockResolvedValue({
      clientId: "kastir-mcp-resource-server",
    });

    await bootstrapMaster(database as unknown as BootstrapDatabase);

    expect(transaction.user.update).toHaveBeenCalledWith({
      where: { id: "master-id" },
      data: { email: "master@example.com" },
    });
    expect(transaction.account.update).toHaveBeenCalledWith({
      where: { id: "account-id" },
      data: { password: "$argon2id$v=19$bootstrap-hash" },
    });
    expect(transaction.jwks.deleteMany).toHaveBeenCalledOnce();
  });
});
