"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  LogFilters,
  type LogFilterValues,
  type LogUserOption,
} from "@/lib/Modules/Logs/Components/LogFilters";
import {
  LogTable,
  type LogListItemDto,
} from "@/lib/Modules/Logs/Components/LogTable";
import type { PanelDictionary } from "@/lib/i18n/panel";
import type { LogsListResult } from "@/lib/Modules/Logs/Types";
import type { PanelFormatSettings } from "@/lib/Modules/Settings/format";

type LogsCopy = PanelDictionary["logs"];
type ApiError = Error & { code?: string };

type LogsResultDto = Omit<LogsListResult, "items"> & {
  items: LogListItemDto[];
};

type UsersListPayload = {
  users: {
    items: LogUserOption[];
    total: number;
    page: number;
    pageSize: number;
  };
};

const USERS_PAGE_SIZE = 100;

async function requestJson<T>(input: string): Promise<T> {
  const response = await fetch(input, { cache: "no-store" });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      code?: string;
    } | null;
    const error = new Error(payload?.error ?? "Request failed") as ApiError;
    error.code = payload?.code;
    throw error;
  }
  return (await response.json()) as T;
}

function normalizeResult(result: LogsListResult): LogsResultDto {
  return {
    ...result,
    items: result.items.map((item) => ({
      ...item,
      createdAt: new Date(item.createdAt).toISOString(),
    })),
  };
}

function queryForLogs(page: number, filters: LogFilterValues): string {
  const params = new URLSearchParams({ page: String(page), pageSize: "50" });
  if (filters.userId) params.set("userId", filters.userId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.objectType) params.set("objectType", filters.objectType);
  return params.toString();
}

/** Load every page of administrators' user directory for the filter select. */
async function loadAllUserOptions(): Promise<LogUserOption[]> {
  const collected: LogUserOption[] = [];
  let page = 1;
  let total = Number.POSITIVE_INFINITY;

  while (collected.length < total) {
    const result = await requestJson<UsersListPayload>(
      `/api/admin/users?page=${page}&pageSize=${USERS_PAGE_SIZE}`,
    );
    collected.push(...result.users.items);
    total = result.users.total;
    if (result.users.items.length === 0) break;
    page += 1;
    // Safety cap against pathological loops (10k users).
    if (page > 100) break;
  }

  return collected;
}

export function LogsWorkspace({
  copy,
  initialData,
  formatSettings,
  locale = "en",
}: {
  copy: LogsCopy;
  initialData: LogsListResult;
  formatSettings?: PanelFormatSettings;
  locale?: string;
}) {
  const [data, setData] = useState<LogsResultDto>(() =>
    normalizeResult(initialData),
  );
  const [users, setUsers] = useState<LogUserOption[]>([]);
  const [filters, setFilters] = useState<LogFilterValues>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (page: number, nextFilters: LogFilterValues) => {
      setLoading(true);
      setError(null);
      try {
        const result = await requestJson<LogsResultDto>(
          `/api/admin/logs?${queryForLogs(page, nextFilters)}`,
        );
        setData(result);
      } catch (loadError) {
        setError((loadError as ApiError).message || copy.error);
      } finally {
        setLoading(false);
      }
    },
    [copy.error],
  );

  const loadUsers = useCallback(async () => {
    try {
      setUsers(await loadAllUserOptions());
    } catch (loadError) {
      setError((loadError as ApiError).message || copy.error);
    }
  }, [copy.error]);

  useEffect(() => {
    void Promise.resolve().then(loadUsers);
  }, [loadUsers]);

  const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize));
  const pageSummary = useMemo(
    () =>
      copy.pageSummary
        .replace("{page}", String(data.page))
        .replace("{pages}", String(pageCount)),
    [copy.pageSummary, data.page, pageCount],
  );
  const totalSummary = useMemo(
    () => copy.totalCount.replace("{total}", String(data.total)),
    [copy.totalCount, data.total],
  );

  const applyFilters = (nextFilters: LogFilterValues) => {
    setFilters(nextFilters);
    void load(1, nextFilters);
  };

  const retry = () => void load(data.page, filters);

  // Shell Figma Logs: título grande + filtros inline + tabela (sem Card).
  return (
    <section
      className="flex w-full flex-1 flex-col gap-6 px-4 py-6 md:px-8 md:py-8 xl:px-10"
      data-testid="setup-logs"
    >
      <header>
        <h1 className="text-foreground text-4xl font-semibold tracking-tight md:text-5xl">
          {copy.title}
        </h1>
        <p className="text-muted-foreground mt-2 max-w-2xl text-base">
          {copy.description}
        </p>
      </header>

      {error ? (
        <div
          className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm"
          role="alert"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <Button size="sm" variant="outline" onClick={retry}>
              {copy.retry}
            </Button>
          </div>
        </div>
      ) : null}

      <LogFilters
        copy={copy}
        users={users}
        onApply={applyFilters}
        onClear={() => applyFilters({})}
      />

      <div
        className={
          loading ? "relative opacity-70 transition-opacity" : "relative"
        }
        aria-busy={loading}
      >
        {loading ? (
          <div className="text-muted-foreground mb-3 text-sm" role="status">
            {copy.loading}
          </div>
        ) : null}
        <LogTable
          copy={copy}
          formatSettings={formatSettings}
          locale={locale}
          rows={data.items}
        />
      </div>

      <div className="border-border flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <div
          className="text-muted-foreground flex flex-col gap-0.5 text-sm"
          aria-live="polite"
        >
          <span data-testid="logs-total-summary">{totalSummary}</span>
          <span data-testid="logs-page-summary">{pageSummary}</span>
        </div>
        <div className="flex gap-2">
          <Button
            disabled={loading || data.page <= 1}
            size="sm"
            variant="outline"
            onClick={() => void load(data.page - 1, filters)}
          >
            {copy.previous}
          </Button>
          <Button
            disabled={loading || data.page >= pageCount}
            size="sm"
            variant="outline"
            onClick={() => void load(data.page + 1, filters)}
          >
            {copy.next}
          </Button>
        </div>
      </div>
    </section>
  );
}
