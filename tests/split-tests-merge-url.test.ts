import { describe, expect, it } from "vitest";

import { mergeDestinationUrl } from "@/lib/Modules/SplitTests/mergeDestinationUrl";

describe("mergeDestinationUrl", () => {
  const origin = "https://site.example";

  it("preserves destination query and merges request UTMs", () => {
    const result = mergeDestinationUrl(
      "https://land.example/v1?internal=1",
      new URLSearchParams("utm_source=meta&utm_campaign=bf&foo=1"),
      origin,
    );
    const url = new URL(result);
    expect(url.origin + url.pathname).toBe("https://land.example/v1");
    expect(url.searchParams.get("internal")).toBe("1");
    expect(url.searchParams.get("utm_source")).toBe("meta");
    expect(url.searchParams.get("utm_campaign")).toBe("bf");
    expect(url.searchParams.get("foo")).toBe("1");
  });

  it("lets request params override same keys on the destination", () => {
    const result = mergeDestinationUrl(
      "https://land.example/?utm_source=organic",
      new URLSearchParams("utm_source=ads"),
      origin,
    );
    expect(new URL(result).searchParams.get("utm_source")).toBe("ads");
  });

  it("resolves internal paths against site origin", () => {
    const result = mergeDestinationUrl(
      "/oferta",
      new URLSearchParams("utm_source=x"),
      origin,
    );
    expect(result).toBe("https://site.example/oferta?utm_source=x");
  });
});
