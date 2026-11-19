import { describe, expect, it } from "vitest";

import {
  getPublicOrigin,
  normalizePublicOrigin,
} from "@/lib/Modules/Settings/publicOrigin";

describe("public origin", () => {
  it("uses saved site URL, then request origin, then fallback", () => {
    expect(
      getPublicOrigin({
        siteUrl: "https://saved.example.com/path/",
        requestOrigin: "https://request.example.com",
        fallbackOrigin: "https://fallback.example.com",
      }),
    ).toBe("https://saved.example.com");
    expect(
      getPublicOrigin({
        requestOrigin: "https://request.example.com/",
        fallbackOrigin: "https://fallback.example.com",
      }),
    ).toBe("https://request.example.com");
    expect(
      getPublicOrigin({ fallbackOrigin: "https://fallback.example.com/" }),
    ).toBe("https://fallback.example.com");
  });

  it("rejects non HTTP(S) origins and paths when explicitly normalized", () => {
    expect(() => normalizePublicOrigin("javascript:alert(1)")).toThrow();
    expect(normalizePublicOrigin("https://example.com/anything")).toBe(
      "https://example.com",
    );
  });
});
