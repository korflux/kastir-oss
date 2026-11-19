import { describe, expect, it } from "vitest";

import { compareByName } from "@/lib/utils/nameSort";

describe("compareByName", () => {
  it("orders ascending with pt-BR accent rules", () => {
    const names = ["Zebra", "água", "Abril", "café", "Banana"];
    const sorted = [...names].sort((a, b) => compareByName(a, b, "asc"));
    expect(sorted).toEqual(["Abril", "água", "Banana", "café", "Zebra"]);
  });

  it("orders descending as reverse of ascending", () => {
    const names = ["Zebra", "água", "Abril", "café", "Banana"];
    const sorted = [...names].sort((a, b) => compareByName(a, b, "desc"));
    expect(sorted).toEqual(["Zebra", "café", "Banana", "água", "Abril"]);
  });

  it("defaults to ascending", () => {
    expect(compareByName("b", "a")).toBeGreaterThan(0);
    expect(compareByName("a", "b")).toBeLessThan(0);
  });
});
