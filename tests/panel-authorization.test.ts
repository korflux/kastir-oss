import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

import {
  authorizePanelPath,
  canBulkMutate,
  canPermanentlyDelete,
  type PanelSession,
} from "@/lib/Modules/Panel/Authorization";

function session(user: Partial<PanelSession["user"]>): PanelSession {
  return {
    user: {
      id: "user-id",
      name: "Test user",
      email: "user@example.com",
      role: "ADMIN",
      isMaster: false,
      ...user,
    },
  };
}

describe("panel authorization", () => {
  it("allows a master to access restricted routes and subroutes", () => {
    expect(
      authorizePanelPath("/admin/users/123", session({ isMaster: true })),
    ).toMatchObject({ status: "allow", role: "MASTER" });
  });

  it("allows an admin to access setup subroutes", () => {
    expect(
      authorizePanelPath("/admin/settings/logs", session({})),
    ).toMatchObject({ status: "allow", role: "ADMIN" });
    expect(
      authorizePanelPath("/admin/settings/general", session({})),
    ).toMatchObject({ status: "allow", role: "ADMIN" });
  });

  it("allows editors only on setup connections", () => {
    expect(
      authorizePanelPath(
        "/admin/settings/connections",
        session({ role: "EDITOR" }),
      ),
    ).toMatchObject({ status: "allow", role: "EDITOR" });
    expect(
      authorizePanelPath(
        "/admin/settings/general",
        session({ role: "EDITOR" }),
      ),
    ).toMatchObject({ status: "forbidden", role: "EDITOR" });
  });

  it("forbids editors from restricted routes", () => {
    expect(
      authorizePanelPath("/admin/users/123", session({ role: "EDITOR" })),
    ).toMatchObject({ status: "forbidden", role: "EDITOR" });
  });

  it("fails closed when the session role is invalid", () => {
    expect(
      authorizePanelPath("/admin/settings/site", session({ role: "OWNER" })),
    ).toEqual({ status: "forbidden" });
  });

  it("requires login for anonymous requests", () => {
    expect(authorizePanelPath("/admin", null)).toEqual({ status: "login" });
  });

  it("fails closed for unknown admin paths even when authenticated", () => {
    expect(
      authorizePanelPath("/admin/not-a-route", session({ isMaster: true })),
    ).toMatchObject({ status: "forbidden", role: "MASTER" });
    expect(
      authorizePanelPath("/admin/unknown", session({ role: "EDITOR" })),
    ).toMatchObject({ status: "forbidden", role: "EDITOR" });
  });

  it("allows the dedicated forbidden page for authenticated roles", () => {
    expect(
      authorizePanelPath("/admin/forbidden", session({ role: "EDITOR" })),
    ).toMatchObject({ status: "allow", role: "EDITOR" });
  });

  it("allows bulk mutations only for master and admin roles", () => {
    expect(canBulkMutate("MASTER")).toBe(true);
    expect(canBulkMutate("ADMIN")).toBe(true);
    expect(canBulkMutate("EDITOR")).toBe(false);
    expect(canBulkMutate("OWNER" as never)).toBe(false);
  });

  it("allows permanent deletion only for master and admin roles", () => {
    expect(canPermanentlyDelete("MASTER")).toBe(true);
    expect(canPermanentlyDelete("ADMIN")).toBe(true);
    expect(canPermanentlyDelete("EDITOR")).toBe(false);
  });
});
