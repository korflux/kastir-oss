import { describe, expect, it } from "vitest";

import { formatNotificationBadge } from "@/lib/Modules/Notifications/Components/NotificationBell";

describe("notification badge", () => {
  it("hides zero and caps visible counts at 9+", () => {
    expect(formatNotificationBadge(0)).toBeNull();
    expect(formatNotificationBadge(1)).toBe("1");
    expect(formatNotificationBadge(9)).toBe("9");
    expect(formatNotificationBadge(10)).toBe("9+");
    expect(formatNotificationBadge(99)).toBe("9+");
  });
});
