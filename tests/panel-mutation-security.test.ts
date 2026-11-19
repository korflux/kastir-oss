import { describe, expect, it, vi } from "vitest";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));

import {
  assertPanelMultipartLength,
  getTrustedPanelMutationAuth,
  getPanelMutationAuth,
  isTrustedPanelOrigin,
  PanelMutationBodyError,
  readConfirmedPanelMutation,
  readPanelMutationJson,
} from "@/lib/Modules/Panel/MutationSecurity";

function request(
  body: string,
  headers: Record<string, string> = { origin: "https://panel.example.com" },
) {
  return new Request("https://panel.example.com/api/admin/pages/bulk", {
    method: "POST",
    body,
    headers,
  });
}

describe("panel mutation security", () => {
  it("accepts only the configured HTTP origin", () => {
    expect(
      isTrustedPanelOrigin(request("{}"), "https://panel.example.com"),
    ).toBe(true);
    expect(
      isTrustedPanelOrigin(
        request("{}", { origin: "https://attacker.example" }),
        "https://panel.example.com",
      ),
    ).toBe(false);
    expect(
      isTrustedPanelOrigin(
        request("{}", { referer: "https://panel.example.com/admin/pages" }),
        "https://panel.example.com",
      ),
    ).toBe(true);
    expect(
      isTrustedPanelOrigin(
        request("{}", { origin: "null" }),
        "https://panel.example.com",
      ),
    ).toBe(false);
  });

  it("rejects multipart bodies that declare more than the allowed byte cap", () => {
    expect(() =>
      assertPanelMultipartLength(
        request("123456", { "content-length": "6" }),
        5,
      ),
    ).toThrow(PanelMutationBodyError);
    expect(() =>
      assertPanelMultipartLength(request("1234", { "content-length": "4" }), 5),
    ).not.toThrow();
  });

  it("parses valid JSON and rejects malformed or oversized bodies", async () => {
    await expect(
      readPanelMutationJson(request('{"ids":["one"]}')),
    ).resolves.toEqual({
      ids: ["one"],
    });
    await expect(
      readPanelMutationJson(request("not-json")),
    ).rejects.toMatchObject({
      code: "INVALID_BODY",
    });
    await expect(
      readPanelMutationJson(request("123456", { "content-length": "6" }), 5),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    await expect(
      readPanelMutationJson(request("123456"), 5),
    ).rejects.toBeInstanceOf(PanelMutationBodyError);
  });

  it("reports an authenticated session with an invalid role separately", async () => {
    getSession.mockResolvedValue({
      user: { id: "user-id", role: "OWNER", isMaster: false },
    });

    await expect(getPanelMutationAuth(request("{}"))).resolves.toEqual({
      status: "invalid-role",
    });
  });

  it("combines session authentication with the configured origin guard", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://panel.example.com");
    getSession.mockResolvedValue({
      user: { id: "admin-id", role: "ADMIN", isMaster: false },
    });

    await expect(
      getTrustedPanelMutationAuth(
        request("{}", { origin: "https://attacker.example" }),
      ),
    ).resolves.toEqual({ status: "untrusted-origin" });
    await expect(getTrustedPanelMutationAuth(request("{}"))).resolves.toEqual({
      status: "authenticated",
      userId: "admin-id",
      role: "ADMIN",
    });
  });

  it("accepts only the strict permanent-action confirmation", async () => {
    await expect(
      readConfirmedPanelMutation(request('{"confirmed":true}')),
    ).resolves.toBeUndefined();
    await expect(
      readConfirmedPanelMutation(request('{"confirmed":false}')),
    ).rejects.toMatchObject({ code: "INVALID_BODY" });
    await expect(
      readConfirmedPanelMutation(request('{"confirmed":true,"role":"ADMIN"}')),
    ).rejects.toMatchObject({ code: "INVALID_BODY" });
  });
});
