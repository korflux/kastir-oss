import { describe, expect, it } from "vitest";

import { equalWeights } from "@/lib/Modules/SplitTests/weights";

describe("equalWeights", () => {
  it("returns empty for zero or negative", () => {
    expect(equalWeights(0)).toEqual([]);
    expect(equalWeights(-1)).toEqual([]);
  });

  it("fixes a single destination at 100", () => {
    expect(equalWeights(1)).toEqual([100]);
  });

  it("splits two destinations evenly", () => {
    expect(equalWeights(2)).toEqual([50, 50]);
  });

  it("puts remainder on the first of three (34/33/33)", () => {
    expect(equalWeights(3)).toEqual([34, 33, 33]);
  });

  it("always sums to 100 for active counts 1..20", () => {
    for (let n = 1; n <= 20; n += 1) {
      const weights = equalWeights(n);
      expect(weights).toHaveLength(n);
      expect(weights.reduce((a, b) => a + b, 0)).toBe(100);
    }
  });
});
