import type { LogObjectType } from "@/app/generated/prisma/client";

/** Tetos do sink de auditoria (Postgres TEXT é ilimitado; o painel não precisa de megabytes). */
export const LOG_EVENT_LIMITS = {
  action: 128,
  objectLabel: 500,
  tool: 128,
  resource: 2048,
  requestId: 128,
  objectId: 128,
} as const;

export type LogEventContext = {
  source?: "PANEL" | "MCP";
  tool?: string;
  resource?: string;
  requestId?: string;
  objectId?: string;
};

type LogEntryWriter = {
  logEntry: {
    create(args: {
      data: {
        userId: string;
        action: string;
        objectType: LogObjectType;
        objectLabel: string;
        source?: "PANEL" | "MCP";
        tool?: string;
        resource?: string;
        requestId?: string;
        objectId?: string;
      };
    }): Promise<unknown>;
  };
};

export type LogEventInput = {
  userId: string;
  /** Literal de domínio (PAGE_CREATED, USER_REMOVED, …) — não é só PageAction. */
  action: string;
  objectType: LogObjectType;
  objectLabel: string;
} & LogEventContext;

function clipAuditField(value: string, max: number): string {
  return value.replace(/[\r\n\0]/g, "").slice(0, max);
}

export async function logEvent(
  database: LogEntryWriter,
  input: LogEventInput,
): Promise<void> {
  const {
    userId,
    action,
    objectType,
    objectLabel,
    source,
    tool,
    resource,
    requestId,
    objectId,
  } = input;
  await database.logEntry.create({
    data: {
      userId,
      action: clipAuditField(action, LOG_EVENT_LIMITS.action),
      objectType,
      objectLabel: clipAuditField(objectLabel, LOG_EVENT_LIMITS.objectLabel),
      ...(source ? { source } : {}),
      ...(tool ? { tool: clipAuditField(tool, LOG_EVENT_LIMITS.tool) } : {}),
      ...(resource
        ? { resource: clipAuditField(resource, LOG_EVENT_LIMITS.resource) }
        : {}),
      ...(requestId
        ? { requestId: clipAuditField(requestId, LOG_EVENT_LIMITS.requestId) }
        : {}),
      ...(objectId
        ? { objectId: clipAuditField(objectId, LOG_EVENT_LIMITS.objectId) }
        : {}),
    },
  });
}
