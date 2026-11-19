export type EditableUserRole = "ADMIN" | "EDITOR";
export type EffectiveUserRole = "MASTER" | EditableUserRole;

export type UserAction =
  | "USER_INVITE_CREATED"
  | "USER_INVITE_ACCEPTED"
  | "USER_UPDATED"
  | "USER_ROLE_CHANGED"
  | "USER_REMOVED"
  | "USER_PASSWORD_RESET_CREATED"
  | "USER_PASSWORD_RESET_COMPLETED";

export type UsersDomainErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "CONFLICT"
  | "INVALID_TOKEN"
  | "INVALID_STATE";

export class UsersDomainError extends Error {
  constructor(
    public readonly code: UsersDomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "UsersDomainError";
  }
}

export type DatabaseUser = {
  id: string;
  name: string;
  email: string;
  role: EditableUserRole;
  isMaster: boolean;
  createdAt: Date;
  updatedAt?: Date;
};

export type UserListItem = {
  id: string;
  name: string;
  email: string;
  role: EffectiveUserRole;
  isMaster: boolean;
  createdAt: Date;
};

export type UsersListResult = {
  items: UserListItem[];
  total: number;
  page: number;
  pageSize: number;
};

export type UserTokenMeta = {
  name?: string;
  role?: EditableUserRole;
  expiresAt: Date;
};

export type GeneratedUserLink = {
  url: string;
  expiresAt: Date;
};

export type AcceptedInviteUser = {
  id: string;
  name: string;
  email: string;
  role: EditableUserRole;
};

export type DatabaseInviteToken = {
  id: string;
  token: string;
  type: "INVITE" | "PASSWORD_RESET";
  role: EditableUserRole | null;
  name: string | null;
  targetUserId: string | null;
  createdById: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
};

export type TokenMeta = {
  name: string;
  role: EditableUserRole;
  expiresAt: Date;
};

export type UserDatabase = {
  user: {
    findUnique(args: { where: unknown; select?: unknown }): Promise<unknown>;
    findMany(args?: {
      where?: unknown;
      orderBy?: unknown;
      skip?: number;
      take?: number;
      select?: unknown;
    }): Promise<unknown[]>;
    count(args?: { where?: unknown }): Promise<number>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    update(args: {
      where: unknown;
      data: Record<string, unknown>;
    }): Promise<unknown>;
    delete(args: { where: unknown }): Promise<unknown>;
  };
  account: {
    findUnique(args: { where: unknown; select?: unknown }): Promise<unknown>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    update(args: {
      where: unknown;
      data: Record<string, unknown>;
    }): Promise<unknown>;
  };
  session: {
    deleteMany(args: { where: unknown }): Promise<{ count: number }>;
  };
  oauthAccessToken: {
    deleteMany(args: { where: unknown }): Promise<{ count: number }>;
  };
  oauthRefreshToken: {
    deleteMany(args: { where: unknown }): Promise<{ count: number }>;
  };
  page: {
    updateMany(args: {
      where: unknown;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  inviteToken: {
    findUnique(args: { where: unknown; select?: unknown }): Promise<unknown>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    updateMany(args: {
      where: unknown;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  logEntry: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  $transaction<T>(callback: (tx: UserDatabase) => Promise<T>): Promise<T>;
};
