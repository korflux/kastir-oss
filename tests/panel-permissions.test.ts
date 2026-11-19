import { describe, expect, it } from "vitest";

import {
  MENU_ITEMS,
  findMenuItemForPath,
  partitionBottomNav,
  toEffectiveRole,
  visibleMenuItems,
} from "@/lib/Modules/Panel/Permissions";

describe("panel permissions", () => {
  it("derives the master role from isMaster", () => {
    expect(toEffectiveRole({ role: "EDITOR", isMaster: true })).toBe("MASTER");
  });

  it("accepts only the supported non-master roles", () => {
    expect(toEffectiveRole({ role: "ADMIN", isMaster: false })).toBe("ADMIN");
    expect(toEffectiveRole({ role: "EDITOR", isMaster: false })).toBe("EDITOR");
  });

  it("fails closed for an invalid role", () => {
    expect(() => toEffectiveRole({ role: "OWNER", isMaster: false })).toThrow(
      "Invalid panel role",
    );
    expect(() => toEffectiveRole({ role: undefined })).toThrow(
      "Invalid panel role",
    );
  });

  it("shows Home + six topbar items to master/admin and five modules to editor", () => {
    expect(visibleMenuItems("MASTER")).toHaveLength(7);
    expect(visibleMenuItems("ADMIN")).toHaveLength(7);
    expect(visibleMenuItems("EDITOR")).toHaveLength(6);
    expect(visibleMenuItems("MASTER").map((item) => item.key)).toEqual([
      "home",
      "panel",
      "pages",
      "media",
      "scripts",
      "splitTests",
      "users",
    ]);
    expect(visibleMenuItems("EDITOR").map((item) => item.key)).toEqual([
      "home",
      "panel",
      "pages",
      "media",
      "scripts",
      "splitTests",
    ]);
    // Setup items left the top-level menu (engrenagem until Scope 9).
    expect(MENU_ITEMS.map((item) => item.key)).not.toContain("settings");
    expect(MENU_ITEMS.map((item) => item.key)).not.toContain("backup");
  });

  it("matches exact routes and subroutes without letting panel capture them", () => {
    expect(findMenuItemForPath("/")?.key).toBe("home");
    expect(findMenuItemForPath("/admin")?.key).toBe("panel");
    expect(findMenuItemForPath("/admin/")?.key).toBe("panel");
    expect(findMenuItemForPath("/admin/users")?.key).toBe("users");
    expect(findMenuItemForPath("/admin/users/123")?.key).toBe("users");
    expect(findMenuItemForPath("/admin/custom-code")?.key).toBe("scripts");
    expect(findMenuItemForPath("/admin/custom-code/abc")?.key).toBe("scripts");
    // Rotas de Setup ainda existem, mas não têm item de menu no top.
    expect(findMenuItemForPath("/admin/logs")).toBeUndefined();
    expect(findMenuItemForPath("/admin/settings")).toBeUndefined();
    expect(findMenuItemForPath("/admin/unknown")).toBeUndefined();
  });

  it("partitions visible items into fixed primary and overflow navigation", () => {
    const master = partitionBottomNav(visibleMenuItems("MASTER"));
    const editor = partitionBottomNav(visibleMenuItems("EDITOR"));

    expect(master.primary.map((item) => item.key)).toEqual([
      "panel",
      "pages",
      "media",
      "scripts",
    ]);
    expect(master.overflow.map((item) => item.key)).toEqual([
      "splitTests",
      "users",
    ]);
    expect(editor.primary.map((item) => item.key)).toEqual([
      "panel",
      "pages",
      "media",
      "scripts",
    ]);
    expect(editor.overflow.map((item) => item.key)).toEqual(["splitTests"]);
    // Home só no topbar; bottom nav não carrega o link do site público.
    expect(master.primary.map((item) => item.key)).not.toContain("home");
    expect(master.overflow.map((item) => item.key)).not.toContain("home");
    expect(MENU_ITEMS[0].href).toBe("/");
    expect(MENU_ITEMS[0].key).toBe("home");
  });
});
