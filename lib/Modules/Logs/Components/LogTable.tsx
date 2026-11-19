"use client";

import { DataTable, type DataTableColumn } from "@/components/Shared/DataTable";
import type { PanelDictionary } from "@/lib/i18n/panel";
import type { LogListItem, LogObjectTypeValue } from "@/lib/Modules/Logs/Types";
import {
  formatPanelDateTime,
  type PanelFormatSettings,
} from "@/lib/Modules/Settings/format";

type LogsCopy = PanelDictionary["logs"];

export type LogListItemDto = Omit<LogListItem, "createdAt"> & {
  createdAt: string | Date;
};

function objectLabel(copy: LogsCopy, type: LogObjectTypeValue): string {
  return copy.objectLabels[type] ?? type;
}

export function LogTable({
  copy,
  rows,
  formatSettings,
  locale = "en",
}: {
  copy: LogsCopy;
  rows: LogListItemDto[];
  formatSettings?: PanelFormatSettings;
  locale?: string;
}) {
  const columns: DataTableColumn<LogListItemDto>[] = [
    {
      key: "date",
      header: copy.date,
      render: (item) => {
        const date = new Date(item.createdAt);
        return (
          <time
            dateTime={
              Number.isNaN(date.getTime()) ? undefined : date.toISOString()
            }
          >
            {formatPanelDateTime(item.createdAt, formatSettings, locale)}
          </time>
        );
      },
    },
    {
      key: "user",
      header: copy.user,
      render: (item) => (
        <div className="min-w-36">
          <p className="font-medium">{item.actor.name ?? copy.removedUser}</p>
          {item.actor.role ? (
            <p className="text-muted-foreground mt-0.5 text-xs">
              {copy.roles[item.actor.role] ?? item.actor.role}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      key: "action",
      header: copy.action,
      render: (item) => copy.actionLabels[item.action] ?? item.action,
    },
    {
      key: "object",
      header: copy.object,
      render: (item) => objectLabel(copy, item.objectType),
    },
    {
      key: "target",
      header: copy.target,
      className: "max-w-[30rem]",
      render: (item) => (
        <span className="block max-w-[30rem] break-words">
          {item.objectLabel}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      empty={
        <div className="border-border text-muted-foreground border border-dashed px-4 py-12 text-center text-sm">
          {copy.empty}
        </div>
      }
      rows={rows}
    />
  );
}
