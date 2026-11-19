import { beforeEach, describe, expect, it, vi } from "vitest";

const { database, state, hashPassword } = vi.hoisted(() => {
  const state = {
    users: [] as Array<Record<string, unknown>>,
    accounts: [] as Array<Record<string, unknown>>,
    settings: false,
    baseFolder: false,
    mediaBaseFolder: false,
    queue: Promise.resolve(),
  };

  const transaction = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    user: {
      findFirst: vi.fn(
        async () => state.users.find((user) => user.isMaster) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.users.push(data);
        return data;
      }),
      update: vi.fn(),
    },
    account: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: {
            issuer_accountId: { accountId: string };
          };
        }) =>
          state.accounts.find(
            (account) => account.accountId === where.issuer_accountId.accountId,
          ) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.accounts.push(data);
        return data;
      }),
      update: vi.fn(),
    },
    siteSettings: {
      findUnique: vi.fn(async () =>
        state.settings ? { id: "singleton" } : null,
      ),
      create: vi.fn(async () => {
        state.settings = true;
        return { id: "singleton" };
      }),
    },
    pageFolder: {
      findFirst: vi.fn(async () =>
        state.baseFolder ? { id: "base-id", isBase: true } : null,
      ),
      create: vi.fn(async () => {
        state.baseFolder = true;
        return { id: "base-id", isBase: true };
      }),
    },
    mediaFolder: {
      findFirst: vi.fn(async () =>
        state.mediaBaseFolder ? { id: "media-base-id", isBase: true } : null,
      ),
      create: vi.fn(async () => {
        state.mediaBaseFolder = true;
        return { id: "media-base-id", isBase: true };
      }),
    },
    oauthClient: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(),
      update: vi.fn(),
    },
  };

  const database = {
    $transaction: vi.fn(
      async (callback: (tx: typeof transaction) => unknown) => {
        const current = state.queue.then(() => callback(transaction));
        state.queue = current.then(
          () => undefined,
          () => undefined,
        );
        return current;
      },
    ),
  };

  return {
    database,
    state,
    hashPassword: vi.fn().mockResolvedValue("$argon2id$v=19$concurrency-hash"),
  };
});

vi.mock("@/lib/env", () => ({
  env: {
    MASTER_EMAIL: "master@example.com",
    MASTER_PASSWORD: "master-password",
    MASTER_FORCE_RESET: false,
    SITE_TITLE: "Kastir",
    NEXTAUTH_SECRET: "test-secret-with-at-least-32-characters",
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: database }));
vi.mock("@/lib/Modules/Auth/Password", () => ({ hashPassword }));

import {
  bootstrapMaster,
  type BootstrapDatabase,
} from "@/lib/Modules/Auth/Bootstrap";

describe("master bootstrap concurrency", () => {
  beforeEach(() => {
    state.users.length = 0;
    state.accounts.length = 0;
    state.settings = false;
    state.baseFolder = false;
    state.mediaBaseFolder = false;
    state.queue = Promise.resolve();
    vi.clearAllMocks();
  });

  it("creates one master when two startup calls overlap", async () => {
    await Promise.all([
      bootstrapMaster(database as unknown as BootstrapDatabase),
      bootstrapMaster(database as unknown as BootstrapDatabase),
    ]);

    expect(state.users).toHaveLength(1);
    expect(state.accounts).toHaveLength(1);
    expect(state.settings).toBe(true);
    expect(state.baseFolder).toBe(true);
    expect(state.mediaBaseFolder).toBe(true);
  });
});
