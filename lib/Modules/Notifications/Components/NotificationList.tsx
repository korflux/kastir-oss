"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { isInternalNotificationLink } from "@/lib/Modules/Notifications/Schema";
import type { PanelDictionary } from "@/lib/i18n/panel";
import {
  formatPanelDateTime,
  type PanelFormatSettings,
} from "@/lib/Modules/Settings/format";

type NotificationsCopy = PanelDictionary["notifications"];

export type NotificationItem = {
  id: string;
  message: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

export function NotificationList({
  copy,
  error,
  items,
  loading,
  locale,
  formatSettings,
  onMarkAsRead,
  onRetry,
}: {
  copy: NotificationsCopy;
  error: boolean;
  items: NotificationItem[];
  loading: boolean;
  locale: string;
  formatSettings?: PanelFormatSettings;
  onMarkAsRead: (notificationId: string) => Promise<void>;
  onRetry: () => void;
}) {
  const [markingId, setMarkingId] = useState<string | null>(null);

  const formatDate = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";

    return formatPanelDateTime(date, formatSettings, locale);
  };

  const markAsRead = async (notificationId: string) => {
    setMarkingId(notificationId);
    try {
      await onMarkAsRead(notificationId);
    } finally {
      setMarkingId(null);
    }
  };

  if (loading && items.length === 0) {
    return (
      <div
        aria-busy="true"
        className="text-muted-foreground px-4 py-10 text-center text-sm"
        role="status"
      >
        {copy.loading}
      </div>
    );
  }

  if (error && items.length === 0) {
    return (
      <div className="grid gap-3 px-4 py-10 text-center" role="alert">
        <p className="text-destructive text-sm">{copy.error}</p>
        <Button
          className="mx-auto"
          size="sm"
          variant="outline"
          onClick={onRetry}
        >
          {copy.retry}
        </Button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div
        className="text-muted-foreground px-4 py-10 text-center text-sm"
        role="status"
      >
        {copy.empty}
      </div>
    );
  }

  return (
    <div className="max-h-[min(60vh,32rem)] overflow-y-auto">
      {loading ? (
        <div
          className="text-muted-foreground border-b px-4 py-2 text-xs"
          role="status"
        >
          {copy.loading}
        </div>
      ) : null}
      <ul aria-live="polite" className="divide-y" role="list">
        {items.map((item) => {
          const isUnread = item.readAt === null;
          const safeLink =
            item.link && isInternalNotificationLink(item.link)
              ? item.link
              : null;

          return (
            <li
              className={isUnread ? "bg-muted/40 px-4 py-3" : "px-4 py-3"}
              data-state={isUnread ? "unread" : "read"}
              key={item.id}
            >
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className={
                    isUnread
                      ? "bg-primary mt-1.5 size-2 shrink-0 rounded-full"
                      : "border-muted-foreground mt-1.5 size-2 shrink-0 rounded-full border"
                  }
                />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="text-sm leading-5 break-words">
                    {item.message}
                  </p>
                  <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    <time dateTime={item.createdAt}>
                      {formatDate(item.createdAt)}
                    </time>
                    <span aria-hidden="true">·</span>
                    <span>{isUnread ? copy.unread : copy.read}</span>
                    {safeLink ? (
                      <Link
                        className="text-primary underline-offset-3 hover:underline"
                        href={safeLink}
                      >
                        {copy.relatedLink}
                      </Link>
                    ) : null}
                  </div>
                </div>
                {isUnread ? (
                  <Button
                    aria-label={`${copy.markAsRead}: ${item.message}`}
                    disabled={markingId === item.id}
                    size="xs"
                    variant="outline"
                    onClick={() => void markAsRead(item.id)}
                  >
                    {copy.markAsRead}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
