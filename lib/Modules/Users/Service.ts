import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/Logging/logEvent";
import { hashPassword } from "@/lib/Modules/Auth/Password";
import {
  acceptInviteSchema,
  createInviteSchema,
  resetPasswordSchema,
  updateUserSchema,
  usersListSchema,
} from "@/lib/Modules/Users/Schema";
import {
  createTokenExpiry,
  digestToken,
  generateToken,
  isTokenUsable,
} from "@/lib/Modules/Users/Token";
import {
  UsersDomainError,
  type AcceptedInviteUser,
  type DatabaseInviteToken,
  type DatabaseUser,
  type EffectiveUserRole,
  type GeneratedUserLink,
  type TokenMeta,
  type UserDatabase,
  type UserListItem,
  type UsersListResult,
} from "@/lib/Modules/Users/Types";

const credentialIssuer = "local:credential";

const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  isMaster: true,
  createdAt: true,
  updatedAt: true,
} as const;

function notFound(): UsersDomainError {
  return new UsersDomainError("NOT_FOUND", "User was not found");
}

function forbidden(): UsersDomainError {
  return new UsersDomainError(
    "FORBIDDEN",
    "You are not allowed to manage this user",
  );
}

function validation(): UsersDomainError {
  return new UsersDomainError("VALIDATION_ERROR", "Invalid user data");
}

function invalidToken(): UsersDomainError {
  return new UsersDomainError(
    "INVALID_TOKEN",
    "This link is invalid or has expired",
  );
}

function emailConflict(): UsersDomainError {
  return new UsersDomainError("CONFLICT", "This e-mail is already registered");
}

function linkFor(baseUrl: string, path: string, token: string): string {
  return new URL(`${path}/${token}`, baseUrl).toString();
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function asDatabaseUser(value: unknown): DatabaseUser | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<DatabaseUser>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.name !== "string" ||
    typeof candidate.email !== "string" ||
    (candidate.role !== "ADMIN" && candidate.role !== "EDITOR") ||
    typeof candidate.isMaster !== "boolean" ||
    !(candidate.createdAt instanceof Date)
  ) {
    return null;
  }
  return candidate as DatabaseUser;
}

function asDatabaseInviteToken(value: unknown): DatabaseInviteToken | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<DatabaseInviteToken>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.token !== "string" ||
    (candidate.type !== "INVITE" && candidate.type !== "PASSWORD_RESET") ||
    (candidate.role !== null &&
      candidate.role !== "ADMIN" &&
      candidate.role !== "EDITOR") ||
    (candidate.name !== null && typeof candidate.name !== "string") ||
    (candidate.targetUserId !== null &&
      typeof candidate.targetUserId !== "string") ||
    typeof candidate.createdById !== "string" ||
    !(candidate.expiresAt instanceof Date) ||
    (candidate.usedAt !== null && !(candidate.usedAt instanceof Date)) ||
    !(candidate.createdAt instanceof Date)
  ) {
    return null;
  }
  return candidate as DatabaseInviteToken;
}

function effectiveRole(user: DatabaseUser): EffectiveUserRole {
  return user.isMaster ? "MASTER" : user.role;
}

function toListItem(user: DatabaseUser): UserListItem {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: effectiveRole(user),
    isMaster: user.isMaster,
    createdAt: user.createdAt,
  };
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  if (!Number.isInteger(value)) return fallback;
  return Math.min(maximum, Math.max(1, value as number));
}

export class UsersService {
  private readonly databaseOverride?: UserDatabase;

  constructor(database?: UserDatabase) {
    this.databaseOverride = database;
  }

  /** Resolve Prisma lazily so generated clients survive development hot reloads. */
  private get database(): UserDatabase {
    return this.databaseOverride ?? (prisma as unknown as UserDatabase);
  }

  private async getUser(
    userId: string,
    database = this.database,
  ): Promise<DatabaseUser> {
    const user = asDatabaseUser(
      await database.user.findUnique({
        where: { id: userId },
        select: userSelect,
      }),
    );
    if (!user) throw notFound();
    return user;
  }

