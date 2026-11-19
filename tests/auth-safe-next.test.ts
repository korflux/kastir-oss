import { describe, expect, it } from "vitest";

import { sanitizeLoginNext } from "@/lib/Modules/Auth/safeNext";

describe("sanitizeLoginNext", () => {
  it("allows only private preview paths", () => {
    expect(sanitizeLoginNext("/p/landing")).toBe("/p/landing");
    expect(sanitizeLoginNext("/p/my-page-2")).toBe("/p/my-page-2");
  });

  it("rejects open redirects and non-preview paths", () => {
    expect(sanitizeLoginNext("//evil.example")).toBeNull();
    expect(sanitizeLoginNext("https://evil.example")).toBeNull();
    expect(sanitizeLoginNext("/admin")).toBeNull();
    expect(sanitizeLoginNext("/p/../admin")).toBeNull();
    expect(sanitizeLoginNext("/p/foo/bar")).toBeNull();
    expect(sanitizeLoginNext("/p/")).toBeNull();
    expect(sanitizeLoginNext(null)).toBeNull();
  });

  it("allows only a complete signed MCP consent path", () => {
    const next =
      "/admin/mcp/consent?client_id=claude&redirect_uri=https%3A%2F%2Fclaude.example%2Fcallback&exp=1999999999&sig=signed";

    expect(sanitizeLoginNext(next)).toBe(next);
    expect(
      sanitizeLoginNext(
        "/admin/mcp/consent?client_id=claude&redirect_uri=https%3A%2F%2Fclaude.example%2Fcallback",
      ),
    ).toBeNull();
  });
});
