import { describe, expect, it, vi } from "vitest";

const { hashPassword } = vi.hoisted(() => ({
  hashPassword: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/Modules/Auth/Password", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/Modules/Auth/Password")>();
  hashPassword.mockImplementation(actual.hashPassword);
  return { ...actual, hashPassword };
});

import { verifyPassword } from "@/lib/Modules/Auth/Password";
import { digestToken } from "@/lib/Modules/Users/Token";
import { UsersDomainError } from "@/lib/Modules/Users/Types";
import { UsersService } from "@/lib/Modules/Users/Service";

type TestUser = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "EDITOR";
  isMaster: boolean;
  createdAt: Date;
};

type TestAccount = {
  id: string;
  issuer: string;
  accountId: string;
  providerId: string;
  userId: string;
  password: string;
};

type TestToken = {
  id: string;
  token: string;
  type: "INVITE" | "PASSWORD_RESET";
  role: "ADMIN" | "EDITOR" | null;
  name: string | null;
  targetUserId: string | null;
  createdById: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
};

function createDatabase() {
  const users: TestUser[] = [
    {
      id: "master-id",
      name: "Master",
      email: "master@example.com",
      role: "ADMIN",
      isMaster: true,
      createdAt: new Date("2026-07-17T12:00:00.000Z"),
    },
    {
      id: "admin-id",
      name: "Admin",
      email: "admin@example.com",
      role: "ADMIN",
      isMaster: false,
      createdAt: new Date("2026-07-17T12:00:00.000Z"),
    },
    {
      id: "editor-id",
      name: "Editor",
      email: "editor@example.com",
      role: "EDITOR",
      isMaster: false,
      createdAt: new Date("2026-07-17T12:00:00.000Z"),
    },
  ];
  const accounts: TestAccount[] = [
    {
      id: "account-master",
      issuer: "local:credential",
      accountId: "master-id",
      providerId: "credential",
      userId: "master-id",
      password: "master-hash",
    },
    {
      id: "account-admin",
      issuer: "local:credential",
      accountId: "admin-id",
      providerId: "credential",
      userId: "admin-id",
      password: "admin-hash",
    },
    {
      id: "account-editor",
      issuer: "local:credential",
      accountId: "editor-id",
      providerId: "credential",
      userId: "editor-id",
      password: "editor-hash",
    },
  ];
  const tokens: TestToken[] = [];
  const sessions = new Map<string, number>([
    ["admin-id", 2],
    ["editor-id", 1],
  ]);
  const logs: Array<Record<string, unknown>> = [];
  let userSequence = 0;
  let accountSequence = 0;
  let tokenSequence = 0;

  const database = {
    user: {
      findUnique: vi.fn(
        async ({ where }: { where: { id?: string; email?: string } }) =>
          users.find((user) =>
            where.id ? user.id === where.id : user.email === where.email,
          ) ?? null,
      ),
      findMany: vi.fn(async () => [...users]),
      count: vi.fn(async () => users.length),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const email = String(data.email);
        if (users.some((user) => user.email === email)) {
          const error = new Error("Unique constraint failed") as Error & {
            code: string;
          };
          error.code = "P2002";
          throw error;
        }
        const created: TestUser = {
          id: String(data.id),
          name: String(data.name),
          email,
          role: data.role as TestUser["role"],
          isMaster: Boolean(data.isMaster),
          createdAt: new Date("2026-07-17T12:00:01.000Z"),
        };
        users.push(created);
        userSequence += 1;
        return created;
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const target = users.find((user) => user.id === where.id);
          if (!target) throw new Error("user missing");
          Object.assign(target, data);
          return target;
        },
      ),
      delete: vi.fn(),
    },
    account: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: {
            issuer_accountId?: {
              issuer: string;
              accountId: string;
            };
          };
        }) => {
          const compound = where.issuer_accountId;
          return (
            accounts.find((account) =>
              compound
                ? account.issuer === compound.issuer &&
                  account.accountId === compound.accountId
                : false,
            ) ?? null
          );
        },
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const created: TestAccount = {
          id: String(data.id),
          issuer: String(data.issuer),
          accountId: String(data.accountId),
          providerId: String(data.providerId),
          userId: String(data.userId),
          password: String(data.password),
        };
        accounts.push(created);
        accountSequence += 1;
        return created;
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const account = accounts.find(
            (candidate) => candidate.id === where.id,
          );
          if (!account) throw new Error("account missing");
          Object.assign(account, data);
          return account;
        },
      ),
    },
    session: {
      deleteMany: vi.fn(async ({ where }: { where: { userId: string } }) => {
        const count = sessions.get(where.userId) ?? 0;
        sessions.delete(where.userId);
        return { count };
      }),
    },
    page: {
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    inviteToken: {
      findUnique: vi.fn(
        async ({ where }: { where: { token: string } }) =>
          tokens.find((token) => token.token === where.token) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const token: TestToken = {
          id: `token-${++tokenSequence}`,
          token: String(data.token),
          type: data.type as TestToken["type"],
          role: (data.role as TestToken["role"]) ?? null,
          name: (data.name as string | null) ?? null,
          targetUserId: (data.targetUserId as string | null) ?? null,
          createdById: String(data.createdById),
          expiresAt: data.expiresAt as Date,
          usedAt: null,
          createdAt: new Date("2026-07-17T12:00:00.000Z"),
        };
        tokens.push(token);
        return token;
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; usedAt: null; expiresAt: { gt: Date } };
          data: { usedAt: Date };
        }) => {
          const token = tokens.find((candidate) => candidate.id === where.id);
          if (!token || token.usedAt || token.expiresAt <= where.expiresAt.gt)
            return { count: 0 };
          token.usedAt = data.usedAt;
          return { count: 1 };
        },
      ),
    },
    logEntry: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        logs.push(data);
        return { id: `log-${logs.length}` };
      }),
    },
    $transaction: vi.fn(async <T>(callback: (tx: unknown) => Promise<T>) =>
      callback(database),
    ),
  };

  return {
    database,
    users,
    accounts,
    tokens,
    sessions,
    logs,
    userSequence,
    accountSequence,
  };
}

