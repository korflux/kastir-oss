export const LOG_OBJECT_TYPES = [
  "PAGE",
  "FOLDER",
  "MEDIA",
  "SCRIPT",
  "USER",
  "SETTINGS",
  "SPLIT_TEST",
] as const;

export type LogObjectTypeValue = (typeof LOG_OBJECT_TYPES)[number];
export type LogActorRole = "MASTER" | "ADMIN" | "EDITOR";

export const LEGACY_MEDIA_FOLDER_ACTIONS = [
  "MEDIA_FOLDER_CREATED",
  "MEDIA_FOLDER_RENAMED",
  "MEDIA_FOLDER_RECOLORED",
  "MEDIA_FOLDER_DELETED",
] as const;

export type LegacyMediaFolderAction =
  (typeof LEGACY_MEDIA_FOLDER_ACTIONS)[number];

export function isLegacyMediaFolderAction(
  action: string,
): action is LegacyMediaFolderAction {
  return (LEGACY_MEDIA_FOLDER_ACTIONS as readonly string[]).includes(action);
}

export function effectiveLogObjectType(input: {
  objectType: LogObjectTypeValue;
  action: string;
}): LogObjectTypeValue {
  if (input.objectType === "MEDIA" && isLegacyMediaFolderAction(input.action)) {
    return "FOLDER";
  }

  return input.objectType;
}

export type DatabaseLogActor = {
  id: string;
  name: string;
  role: "ADMIN" | "EDITOR";
  isMaster: boolean;
};

export type LogEntryRecord = {
  id: string;
  userId: string;
  action: string;
  objectType: LogObjectTypeValue;
  objectLabel: string;
  objectId?: string | null;
  source?: "PANEL" | "MCP";
  tool?: string | null;
  resource?: string | null;
  requestId?: string | null;
  createdAt: Date;
};

export type LogActorSummary = {
  id: string;
  name: string | null;
  role: LogActorRole | null;
  removed: boolean;
};

export type LogListItem = {
  id: string;
  userId: string;
  actor: LogActorSummary;
  action: string;
  objectType: LogObjectTypeValue;
  objectLabel: string;
  objectId: string | null;
  source: "PANEL" | "MCP";
  tool: string | null;
  resource: string | null;
  requestId: string | null;
  createdAt: Date;
};

export type LogsFilter = {
  page: number;
  pageSize: number;
  userId?: string;
  from?: Date;
  to?: Date;
  objectType?: LogObjectTypeValue;
};

export type LogsListResult = {
  items: LogListItem[];
  total: number;
  page: number;
  pageSize: number;
};

export type LogWhere = {
  AND?: LogWhere[];
  OR?: LogWhere[];
  userId?: string;
  action?: { in?: readonly string[]; notIn?: readonly string[] };
  objectType?: LogObjectTypeValue;
  createdAt?: { gte?: Date; lte?: Date };
};

export type LogsDatabase = {
  user: {
    findUnique(args: {
      where: { id: string };
      select: Record<string, boolean>;
    }): Promise<DatabaseLogActor | null>;
    findMany(args: {
      where: { id: { in: string[] } };
      select: Record<string, boolean>;
    }): Promise<DatabaseLogActor[]>;
  };
  logEntry: {
    findMany(args: {
      where: LogWhere;
      orderBy: Array<{ createdAt: "desc" } | { id: "desc" }>;
      skip: number;
      take: number;
      select: Record<string, boolean>;
    }): Promise<LogEntryRecord[]>;
    count(args: { where: LogWhere }): Promise<number>;
  };
};