  private assertAdministrator(actor: DatabaseUser): void {
    if (!actor.isMaster && actor.role !== "ADMIN") throw forbidden();
  }

  private assertTargetMutationAllowed(
    actor: DatabaseUser,
    target: DatabaseUser,
  ): void {
    this.assertAdministrator(actor);
    if (target.isMaster || target.id === actor.id) throw forbidden();
    if (!actor.isMaster && target.role !== "EDITOR") throw forbidden();
  }

  async listUsers(
    actorId: string,
    input: unknown = {},
  ): Promise<UsersListResult> {
    const actor = await this.getUser(actorId);
    this.assertAdministrator(actor);

    const parsed = usersListSchema.safeParse(input);
    if (!parsed.success) throw validation();
    const page = boundedInteger(parsed.data.page, 1, 10_000);
    const pageSize = boundedInteger(parsed.data.pageSize, 25, 100);
    const search = parsed.data.q?.trim();
    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
          ],
        }
      : {};

    const [users, total] = await Promise.all([
      this.database.user.findMany({
        where,
        orderBy: [{ isMaster: "desc" }, { createdAt: "asc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: userSelect,
      }),
      this.database.user.count({ where }),
    ]);

    return {
      items: users.map((user) => {
        const parsedUser = asDatabaseUser(user);
        if (!parsedUser)
          throw new UsersDomainError("INVALID_STATE", "User data is invalid");
        return toListItem(parsedUser);
      }),
      total,
      page,
      pageSize,
    };
  }

  private async getValidToken(
    rawToken: string,
    type: "INVITE" | "PASSWORD_RESET",
    now: Date,
    database = this.database,
  ): Promise<DatabaseInviteToken> {
    const token = asDatabaseInviteToken(
      await database.inviteToken.findUnique({
        where: { token: digestToken(rawToken) },
      }),
    );
    if (
      !token ||
      token.type !== type ||
      token.usedAt !== null ||
      !isTokenUsable(token.expiresAt, now)
    ) {
      throw invalidToken();
    }
    return token;
  }

  async createInvite(
    actorId: string,
    input: unknown,
    baseUrl: string,
    now: Date = new Date(),
  ): Promise<GeneratedUserLink> {
    // Authorize before validation so EDITOR always gets FORBIDDEN, not 422.
    const actor = await this.getUser(actorId);
    this.assertAdministrator(actor);

    const parsed = createInviteSchema.safeParse(input);
    if (!parsed.success) throw validation();

    const rawToken = generateToken();
    const expiresAt = createTokenExpiry(now);
    await this.database.$transaction(async (tx) => {
      await tx.inviteToken.create({
        data: {
          token: digestToken(rawToken),
          type: "INVITE",
          role: parsed.data.role,
          name: parsed.data.name,
          targetUserId: null,
          createdById: actor.id,
          expiresAt,
        },
      });
      await logEvent(tx, {
        userId: actor.id,
        action: "USER_INVITE_CREATED",
        objectType: "USER",
        objectLabel: parsed.data.name,
      });
    });

    return {
      url: linkFor(baseUrl, "/admin/invite", rawToken),
      expiresAt,
    };
  }

  async getInviteMeta(
    rawToken: string,
    now: Date = new Date(),
  ): Promise<TokenMeta> {
    const token = await this.getValidToken(rawToken, "INVITE", now);
    if (!token.name || !token.role) throw invalidToken();
    return { name: token.name, role: token.role, expiresAt: token.expiresAt };
  }

  async acceptInvite(
    rawToken: string,
    input: unknown,
    now: Date = new Date(),
  ): Promise<AcceptedInviteUser> {
    const parsed = acceptInviteSchema.safeParse(input);
    if (!parsed.success) throw validation();

    // Token first: invalid/forged values must not pay Argon2id (CPU/RAM DoS). gitleaks:allow
    const preview = await this.getValidToken(rawToken, "INVITE", now);
    if (!preview.name || !preview.role) throw invalidToken();

    // Hash outside the transaction so Argon2id does not hold a DB connection.
    const passwordHash = await hashPassword(parsed.data.password);

    try {
      return await this.database.$transaction(async (tx) => {
        const token = await this.getValidToken(rawToken, "INVITE", now, tx);
        if (!token.name || !token.role) throw invalidToken();

        const existing = await tx.user.findUnique({
          where: { email: parsed.data.email },
          select: userSelect,
        });
        if (existing) throw emailConflict();

        const claimed = await tx.inviteToken.updateMany({
          where: {
            id: token.id,
            usedAt: null,
            expiresAt: { gt: now },
          },
          data: { usedAt: now },
        });
        if (claimed.count !== 1) throw invalidToken();

        const userId = randomUUID();
        const created = asDatabaseUser(
          await tx.user.create({
            data: {
              id: userId,
              name: token.name,
              email: parsed.data.email,
              emailVerified: false,
              role: token.role,
              isMaster: false,
            },
          }),
        );
        if (!created)
          throw new UsersDomainError("INVALID_STATE", "User data is invalid");

        await tx.account.create({
          data: {
            id: randomUUID(),
            issuer: credentialIssuer,
            accountId: userId,
            providerId: "credential",
            userId,
            password: passwordHash,
          },
        });

        await logEvent(tx, {
          userId,
          action: "USER_INVITE_ACCEPTED",
          objectType: "USER",
          objectLabel: created.name,
        });

        return {
          id: created.id,
          name: created.name,
          email: created.email,
          role: created.role,
        };
      });
    } catch (error) {
      if (error instanceof UsersDomainError) throw error;
      if (isUniqueConstraintError(error)) throw emailConflict();
      throw error;
    }
  }

  async createPasswordReset(
    actorId: string,
    targetUserId: string,
    baseUrl: string,
    now: Date = new Date(),
  ): Promise<GeneratedUserLink> {
    const rawToken = generateToken();
    const expiresAt = createTokenExpiry(now);
    await this.database.$transaction(async (tx) => {
      const actor = await this.getUser(actorId, tx);
      const target = await this.getUser(targetUserId, tx);
      this.assertTargetMutationAllowed(actor, target);

      await tx.inviteToken.create({
        data: {
          token: digestToken(rawToken),
          type: "PASSWORD_RESET",
          role: null,
          name: null,
          targetUserId: target.id,
          createdById: actor.id,
          expiresAt,
        },
      });
      await logEvent(tx, {
        userId: actor.id,
        action: "USER_PASSWORD_RESET_CREATED",
        objectType: "USER",
        objectLabel: target.name,
      });
    });

    return {
      url: linkFor(baseUrl, "/admin/reset-password", rawToken),
      expiresAt,
    };
  }

  async getPasswordResetMeta(
    rawToken: string,
    now: Date = new Date(),
  ): Promise<TokenMeta> {
    const token = await this.getValidToken(rawToken, "PASSWORD_RESET", now);
    if (!token.targetUserId) throw invalidToken();
    const target = await this.getUser(token.targetUserId);
    if (target.isMaster) throw invalidToken();
    return {
      name: target.name,
      role: target.role,
      expiresAt: token.expiresAt,
    };
  }

  async resetPassword(
    rawToken: string,
    input: unknown,
    now: Date = new Date(),
  ): Promise<void> {
    const parsed = resetPasswordSchema.safeParse(input);
    if (!parsed.success) throw validation();

    // Token first: invalid/forged values must not pay Argon2id (CPU/RAM DoS). gitleaks:allow
    await this.getValidToken(rawToken, "PASSWORD_RESET", now);

    // Hash outside the transaction so Argon2id does not hold a DB connection.
    const passwordHash = await hashPassword(parsed.data.password);

    await this.database.$transaction(async (tx) => {
      const token = await this.getValidToken(
        rawToken,
        "PASSWORD_RESET",
        now,
        tx,
      );
      if (!token.targetUserId) throw invalidToken();
      const target = await this.getUser(token.targetUserId, tx);
      if (target.isMaster) throw invalidToken();

      const claimed = await tx.inviteToken.updateMany({
        where: {
          id: token.id,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) throw invalidToken();

      const account = await tx.account.findUnique({
        where: {
          issuer_accountId: {
            issuer: credentialIssuer,
            accountId: target.id,
          },
        },
      });
      if (
        !account ||
        typeof account !== "object" ||
        typeof (account as { id?: unknown }).id !== "string"
      ) {
        throw new UsersDomainError(
          "INVALID_STATE",
          "Credential account is missing",
        );
      }

      await tx.account.update({
        where: { id: (account as { id: string }).id },
        data: { password: passwordHash },
      });
      await tx.session.deleteMany({ where: { userId: target.id } });
      await logEvent(tx, {
        userId: target.id,
        action: "USER_PASSWORD_RESET_COMPLETED",
        objectType: "USER",
        objectLabel: target.name,
      });
    });
  }

  /**
   * Atualiza name/email/role do alvo (mesmo PATCH).
   * Aceita string legada = só role; sessão só é revogada se o role mudar.
   */
  async changeRole(
    actorId: string,
    targetUserId: string,
    input: unknown,
  ): Promise<UserListItem> {
    const candidate =
      input && typeof input === "object" && !Array.isArray(input)
        ? input
        : { role: input };
    const parsed = updateUserSchema.safeParse(candidate);
    if (!parsed.success) throw validation();

    try {
      return await this.database.$transaction(async (tx) => {
        const actor = await this.getUser(actorId, tx);
        const target = await this.getUser(targetUserId, tx);
        this.assertTargetMutationAllowed(actor, target);

        const data: Record<string, unknown> = {};
        if (
          parsed.data.name !== undefined &&
          parsed.data.name !== target.name
        ) {
          data.name = parsed.data.name;
        }
        if (
          parsed.data.email !== undefined &&
          parsed.data.email !== target.email
        ) {
          data.email = parsed.data.email;
        }
        const roleChanged =
          parsed.data.role !== undefined && parsed.data.role !== target.role;
        if (roleChanged) data.role = parsed.data.role;

        if (Object.keys(data).length === 0) return toListItem(target);

        const updated = asDatabaseUser(
          await tx.user.update({
            where: { id: target.id },
            data,
          }),
        );
        if (!updated) {
          throw new UsersDomainError("INVALID_STATE", "User data is invalid");
        }

        // Role muda → sessões do painel e tokens OAuth (refresh incluso).
        if (roleChanged) {
          await tx.session.deleteMany({ where: { userId: target.id } });
          await tx.oauthAccessToken.deleteMany({
            where: { userId: target.id },
          });
          await tx.oauthRefreshToken.deleteMany({
            where: { userId: target.id },
          });
        }

        await logEvent(tx, {
          userId: actor.id,
          action: roleChanged ? "USER_ROLE_CHANGED" : "USER_UPDATED",
          objectType: "USER",
          objectLabel: updated.name,
        });
        return toListItem(updated);
      });
    } catch (error) {
      if (error instanceof UsersDomainError) throw error;
      if (isUniqueConstraintError(error)) throw emailConflict();
      throw error;
    }
  }

  async removeUser(actorId: string, targetUserId: string): Promise<void> {
    await this.database.$transaction(async (tx) => {
      const actor = await this.getUser(actorId, tx);
      const target = await this.getUser(targetUserId, tx);
      this.assertTargetMutationAllowed(actor, target);

      // Page.authorId uses onDelete: Restrict — reassign authored pages to the
      // actor so removal succeeds for productive Editors/Admins.
      await tx.page.updateMany({
        where: { authorId: target.id },
        data: { authorId: actor.id },
      });
      await tx.session.deleteMany({ where: { userId: target.id } });
      await tx.user.delete({ where: { id: target.id } });
      await logEvent(tx, {
        userId: actor.id,
        action: "USER_REMOVED",
        objectType: "USER",
        objectLabel: target.name,
      });
    });
  }

  /** Overview da Home: total de usuários + admins (sem Master no subtotal). */
  async countOverview(): Promise<UsersOverview> {
    const [total, adminCount] = await Promise.all([
      this.database.user.count({}),
      this.database.user.count({ where: { role: "ADMIN", isMaster: false } }),
    ]);
    return { total, adminCount };
  }
}

export type UsersOverview = {
  total: number;
  adminCount: number;
};

export const usersService = new UsersService();
