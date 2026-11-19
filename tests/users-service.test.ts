import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

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

type TestPage = {
  id: string;
  authorId: string;
};

function createDatabase(
  initialUsers: TestUser[],
  initialPages: TestPage[] = [],
) {
  const users = initialUsers.map((user) => ({ ...user }));
  const pages = initialPages.map((page) => ({ ...page }));
  const sessions = new Map<string, number>([
    ["editor-id", 2],
    ["admin-id", 1],
  ]);
  const oauthTokens = new Set(["editor-id", "admin-id"]);
  const oauthRefresh = new Set(["editor-id", "admin-id"]);
  const logs: Array<Record<string, unknown>> = [];

  const database = {
    user: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          users.find((user) => user.id === where.id) ?? null,
      ),
      findMany: vi.fn(async () => [...users]),
      count: vi.fn(async () => users.length),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const user = users.find((candidate) => candidate.id === where.id);
          if (!user) throw new Error("user missing");
          Object.assign(user, data);
          return user;
        },
      ),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const index = users.findIndex((candidate) => candidate.id === where.id);
        if (index < 0) throw new Error("user missing");
        if (pages.some((page) => page.authorId === where.id)) {
          const error = new Error("Foreign key constraint failed") as Error & {
            code: string;
          };
          error.code = "P2003";
          throw error;
        }
        return users.splice(index, 1)[0];
      }),
    },
    account: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    session: {
      deleteMany: vi.fn(async ({ where }: { where: { userId: string } }) => {
        const count = sessions.get(where.userId) ?? 0;
        sessions.delete(where.userId);
        return { count };
      }),
    },
    oauthAccessToken: {
      deleteMany: vi.fn(async ({ where }: { where: { userId: string } }) => {
        const count = oauthTokens.has(where.userId) ? 1 : 0;
        oauthTokens.delete(where.userId);
        return { count };
      }),
    },
    oauthRefreshToken: {
      deleteMany: vi.fn(async ({ where }: { where: { userId: string } }) => {
        const count = oauthRefresh.has(where.userId) ? 1 : 0;
        oauthRefresh.delete(where.userId);
        return { count };
      }),
    },
    page: {
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { authorId: string };
          data: { authorId: string };
        }) => {
          let count = 0;
          for (const page of pages) {
            if (page.authorId === where.authorId) {
              page.authorId = data.authorId;
              count += 1;
            }
          }
          return { count };
        },
      ),
    },
    inviteToken: {
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
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

  return { database, users, pages, sessions, oauthTokens, oauthRefresh, logs };
}

function user(
  id: string,
  role: "ADMIN" | "EDITOR",
  overrides: Partial<TestUser> = {},
): TestUser {
  return {
    id,
    name: id,
    email: `${id}@example.com`,
    role,
    isMaster: false,
    createdAt: new Date("2026-07-17T12:00:00.000Z"),
    ...overrides,
  };
}

