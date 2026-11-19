import { describe, expect, it } from "vitest";

import { selectDestination } from "@/lib/Modules/SplitTests/selectDestination";

const three = [
  { id: "a", weight: 34, hits: 0, sortOrder: 0 },
  { id: "b", weight: 33, hits: 0, sortOrder: 1 },
  { id: "c", weight: 33, hits: 0, sortOrder: 2 },
];

describe("selectDestination", () => {
  it("returns the only destination without using random", () => {
    const random = () => {
      throw new Error("random should not be called");
    };
    expect(
      selectDestination({
        destinations: [{ id: "only", weight: 100, hits: 0, sortOrder: 0 }],
        totalHits: 0,
        random,
      }),
    ).toBe("only");
  });

  it("uses weighted random during cold start", () => {
    // roll in first bucket (weight 34 of 100)
    expect(
      selectDestination({
        destinations: three,
        totalHits: 0,
        threshold: 50,
        random: () => 0.1,
      }),
    ).toBe("a");

    // roll near end → last bucket
    expect(
      selectDestination({
        destinations: three,
        totalHits: 10,
        threshold: 50,
        random: () => 0.99,
      }),
    ).toBe("c");
  });

  it("picks the destination with the largest deficit after threshold", () => {
    const destinations = [
      { id: "a", weight: 50, hits: 40, sortOrder: 0 },
      { id: "b", weight: 50, hits: 10, sortOrder: 1 },
    ];
    // total 50: a actual 80% vs 50%, b actual 20% vs 50% → b has bigger deficit
    expect(
      selectDestination({
        destinations,
        totalHits: 50,
        threshold: 50,
      }),
    ).toBe("b");
  });

  it("breaks deficit ties with lower sortOrder", () => {
    const destinations = [
      { id: "a", weight: 50, hits: 25, sortOrder: 2 },
      { id: "b", weight: 50, hits: 25, sortOrder: 0 },
    ];
    expect(
      selectDestination({
        destinations,
        totalHits: 50,
        threshold: 50,
      }),
    ).toBe("b");
  });
});
