"use client";

import { useCallback, useState } from "react";
import { Bell, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  NotificationList,
  type NotificationItem,
} from "@/lib/Modules/Notifications/Components/NotificationList";
import type { PanelDictionary } from "@/lib/i18n/panel";
import type { PanelFormatSettings } from "@/lib/Modules/Settings/format";

type NotificationsCopy = PanelDictionary["notifications"];

type NotificationsResponse = {
  items: NotificationItem[];
  unreadCount: number;
};

export function NotificationBell({
  buttonClassName,
  copy,
  initialUnreadCount,
  locale,
  formatSettings,
}: {
  buttonClassName?: string;
  copy: NotificationsCopy;
  initialUnreadCount: number;
  locale: string;
  formatSettings?: PanelFormatSettings;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(() =>
    normalizeUnreadCount(initialUnreadCount),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await fetch(
        "/api/admin/notifications?page=1&pageSize=20",
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("Unable to load notifications");
      const result = (await response.json()) as NotificationsResponse;
      setItems(result.items);
      setUnreadCount(normalizeUnreadCount(result.unreadCount));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) void load();
  };

  const markAsRead = async (notificationId: string) => {
    const previousItems = items;
    const previousUnreadCount = unreadCount;
    const optimisticReadAt = new Date().toISOString();

    setItems((current) =>
      current.map((item) =>
        item.id === notificationId
          ? { ...item, readAt: optimisticReadAt }
          : item,
      ),
    );
    setUnreadCount((current) => Math.max(0, current - 1));
    setError(false);

    try {
      const response = await fetch(
        `/api/admin/notifications/${encodeURIComponent(notificationId)}/read`,
        {
          method: "POST",
          cache: "no-store",
        },
      );
      if (!response.ok) throw new Error("Unable to mark notification as read");
      const result = (await response.json()) as {
        notification: NotificationItem;
        unreadCount: number;
      };
      setItems((current) =>
        current.map((item) =>
          item.id === notificationId ? result.notification : item,
        ),
      );
      setUnreadCount(normalizeUnreadCount(result.unreadCount));
    } catch {
      setItems(previousItems);
      setUnreadCount(previousUnreadCount);
      setError(true);
    }
  };

  const badgeLabel = copy.unreadCount.replace(
    "{count}",
    formatNotificationBadge(unreadCount) ?? "0",
  );

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogTrigger
        render={
          <Button
            aria-label={copy.buttonLabel}
            className={
              buttonClassName ? `relative ${buttonClassName}` : "relative"
            }
            size="icon"
            title={copy.buttonLabel}
            variant="ghost"
          />
        }
      >
        <Bell />
        {unreadCount > 0 ? (
          <Badge
            aria-hidden="true"
            className="absolute -top-1 -right-1 min-w-5 px-1"
          >
            {formatNotificationBadge(unreadCount)}
          </Badge>
        ) : null}
        <span aria-live="polite" className="sr-only">
          {unreadCount > 0 ? badgeLabel : ""}
        </span>
      </DialogTrigger>
      <DialogContent
        className="max-w-xl gap-0 overflow-hidden p-0"
        showCloseButton={false}
      >
        <DialogHeader className="border-b px-4 py-4 pr-12">
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <DialogClose
          aria-label={copy.close}
          render={
            <Button
              className="absolute top-3 right-3"
              size="icon-sm"
              variant="ghost"
            />
          }
        >
          <X />
        </DialogClose>
        <NotificationList
          copy={copy}
          error={error}
          items={items}
          loading={loading}
          locale={locale}
          formatSettings={formatSettings}
          onMarkAsRead={markAsRead}
          onRetry={() => void load()}
        />
      </DialogContent>
    </Dialog>
  );
}

function normalizeUnreadCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function formatNotificationBadge(value: number): string | null {
  const count = normalizeUnreadCount(value);
  if (count === 0) return null;
  return count > 9 ? "9+" : String(count);
}