describe("UsersService invites and password resets", () => {
  it("creates a digest-only invite and lets an Admin invite another Admin", async () => {
    const { database, tokens, logs } = createDatabase();
    const service = new UsersService(database as never);

    const result = await service.createInvite(
      "admin-id",
      { name: "  New Admin ", role: "ADMIN" },
      "https://kastir.example",
      new Date("2026-07-17T12:00:00.000Z"),
    );

    expect(result.url).toMatch(
      /^https:\/\/kastir\.example\/admin\/invite\/[0-9a-f]{64}$/,
    );
    expect(tokens[0]).toMatchObject({
      name: "New Admin",
      role: "ADMIN",
      usedAt: null,
    });
    expect(tokens[0]?.token).not.toContain(result.url.split("/").at(-1));
    expect(result.expiresAt.getTime()).toBe(
      new Date("2026-07-18T12:00:00.000Z").getTime(),
    );
    expect(logs.at(-1)).toMatchObject({
      action: "USER_INVITE_CREATED",
      objectType: "USER",
    });
  });

  it("accepts an invite once, creates UUID-style records and hashes the password", async () => {
    const { database, tokens, users, accounts } = createDatabase();
    const service = new UsersService(database as never);
    const created = await service.createInvite(
      "master-id",
      { name: "Invited Editor", role: "EDITOR" },
      "https://kastir.example",
      new Date("2026-07-17T12:00:00.000Z"),
    );
    const rawToken = created.url.split("/").at(-1) as string;

    const accepted = await service.acceptInvite(
      rawToken,
      { email: "INVITED@EXAMPLE.COM", password: "secret-123" },
      new Date("2026-07-17T12:01:00.000Z"),
    );

    expect(accepted).toMatchObject({
      name: "Invited Editor",
      email: "invited@example.com",
      role: "EDITOR",
    });
    expect(tokens[0]?.usedAt).toEqual(new Date("2026-07-17T12:01:00.000Z"));
    const createdUser = users.find(
      (user) => user.email === "invited@example.com",
    );
    const createdAccount = accounts.find(
      (account) => account.userId === createdUser?.id,
    );
    expect(createdUser?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(createdAccount?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(createdAccount?.providerId).toBe("credential");
    expect(createdAccount?.issuer).toBe("local:credential");
    expect(createdAccount?.accountId).toBe(createdUser?.id);
    expect(
      await verifyPassword("secret-123", createdAccount?.password ?? ""),
    ).toBe(true);

    await expect(
      service.acceptInvite(rawToken, {
        email: "again@example.com",
        password: "secret-123",
      }),
    ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("does not consume an invite when the e-mail is already registered", async () => {
    const { database, tokens } = createDatabase();
    const service = new UsersService(database as never);
    const created = await service.createInvite(
      "master-id",
      { name: "Another Editor", role: "EDITOR" },
      "https://kastir.example",
    );
    const rawToken = created.url.split("/").at(-1) as string;

    await expect(
      service.acceptInvite(rawToken, {
        email: "editor@example.com",
        password: "secret-123",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(tokens[0]?.usedAt).toBeNull();
  });

  it("maps a unique e-mail race (P2002) to CONFLICT without leaking internals", async () => {
    const { database, users } = createDatabase();
    const service = new UsersService(database as never);
    const created = await service.createInvite(
      "master-id",
      { name: "Race Editor", role: "EDITOR" },
      "https://kastir.example",
    );
    const rawToken = created.url.split("/").at(-1) as string;

    // Force the pre-check to miss so create hits the unique constraint.
    database.user.findUnique = vi.fn(
      async ({ where }: { where: { id?: string; email?: string } }) => {
        if (where.email) return null;
        return users.find((user) => user.id === where.id) ?? null;
      },
    );
    users.push({
      id: "race-id",
      name: "Race",
      email: "race@example.com",
      role: "EDITOR",
      isMaster: false,
      createdAt: new Date("2026-07-17T12:00:00.000Z"),
    });

    await expect(
      service.acceptInvite(rawToken, {
        email: "race@example.com",
        password: "secret-123",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("accepts a token at most once under concurrent attempts", async () => {
    const { database, tokens, users } = createDatabase();
    const service = new UsersService(database as never);
    const created = await service.createInvite(
      "master-id",
      { name: "Concurrent", role: "EDITOR" },
      "https://kastir.example",
    );
    const rawToken = created.url.split("/").at(-1) as string;

    const results = await Promise.allSettled([
      service.acceptInvite(rawToken, {
        email: "one@example.com",
        password: "secret-123",
      }),
      service.acceptInvite(rawToken, {
        email: "two@example.com",
        password: "secret-123",
      }),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(tokens[0]?.usedAt).not.toBeNull();
    expect(
      users.filter((candidate) => candidate.name === "Concurrent"),
    ).toHaveLength(1);
  });

  it("allows reset for a common Admin but never for the Master", async () => {
    const { database, accounts, sessions } = createDatabase();
    const service = new UsersService(database as never);

    const link = await service.createPasswordReset(
      "master-id",
      "admin-id",
      "https://kastir.example",
    );
    const rawToken = link.url.split("/").at(-1) as string;
    await service.resetPassword(rawToken, { password: "new-secret-123" });

    const adminAccount = accounts.find(
      (account) => account.userId === "admin-id",
    );
    expect(
      await verifyPassword("new-secret-123", adminAccount?.password ?? ""),
    ).toBe(true);
    expect(
      await verifyPassword("admin-hash", adminAccount?.password ?? ""),
    ).toBe(false);
    expect(sessions.has("admin-id")).toBe(false);

    await expect(
      service.resetPassword(rawToken, { password: "another-secret-123" }),
    ).rejects.toMatchObject({ code: "INVALID_TOKEN" });

    await expect(
      service.createPasswordReset(
        "admin-id",
        "master-id",
        "https://kastir.example",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("does not hash a password when the invite token is invalid", async () => {
    hashPassword.mockClear();
    const { database } = createDatabase();
    const service = new UsersService(database as never);

    await expect(
      service.acceptInvite("deadbeef", {
        email: "ghost@example.com",
        password: "secret-123",
      }),
    ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
    expect(hashPassword).not.toHaveBeenCalled();
  });

  it("does not hash a password when the reset token is invalid", async () => {
    hashPassword.mockClear();
    const { database } = createDatabase();
    const service = new UsersService(database as never);

    await expect(
      service.resetPassword("deadbeef", { password: "secret-123" }),
    ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
    expect(hashPassword).not.toHaveBeenCalled();
  });

  it("forbids ADMIN from creating a password reset for another ADMIN", async () => {
    const { database, users } = createDatabase();
    users.push({
      id: "admin-2-id",
      name: "Admin Two",
      email: "admin2@example.com",
      role: "ADMIN",
      isMaster: false,
      createdAt: new Date("2026-07-17T12:00:00.000Z"),
    });
    const service = new UsersService(database as never);

    await expect(
      service.createPasswordReset(
        "admin-id",
        "admin-2-id",
        "https://kastir.example",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets MASTER create a password reset for an ADMIN", async () => {
    const { database } = createDatabase();
    const service = new UsersService(database as never);

    const link = await service.createPasswordReset(
      "master-id",
      "admin-id",
      "https://kastir.example",
    );
    expect(link.url).toContain("/admin/reset-password/");
  });

  it("rejects expired invite metadata with the same public token error", async () => {
    const { database } = createDatabase();
    const service = new UsersService(database as never);
    const link = await service.createInvite(
      "master-id",
      { name: "Expired", role: "EDITOR" },
      "https://kastir.example",
      new Date("2026-07-17T12:00:00.000Z"),
    );

    await expect(
      service.getInviteMeta(
        link.url.split("/").at(-1) as string,
        new Date("2026-07-18T12:00:00.000Z"),
      ),
    ).rejects.toBeInstanceOf(UsersDomainError);
    await expect(
      service.getInviteMeta(
        link.url.split("/").at(-1) as string,
        new Date("2026-07-18T12:00:00.000Z"),
      ),
    ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
    expect(digestToken("not-the-token")).not.toBe(link.url.split("/").at(-1));
  });
});
