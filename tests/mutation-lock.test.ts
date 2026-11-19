import { describe, expect, it } from "vitest";

import { createMutationGate } from "@/components/Shared/mutationLock";

describe("createMutationGate", () => {
  it("serializa mutações e só libera uma nova após finalizar a atual", () => {
    const gate = createMutationGate();

    expect(gate.start("bulk:move")).toBe(true);
    expect(gate.isBusy()).toBe(true);
    expect(gate.start("delete")).toBe(false);
    expect(gate.isBusy()).toBe(true);

    gate.finish();

    expect(gate.isBusy()).toBe(false);
    expect(gate.start("delete")).toBe(true);
  });
});
