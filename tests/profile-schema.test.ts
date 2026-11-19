import { describe, expect, it } from "vitest";

import { profileUpdateSchema } from "@/lib/Modules/Panel/ProfileSchema";

describe("profile update schema", () => {
  it("accepts and trims a valid name", () => {
    expect(profileUpdateSchema.parse({ name: "  Kastir Admin  " })).toEqual({
      name: "Kastir Admin",
    });
  });

  it("rejects empty and oversized names", () => {
    expect(profileUpdateSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(
      profileUpdateSchema.safeParse({ name: "a".repeat(121) }).success,
    ).toBe(false);
  });

  it("rejects attempts to mutate role, master status or credentials", () => {
    expect(
      profileUpdateSchema.safeParse({
        name: "Attacker",
        role: "MASTER",
        isMaster: true,
        email: "attacker@example.com",
        password: "changed-password",
      }).success,
    ).toBe(false);
  });
});