describe("UsersService hierarchy", () => {
  it("lets the Master change or remove any non-Master user", async () => {
    const { database, users } = createDatabase([
      user("master-id", "ADMIN", { isMaster: true }),
      user("admin-id", "ADMIN"),
      user("editor-id", "EDITOR"),
    ]);
    const service = new UsersService(database as never);

    await service.changeRole("master-id", "admin-id", "EDITOR");
    await service.removeUser("master-id", "editor-id");

    expect(users.find((candidate) => candidate.id === "admin-id")?.role).toBe(
      "EDITOR",
    );
    expect(users.some((candidate) => candidate.id === "editor-id")).toBe(false);
  });

  it("lets a common Admin change/remove Editors but not another Admin or Master", async () => {
    const { database, users } = createDatabase([
      user("master-id", "ADMIN", { isMaster: true }),
      user("admin-id", "ADMIN"),
      user("other-admin-id", "ADMIN"),
      user("editor-id", "EDITOR"),
    ]);
    const service = new UsersService(database as never);

    await service.changeRole("admin-id", "editor-id", "ADMIN");
    expect(users.find((candidate) => candidate.id === "editor-id")?.role).toBe(
      "ADMIN",
    );

    await expect(
      service.changeRole("admin-id", "other-admin-id", "EDITOR"),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      service.removeUser("admin-id", "other-admin-id"),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      service.removeUser("admin-id", "master-id"),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("applies a changed role immediately and revokes the target sessions", async () => {
    const { database, sessions, oauthTokens, oauthRefresh } = createDatabase([
      user("master-id", "ADMIN", { isMaster: true }),
      user("admin-id", "ADMIN"),
    ]);
    const service = new UsersService(database as never);

    await service.changeRole("master-id", "admin-id", "EDITOR");

    expect(sessions.has("admin-id")).toBe(false);
    expect(oauthTokens.has("admin-id")).toBe(false);
    expect(oauthRefresh.has("admin-id")).toBe(false);
    await expect(service.listUsers("admin-id")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("updates name and email without revoking sessions when role stays the same", async () => {
    const { database, users, sessions, oauthTokens, oauthRefresh } =
      createDatabase([
        user("master-id", "ADMIN", { isMaster: true }),
        user("editor-id", "EDITOR", {
          name: "Old Name",
          email: "old@example.com",
        }),
      ]);
    const service = new UsersService(database as never);

    const updated = await service.changeRole("master-id", "editor-id", {
      name: "  New Name  ",
      email: "  NEW@EXAMPLE.COM ",
    });

    expect(updated).toMatchObject({
      name: "New Name",
      email: "new@example.com",
      role: "EDITOR",
    });
    expect(
      users.find((candidate) => candidate.id === "editor-id"),
    ).toMatchObject({
      name: "New Name",
      email: "new@example.com",
    });
    // Sessões e tokens OAuth permanecem (só role muda revoga).
    expect(sessions.has("editor-id")).toBe(true);
    expect(oauthTokens.has("editor-id")).toBe(true);
    expect(oauthRefresh.has("editor-id")).toBe(true);
  });

  it("reassigns authored pages to the actor before removing a user", async () => {
    const { database, users, pages, sessions } = createDatabase(
      [user("admin-id", "ADMIN"), user("editor-id", "EDITOR")],
      [
        { id: "page-1", authorId: "editor-id" },
        { id: "page-2", authorId: "editor-id" },
      ],
    );
    const service = new UsersService(database as never);

    await service.removeUser("admin-id", "editor-id");

    expect(users.some((candidate) => candidate.id === "editor-id")).toBe(false);
    expect(pages.every((page) => page.authorId === "admin-id")).toBe(true);
    expect(sessions.has("editor-id")).toBe(false);
  });

  it("revokes target sessions when removing a user and blocks self-removal", async () => {
    const { database, sessions } = createDatabase([
      user("admin-id", "ADMIN"),
      user("editor-id", "EDITOR"),
    ]);
    const service = new UsersService(database as never);

    await service.removeUser("admin-id", "editor-id");

    expect(sessions.has("editor-id")).toBe(false);
    await expect(
      service.removeUser("admin-id", "admin-id"),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("returns a safe, effective-role list only to administrators", async () => {
    const { database } = createDatabase([
      user("master-id", "ADMIN", { isMaster: true }),
      user("editor-id", "EDITOR"),
    ]);
    const service = new UsersService(database as never);

    const result = await service.listUsers("master-id");
    expect(result.items).toMatchObject([
      { id: "master-id", role: "MASTER", isMaster: true },
      { id: "editor-id", role: "EDITOR", isMaster: false },
    ]);
    expect(result.items[0]).not.toHaveProperty("password");

    await expect(service.listUsers("editor-id")).rejects.toBeInstanceOf(
      UsersDomainError,
    );
    await expect(service.listUsers("editor-id")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("rejects invite creation for EDITOR before validating the payload", async () => {
    const { database } = createDatabase([user("editor-id", "EDITOR")]);
    const service = new UsersService(database as never);

    await expect(
      service.createInvite("editor-id", {}, "https://panel.example.test"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
