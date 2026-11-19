import { describe, expect, it } from "vitest";

import { parseLogsQuery } from "@/lib/Modules/Logs/Schema";

describe("logs query schema", () => {
  it("uses safe defaults and parses the object filter", () => {
    const parsed = parseLogsQuery(
      new URLSearchParams({ objectType: "FOLDER" }),
    );

    expect(parsed).toMatchObject({
      page: 1,
      pageSize: 50,
      objectType: "FOLDER",
    });
  });

  it("normalizes a second-precision end date to an inclusive UTC boundary", () => {
    const parsed = parseLogsQuery(
      new URLSearchParams({
        from: "2026-07-17T12:00:00Z",
        to: "2026-07-17T12:00:45Z",
      }),
    );

    expect(parsed.from).toEqual(new Date("2026-07-17T12:00:00.000Z"));
    expect(parsed.to).toEqual(new Date("2026-07-17T12:00:45.999Z"));
  });

  it("rejects invalid ranges and unsupported object types", () => {
    expect(() =>
      parseLogsQuery(
        new URLSearchParams({
          from: "2026-07-18T00:00:00Z",
          to: "2026-07-17T00:00:00Z",
        }),
      ),
    ).toThrow();

    expect(() =>
      parseLogsQuery(new URLSearchParams({ objectType: "ACCOUNT" })),
    ).toThrow();
  });

  it("caps page size and rejects malformed pagination", () => {
    expect(() =>
      parseLogsQuery(new URLSearchParams({ pageSize: "101" })),
    ).toThrow();
    expect(() => parseLogsQuery(new URLSearchParams({ page: "0" }))).toThrow();
  });
});
