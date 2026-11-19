import { z } from "zod";

import {
  LOG_OBJECT_TYPES,
  type LogObjectTypeValue,
  type LogsFilter,
} from "@/lib/Modules/Logs/Types";

export const DEFAULT_LOG_PAGE_SIZE = 50;
export const MAX_LOG_PAGE_SIZE = 100;

const optionalString = (max: number) =>
  z.string().trim().min(1).max(max).optional();

const isoDate = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(
    (value) => value.includes("T") && !Number.isNaN(Date.parse(value)),
    "Expected an ISO date-time",
  )
  .transform((value) => new Date(value));

const logsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_LOG_PAGE_SIZE)
    .default(DEFAULT_LOG_PAGE_SIZE),
  userId: optionalString(191),
  from: isoDate.optional(),
  to: isoDate.optional(),
  objectType: z.enum(LOG_OBJECT_TYPES).optional(),
});

function endOfSecond(date: Date): Date {
  if (date.getUTCMilliseconds() !== 0) return date;
  return new Date(date.getTime() + 999);
}

export function parseLogsQuery(params: URLSearchParams): LogsFilter {
  const parsed = logsQuerySchema.parse({
    page: params.get("page") ?? undefined,
    pageSize: params.get("pageSize") ?? undefined,
    userId: params.get("userId") ?? undefined,
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    objectType: params.get("objectType") ?? undefined,
  });

  const result: LogsFilter = {
    page: parsed.page,
    pageSize: parsed.pageSize,
    userId: parsed.userId,
    from: parsed.from,
    to: parsed.to ? endOfSecond(parsed.to) : undefined,
    objectType: parsed.objectType as LogObjectTypeValue | undefined,
  };

  if (result.from && result.to && result.from > result.to) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["from"],
        message: "The start date must be before the end date",
      },
    ]);
  }

  return result;
}
