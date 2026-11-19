import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { getAutomaticNotificationRecipientIds } from "@/lib/SideEffects/Recipients";

describe("automatic notification recipients", () => {
  it("selects only Master/Administrator IDs and removes duplicates", async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([
        { id: "master-id" },
        { id: "admin-id" },
        { id: "master-id" },
      ]);

    await expect(
      getAutomaticNotificationRecipientIds({ user: { findMany } }),
    ).resolves.toEqual(["master-id", "admin-id"]);
    expect(findMany).toHaveBeenCalledWith({
      where: { OR: [{ isMaster: true }, { role: "ADMIN" }] },
      select: { id: true },
    });
  });
});
