"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PanelDictionary } from "@/lib/i18n/panel";
import {
  LOG_OBJECT_TYPES,
  type LogObjectTypeValue,
} from "@/lib/Modules/Logs/Types";

type LogsCopy = PanelDictionary["logs"];

export type LogUserOption = {
  id: string;
  name: string;
  role: "MASTER" | "ADMIN" | "EDITOR";
};

export type LogFilterValues = {
  userId?: string;
  from?: string;
  to?: string;
  objectType?: LogObjectTypeValue;
};

function localDateTimeToUtc(
  value: string,
  endOfSecond = false,
): string | undefined {
  if (!value) return undefined;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  if (endOfSecond) date.setMilliseconds(999);
  return date.toISOString();
}

export function LogFilters({
  copy,
  users,
  onApply,
  onClear,
}: {
  copy: LogsCopy;
  users: LogUserOption[];
  onApply: (values: LogFilterValues) => void;
  onClear: () => void;
}) {
  const [userId, setUserId] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [objectType, setObjectType] = React.useState<LogObjectTypeValue | "">(
    "",
  );

  return (
    <form
      className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1.2fr_1fr_1fr_1.2fr_auto_auto] xl:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        onApply({
          userId: userId || undefined,
          from: localDateTimeToUtc(from),
          to: localDateTimeToUtc(to, true),
          objectType: objectType || undefined,
        });
      }}
    >
      <label className="space-y-1 text-sm" htmlFor="logs-user-filter">
        <span>{copy.user}</span>
        <select
          className="border-input bg-background h-8 w-full rounded-lg border px-2 text-sm"
          id="logs-user-filter"
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
        >
          <option value="">{copy.allUsers}</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name} ({copy.roles[user.role] ?? user.role})
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-sm" htmlFor="logs-from-filter">
        <span>{copy.from}</span>
        <Input
          id="logs-from-filter"
          type="datetime-local"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
        />
      </label>
      <label className="space-y-1 text-sm" htmlFor="logs-to-filter">
        <span>{copy.to}</span>
        <Input
          id="logs-to-filter"
          type="datetime-local"
          value={to}
          onChange={(event) => setTo(event.target.value)}
        />
      </label>
      <label className="space-y-1 text-sm" htmlFor="logs-object-filter">
        <span>{copy.object}</span>
        <select
          className="border-input bg-background h-8 w-full rounded-lg border px-2 text-sm"
          id="logs-object-filter"
          value={objectType}
          onChange={(event) =>
            setObjectType(event.target.value as LogObjectTypeValue | "")
          }
        >
          <option value="">{copy.allObjects}</option>
          {LOG_OBJECT_TYPES.map((type) => (
            <option key={type} value={type}>
              {copy.objectLabels[type] ?? type}
            </option>
          ))}
        </select>
      </label>
      <Button className="rounded-full" type="submit">
        {copy.apply}
      </Button>
      <Button
        className="rounded-full"
        type="button"
        variant="destructive"
        onClick={() => {
          setUserId("");
          setFrom("");
          setTo("");
          setObjectType("");
          onClear();
        }}
      >
        {copy.clear}
      </Button>
    </form>
  );
}
