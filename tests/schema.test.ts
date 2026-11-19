import { describe, expect, it } from "vitest";

import { loginSchema } from "@/lib/Modules/Auth/Schema";

describe("login schema", () => {
  it("accepts a valid email and password", () => {
    expect(
      loginSchema.safeParse({
        email: "admin@example.com",
        password: "change-me",
      }).success,
    ).toBe(true);
  });

  it("rejects invalid email and short passwords", () => {
    expect(
      loginSchema.safeParse({ email: "not-an-email", password: "change-me" })
        .success,
    ).toBe(false);
    expect(
      loginSchema.safeParse({ email: "admin@example.com", password: "short" })
        .success,
    ).toBe(false);
  });
});
